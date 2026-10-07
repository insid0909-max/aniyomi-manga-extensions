package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import android.util.Base64
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
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 툰코 (toonkor#.org).
 * 목록: /웹툰[/연재|/완결|/요일]?fil=정렬·장르&wpage=N, 망가·단행본·포토툰도 같은 모양.
 * 검색: /bbs/search.php?stx=, 작품: /작품이름, 회차: /작품이름_N화....html
 * 회차의 그림 목록은 페이지 안 toon_img 값(base64 로 감싼 img 태그)에 들어 있다.
 */
class Toonkor : HttpSource(), ConfigurableSource {

    override val name = "툰코 웹툰"

    override val id: Long = uniqueSourceId("newxtoon.toonkor/ko/1")
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    private val userAgent: String
        get() {
            val custom = try {
                sp.getString(KEY_UA, "")?.trim().orEmpty()
            } catch (e: Throwable) {
                ""
            }
            if (custom.isNotEmpty()) return custom
            return try {
                android.webkit.WebSettings.getDefaultUserAgent(app)
                    .replace("; wv", "").replace("Version/4.0 ", "")
            } catch (e: Throwable) {
                FALLBACK_UA
            }
        }

    override val baseUrl: String
        get() {
            val v = try {
                sp.getString(KEY_DOMAIN, "")?.trim()?.trimEnd('/').orEmpty()
            } catch (e: Throwable) {
                ""
            }
            return if (DOMAIN_REGEX.matches(v)) v else DEFAULT
        }

    private fun autoDomain(): Boolean = try {
        sp.getBoolean(KEY_AUTO, true)
    } catch (e: Throwable) {
        true
    }

    private fun saveDomain(url: String) {
        try {
            sp.edit().putString(KEY_DOMAIN, url).apply()
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    // 주소 번호가 바뀌어 접속이 안 되면 자동으로 새 주소를 찾아 다시 요청
    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> domainIntercept(chain) }
        .build()

    private fun domainIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val ours = autoDomain() && baseHost != null && req.url.host == baseHost && HOST_REGEX.matches(baseHost)

        val res = try {
            chain.proceed(req)
        } catch (e: java.io.IOException) {
            val found = if (ours) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            saveDomain("https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }
        if (ours && (res.code >= 500 || res.code == 403)) {
            val found = discoverDomain(baseHost!!)
            if (found != null) {
                res.close()
                saveDomain("https://$found")
                return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
            }
        }
        val finalHost = res.request.url.host
        if (ours && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("toonkor(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 현재 번호 주변(-2 ~ +30)의 toonkor#.org 중 툰코가 열리는 주소를 찾음 (가장 큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT)
        val tld = currentHost.substringAfterLast('.', "org")
        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val ua = userAgent
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        try {
            val futures = ((cur - 2).coerceAtLeast(1)..(cur + 30)).map { "toonkor$it.$tld" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (!HOST_REGEX.matches(fh) || res.code != 200) return@use null
                                if (res.peekBody(300_000).string().contains(SITE_MARKER)) fh else null
                            }
                        } catch (e: Exception) {
                            null
                        }
                    }
                }
            futures.mapNotNull { it.get() }.maxByOrNull { hostNumber(it) }
        } finally {
            pool.shutdown()
        }
    }

    override fun headersBuilder(): Headers.Builder =
        super.headersBuilder().set("User-Agent", userAgent).set("Referer", "$baseUrl/")

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소"
            summary = "사이트 주소가 바뀌면 여기서 변경 (기본: $DEFAULT)"
            dialogTitle = "도메인 주소"
            setDefaultValue(DEFAULT)
            setOnPreferenceChangeListener { _, v ->
                DOMAIN_REGEX.matches((v as String).trim().trimEnd('/'))
            }
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "주소 번호가 바뀌어 접속이 안 되면 toonkor#.org 중 열리는 주소로 자동 변경"
            setDefaultValue(true)
        }.also(screen::addPreference)

        EditTextPreference(screen.context).apply {
            key = KEY_UA
            title = "User-Agent (고급)"
            summary = "비워두면 폰 WebView 기준으로 자동 설정. 변경 후 앱 재시작 필요"
            dialogTitle = "User-Agent"
            setDefaultValue("")
        }.also(screen::addPreference)
    }

    private fun Response.asDoc(): Document = use { Jsoup.parse(it.body?.string().orEmpty(), it.request.url.toString()) }

    // ---------- 목록 ----------
    /** /분류[/목록]?fil=정렬·장르&wpage=N */
    private fun listReq(section: String, list: String, fil: String, page: Int): Request {
        val b = "$baseUrl/".toHttpUrl().newBuilder().addPathSegment(section)
        if (list.isNotEmpty()) b.addPathSegment(list)
        if (fil.isNotEmpty()) b.addQueryParameter("fil", fil)
        if (page > 1) b.addQueryParameter("wpage", page.toString())
        return GET(b.build().toString(), headers)
    }

    override fun popularMangaRequest(page: Int) = listReq("웹툰", "", "인기", page)
    override fun latestUpdatesRequest(page: Int) = listReq("웹툰", "", "최신", page)

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) {
            val url = "$baseUrl/bbs/search.php".toHttpUrl().newBuilder()
                .addQueryParameter("sfl", "wr_subject||wr_content")
                .addQueryParameter("stx", query.trim())
                .apply { if (page > 1) addQueryParameter("wpage", page.toString()) }
                .build()
            return GET(url.toString(), headers)
        }
        val section = SECTIONS[filters.filterIsInstance<SectionFilter>().firstOrNull()?.state ?: 0]
        // 연재·완결·요일 목록은 웹툰에만 있음
        val list = if (section == "웹툰") LISTS[filters.filterIsInstance<ListFilter>().firstOrNull()?.state ?: 0].second else ""
        val fil = FILS[filters.filterIsInstance<FilFilter>().firstOrNull()?.state ?: 0].second
        return listReq(section, list, fil, page)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    /** 목록·검색 공통 카드 (.section-item-inner) */
    /** 그림 주소: 늦게 불러오는 카드는 src 가 빈 그림(data:)이고 진짜 주소는 data-src 에 있음 */
    private fun imgUrl(img: org.jsoup.nodes.Element): String? =
        listOf("data-src", "data-original", "src").map { img.absUrl(it) }
            .firstOrNull { it.isNotEmpty() && !it.startsWith("data:") }

    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val seen = HashSet<String>()
        val mangas = doc.select(".section-item-inner").mapNotNull { item ->
            val a = item.selectFirst("a#title[href], .section-item-title a[href]") ?: return@mapNotNull null
            val path = pathOf(a.attr("href"))
            if (path.length < 2 || path.contains(".html") || !seen.add(path)) return@mapNotNull null
            SManga.create().apply {
                url = path
                title = a.selectFirst("h3")?.text()?.trim()?.ifEmpty { null } ?: item.attr("alt").trim()
                thumbnail_url = item.selectFirst(".section-item-photo img")?.let(::imgUrl)
                description = item.selectFirst(".toon-summary")?.text()?.trim()?.ifEmpty { null }
                genre = item.selectFirst(".toon_gen")?.text()?.trim()?.replace("/", ", ")?.ifEmpty { null }
            }
        }.filter { it.title.isNotEmpty() }
        // 다음 쪽: 지금 쪽보다 큰 wpage 링크가 있으면
        val cur = WPAGE_REGEX.find(doc.location())?.groupValues?.get(1)?.toIntOrNull() ?: 1
        val hasNext = doc.select("a[href*=wpage=]").any {
            (WPAGE_REGEX.find(it.attr("href"))?.groupValues?.get(1)?.toIntOrNull() ?: 0) > cur
        }
        return MangasPage(mangas, hasNext && mangas.isNotEmpty())
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(urlOf(manga.url), headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        fun field(label: String) = d.select("span.bt_label").firstOrNull { it.text().trim() == label }
            ?.nextElementSibling()?.takeIf { it.hasClass("bt_data") }?.text()?.trim()?.ifEmpty { null }
        val latest = d.selectFirst("td.episode__index")?.text()?.trim()?.let(::dateOf) ?: 0L
        return SManga.create().apply {
            title = d.selectFirst("td.bt_title")?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst("td.bt_thumb img")?.let(::imgUrl)
                ?: d.selectFirst("meta[property=og:image]")?.attr("content")
            author = field("작가")
            genre = field("장르")?.replace("/", ", ")
            description = listOfNotNull(
                d.selectFirst("td.bt_over")?.text()?.trim()?.ifEmpty { null },
                field("총편수"),
            ).joinToString("\n\n").ifEmpty { null }
            // 최근 회차가 3주 안이면 연재 중, 오래됐으면 완결로 봄
            status = when {
                latest <= 0L -> SManga.UNKNOWN
                System.currentTimeMillis() - latest <= ONGOING_DAYS * DAY_MS -> SManga.ONGOING
                else -> SManga.COMPLETED
            }
        }
    }

    // ---------- 회차 (최신순, 한 페이지) ----------
    override fun chapterListRequest(manga: SManga): Request = GET(urlOf(manga.url), headers)

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    private fun dateOf(text: String): Long = try {
        dateFmt.parse(text)?.time ?: 0L
    } catch (e: Exception) {
        0L
    }

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서)
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map { ChapterOrder.sort(it, manga.title) }

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val seen = HashSet<String>()
        return d.select("td.content__title[data-role]").mapNotNull { td ->
            val path = pathOf(td.attr("data-role"))
            if (!path.endsWith(".html") || !seen.add(path)) return@mapNotNull null
            val row = td.parent()
            val ep = listOfNotNull(td.selectFirst(".ep-n")?.text(), td.selectFirst(".ep-s")?.text())
                .joinToString("").trim()
            SChapter.create().apply {
                url = path
                name = ep.ifEmpty { td.attr("alt").trim().ifEmpty { td.text().trim() } }
                chapter_number = EP_NUM_REGEX.find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
                date_upload = row?.selectFirst("td.episode__index")?.text()?.trim()?.let(::dateOf) ?: 0L
            }
        }
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter) = GET(urlOf(chapter.url), headers)

    override fun pageListParse(response: Response): List<Page> {
        val d = response.asDoc()
        // toon_img: img 태그 묶음을 base64 로 감싼 값 (사이트 스크립트도 그대로 풀어서 화면에 넣음)
        val encoded = d.select("script").firstNotNullOfOrNull { TOON_IMG_REGEX.find(it.data())?.groupValues?.get(1) }
        val html = encoded?.let {
            try {
                String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8)
            } catch (e: Exception) {
                null
            }
        }
        val imgs = (html?.let { Jsoup.parse(it, baseUrl) } ?: d).select(if (html != null) "img" else "#toon_img img")
        val urls = imgs.mapNotNull { img ->
            listOf("data-src", "data-original", "src")
                .firstOrNull { img.attr(it).isNotBlank() && !img.attr(it).trim().startsWith("data:") }
                ?.let { img.absUrl(it).ifEmpty { null } }
        }.distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (제목: ${d.title().take(40)})")
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 사이트 주소 → 작품 주소 (회차 주소면 작품 이름까지만) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? {
        val seg = u.pathSegments.firstOrNull()?.takeIf { it.isNotEmpty() && it !in NON_TITLE } ?: return null
        val title = if (seg.endsWith(".html")) seg.substringBeforeLast("_").substringBefore("_").ifEmpty { return null } else seg
        return "/$title"
    }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    private class SectionFilter : Filter.Select<String>("분류", SECTIONS.toTypedArray())
    private class ListFilter : Filter.Select<String>("목록 (웹툰)", LISTS.map { it.first }.toTypedArray())
    private class FilFilter : Filter.Select<String>("정렬·장르", FILS.map { it.first }.toTypedArray())

    override fun getFilterList() = ExtStatus.prepend(
        "toonkor",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어가 없을 때만 적용"),
                SectionFilter(),
                ListFilter(),
                FilFilter(),
            ),
        ),
    )

    /** 저장된 경로(한글)를 주소로 */
    private fun urlOf(path: String): String = baseUrl + path

    private fun pathOf(href: String): String {
        val p = Regex("^https?://[^/]+(/.*)$").find(href)?.groupValues?.get(1) ?: href
        // 주소창 모양(%EC..)으로 오면 한글로 풀어서 저장 (사이트 링크와 같은 모양)
        return try {
            java.net.URLDecoder.decode(p.replace("+", "%2B"), "UTF-8")
        } catch (e: Exception) {
            p
        }
    }

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://toonkor2.org"
        private const val SITE_MARKER = "툰코"
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^(www\\.)?toonkor\\d+\\.[a-z]{2,6}$")
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val WPAGE_REGEX = Regex("[?&]wpage=(\\d+)")
        private val TOON_IMG_REGEX = Regex("""var\s+toon_img\s*=\s*'([A-Za-z0-9+/=]+)'""")
        private val EP_NUM_REGEX = Regex("""(\d+(?:\.\d+)?)\s*화""")
        private const val ONGOING_DAYS = 21
        private const val DAY_MS = 86_400_000L

        /** 사이트 메뉴 (작품 주소로 오인하지 않게) */
        private val NON_TITLE = setOf("웹툰", "망가", "단행본", "포토툰", "소설", "애니", "TV", "notice", "bbs", "코사이트", "주소안내", "토토보증업체")

        private val SECTIONS = listOf("웹툰", "망가", "단행본", "포토툰")
        private val LISTS = listOf(
            "전체" to "", "연재" to "연재", "완결" to "완결", "업데이트" to "업데이트",
            "월" to "월", "화" to "화", "수" to "수", "목" to "목", "금" to "금", "토" to "토", "일" to "일", "열흘" to "열흘",
        )

        /** fil 값: 정렬(최신·인기·제목) 또는 장르 */
        private val FILS = listOf("기본" to "", "최신순" to "최신", "인기순" to "인기", "제목순" to "제목", "성인" to "성인") + listOf(
            "드라마", "판타지", "액션", "로맨스", "일상", "개그", "미스터리", "순정",
            "스포츠", "BL", "스릴러", "무협", "학원", "공포", "스토리",
        ).map { "장르: $it" to it }
    }
}
