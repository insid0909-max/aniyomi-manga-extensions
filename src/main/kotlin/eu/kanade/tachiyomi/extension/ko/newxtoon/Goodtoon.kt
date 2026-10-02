package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.Response
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class Goodtoon : HttpSource(), ConfigurableSource {

    override val name = "Goodtoon 웹툰"
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    private val userAgent: String
        get() = try {
            android.webkit.WebSettings.getDefaultUserAgent(app)
                .replace("; wv", "").replace("Version/4.0 ", "")
        } catch (e: Throwable) {
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        }

    override val baseUrl: String
        get() {
            val v = try {
                sp.getString(KEY_DOMAIN, "")?.trim()?.trimEnd('/').orEmpty()
            } catch (e: Throwable) {
                ""
            }
            return if (Regex("^https?://[^\\s/]+$").matches(v)) v else DEFAULT
        }

    override fun headersBuilder(): Headers.Builder =
        super.headersBuilder().set("User-Agent", userAgent)

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소"
            summary = "사이트 주소가 바뀌면 여기서 변경 (기본: $DEFAULT)"
            dialogTitle = "도메인 주소"
            setDefaultValue(DEFAULT)
            setOnPreferenceChangeListener { _, v ->
                Regex("^https?://[^\\s/]+$").matches((v as String).trim().trimEnd('/'))
            }
        }.also(screen::addPreference)
    }

    // ---------- 목록 ----------
    private fun listReq(path: String, page: Int, q: String? = null, extra: Map<String, String> = emptyMap()): Request {
        val b = (baseUrl + path).toHttpUrl().newBuilder()
        if (!q.isNullOrBlank()) b.addQueryParameter("q", q)
        extra.forEach { (k, v) -> if (v.isNotEmpty()) b.addQueryParameter(k, v) }
        if (page > 1) b.addQueryParameter("pg", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaRequest(page: Int) = listReq("/recommend/", page)
    override fun latestUpdatesRequest(page: Int) = listReq("/", page)

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) return listReq("/", page, query.trim())
        var path = "/"
        val extra = LinkedHashMap<String, String>()
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                if (f.param == "list") path = v else extra[f.param] = v
            }
        }
        return listReq(path, page, null, extra)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val seen = HashSet<String>()
        val mangas = doc.select("a.card[href*=/manga/gt-]").mapNotNull { a ->
            val path = pathOf(a.attr("href"))
            if (!seen.add(path)) return@mapNotNull null
            SManga.create().apply {
                url = path
                title = a.selectFirst(".subject")?.text()?.trim().orEmpty()
                thumbnail_url = a.select(".thumb img").firstOrNull { !it.hasClass("platform-icon") }
                    ?.absUrl("src")?.ifEmpty { null }
            }
        }.filter { it.title.isNotEmpty() }
        val cur = Regex("[?&]pg=(\\d+)").find(response.request.url.toString())
            ?.groupValues?.get(1)?.toIntOrNull() ?: 1
        val maxPg = doc.select(".pagination a.page-numbers").mapNotNull {
            Regex("pg=(\\d+)").find(it.attr("href"))?.groupValues?.get(1)?.toIntOrNull()
        }.maxOrNull() ?: 0
        val hasNext = doc.selectFirst(".pagination a.next") != null || maxPg > cur ||
            doc.select(".pagination a.page-numbers").any { it.text().contains("다음") }
        return MangasPage(mangas, hasNext)
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        return SManga.create().apply {
            title = d.selectFirst("h1.summary-title")?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst(".manga-summary-cover img")?.absUrl("src")?.ifEmpty { null }
                ?: d.selectFirst("meta[property=og:image]")?.attr("content")
            description = d.selectFirst("#manga-desc")?.text()?.trim()
            genre = d.selectFirst(".manga-summary-genres")?.text()
                ?.split("/", ",")?.map { it.trim() }?.filter { it.isNotEmpty() }?.joinToString(", ")
            val st = d.select(".summary-meta-row .meta-value").map { it.text().trim() }
            status = when {
                st.any { it.contains("완결") } -> SManga.COMPLETED
                st.any { it.contains("연재") } -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    // ---------- 회차 (상세 페이지에 전체 목록이 들어 있음) ----------
    override fun chapterListRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    private val dateFmt = SimpleDateFormat("yy.MM.dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val seen = HashSet<String>()
        return d.select("li.wp-manga-chapter").mapNotNull { li ->
            val a = li.selectFirst("a") ?: return@mapNotNull null
            val path = pathOf(a.attr("href"))
            if (!seen.add(path)) return@mapNotNull null
            SChapter.create().apply {
                url = path
                name = a.text().trim().removePrefix("UP").trim()
                date_upload = try {
                    dateFmt.parse(li.selectFirst(".chapter-release-date")?.text()?.trim().orEmpty())?.time ?: 0L
                } catch (e: Exception) {
                    0L
                }
            }
        }
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter) = GET(baseUrl + chapter.url, headers)

    private val imgRegex =
        Regex("""https?://[^"'\s\\<>]+?/gt-\d+/ch-\d+/\d+\.(?:jpe?g|png|webp|gif|avif)""", RegexOption.IGNORE_CASE)

    override fun pageListParse(response: Response): List<Page> {
        val html = response.body?.string().orEmpty().replace("\\/", "/")
        var urls = imgRegex.findAll(html).map { it.value }.distinct().toList()
        if (urls.isEmpty()) {
            val d = Jsoup.parse(html, response.request.url.toString())
            urls = d.select("img[data-src], img[src]").map { it.absUrl(if (it.hasAttr("data-src")) "data-src" else "src") }
                .filter { it.contains("/ch-") }.distinct()
        }
        val sorted = urls.sortedBy { Regex("/(\\d+)\\.[a-z]+$", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.toIntOrNull() ?: 0 }
        return sorted.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 필터 ----------
    override fun getFilterList() = FilterList(
        Filter.Header("검색어가 없을 때만 적용"),
        Pick("목록", "list", LISTS),
        Pick("분류", "mcat", CATS),
        Pick("요일", "mday", DAYS),
        Pick("장르", "genre", GENRES),
        Pick("플랫폼", "plat", PLATS),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    private fun pathOf(href: String): String =
        Regex("^https?://[^/]+(/.*)$").find(href)?.groupValues?.get(1) ?: href

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val DEFAULT = "https://www.goodtoon006.com"
        private val LISTS = listOf(
            "전체(최신)" to "/",
            "인기순" to "/recommend/",
            "연재중" to "/ongoing/",
            "완결" to "/end/",
        )
        private val CATS = listOf("전체" to "", "일반웹툰" to "webtoon", "BL/GL" to "bl-gl", "성인웹툰" to "adult")
        private val DAYS = listOf(
            "전체" to "", "월" to "mon", "화" to "tue", "수" to "wed", "목" to "thu",
            "금" to "fri", "토" to "sat", "일" to "sun", "기타" to "etc",
        )
        private val GENRES = listOf(
            "전체" to "", "학원" to "school", "액션" to "action", "SF" to "sci-fi", "스토리" to "story",
            "판타지" to "fantasy", "BL" to "bl", "개그" to "gag", "연애" to "romance-drama",
            "드라마" to "drama", "로맨스" to "romance", "시대극" to "period", "스포츠" to "sports",
            "일상" to "slice-of-life", "추리" to "mystery", "공포" to "horror", "성인" to "adult",
            "옴니버스" to "omnibus", "에피소드" to "episode", "무협" to "martial-arts", "소년" to "shounen",
            "기타" to "etc", "노벨피아" to "novelpia", "유부녀" to "married", "하드코어" to "hardcore",
            "조교" to "training", "고수위" to "high-level", "능욕" to "abuse", "하렘" to "harem",
            "강제" to "forced", "여성인기" to "female-popular", "남성인기" to "male-popular",
            "3P" to "threesome", "후방주의" to "adult-warning", "백합" to "yuri",
        )
        private val PLATS = listOf(
            "전체" to "", "네이버" to "naver", "다음" to "daum", "카카오" to "kakao", "레진" to "rejin",
            "투믹스" to "tomics", "탑툰" to "toptoon", "리디" to "ridi", "코미카" to "comica",
            "배틀코믹스" to "battlecomics", "코믹GT" to "comicgt", "케이툰" to "ktoon", "애니툰" to "anitoon",
            "폭스툰" to "foxtoon", "피너툰" to "peanutoon", "봄툰" to "bom", "코미코" to "comico",
            "무툰" to "mootoon", "기타" to "etc",
        )
    }
}
