package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
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
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import rx.Observable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * 네이버웹툰 (comic.naver.com, 공식 무료 회차만).
 * 목록·작품·회차는 사이트가 쓰는 JSON(/api/...)을 그대로 읽고, 그림은 모바일 회차 화면(img.toon_image)에서 가져온다.
 * 미리보기·유료 회차(charge)는 목록에 넣지 않는다. 19세 작품은 WebView에서 네이버 로그인을 해야 볼 수 있다.
 */
class NaverWebtoon : HttpSource(), ConfigurableSource {

    override val name = "네이버웹툰"

    override val id: Long = uniqueSourceId("newxtoon.naverwebtoon/ko/1")
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl = "https://comic.naver.com"

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    private fun showAdult(): Boolean = try {
        sp.getBoolean(KEY_ADULT, false)
    } catch (e: Throwable) {
        false
    }

    private val userAgent: String
        get() = try {
            android.webkit.WebSettings.getDefaultUserAgent(app)
                .replace("; wv", "").replace("Version/4.0 ", "")
        } catch (e: Throwable) {
            FALLBACK_UA
        }

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        // 맨 바깥: 오류를 쉬운 말로, 그다음: 실패한 그림 한 번 더 받기
        .apply { interceptors().add(0, FriendlyErrors) }
        .apply { interceptors().add(1, ImageRetry) }
        .addInterceptor(SiteRateLimit(HOST_REGEX, RATE_GAP_MS))
        .build()

    override fun headersBuilder(): Headers.Builder =
        super.headersBuilder().set("User-Agent", userAgent).set("Referer", "$baseUrl/")

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        ChapterPosition.addPref(screen)
        SwitchPreferenceCompat(screen.context).apply {
            key = KEY_ADULT
            title = "19세 작품도 목록에 표시"
            summary = "19세 작품은 WebView(오른쪽 위 지구본)에서 네이버에 로그인해야 볼 수 있어요. 끄면 목록에서 뺍니다."
            setDefaultValue(false)
        }.also(screen::addPreference)
    }

    private fun json(response: Response): JSONObject = response.use { JSONObject(it.body?.string().orEmpty()) }

    // ---------- 목록 ----------
    /** 목록 종류: 요일(week), 신작(new), 완결(finished), 장르(genre) */
    private fun listRequest(kind: String, order: String, page: Int): Request {
        val api = when {
            kind == "new" -> "$baseUrl/api/webtoon/titlelist/new?order=$order"
            kind == "finished" -> "$baseUrl/api/webtoon/titlelist/finished?order=${FINISHED_ORDER[order] ?: "VIEW"}&page=$page"
            kind.startsWith("genre:") -> "$baseUrl/api/webtoon/titlelist/genre?genre=${kind.substringAfter(':')}&order=$order&page=$page"
            kind == "all" -> "$baseUrl/api/webtoon/titlelist/weekday?order=$order"
            else -> "$baseUrl/api/webtoon/titlelist/weekday?week=$kind&order=$order"
        }
        return GET(api, headers)
    }

    override fun popularMangaRequest(page: Int) = listRequest("all", "user", page)

    // 최신 = 오늘 요일 웹툰을 업데이트순으로
    override fun latestUpdatesRequest(page: Int) = listRequest(todayWeek(), "update", page)

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) {
            val url = "$baseUrl/api/search/webtoon".toHttpUrl().newBuilder()
                .addQueryParameter("keyword", query.trim())
                .addQueryParameter("page", page.toString())
                .build()
            return GET(url.toString(), headers)
        }
        val kind = LISTS[filters.filterIsInstance<ListFilter>().firstOrNull()?.state ?: 0].second
        val order = ORDERS[filters.filterIsInstance<OrderFilter>().firstOrNull()?.state ?: 0].second
        return listRequest(kind, order, page)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    private fun parseList(response: Response): MangasPage {
        val o = json(response)
        val items = mutableListOf<JSONObject>()
        fun addAll(arr: JSONArray?) {
            if (arr == null) return
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let(items::add)
        }
        addAll(o.optJSONArray("titleList"))
        addAll(o.optJSONArray("searchList"))
        // 전체 요일: 요일별 묶음을 월→일 순서로 이어 붙임
        o.optJSONObject("titleListMap")?.let { map ->
            (WEEK_KEYS + map.keys().asSequence().toList()).distinct().forEach { addAll(map.optJSONArray(it)) }
        }
        val adult = showAdult()
        val seen = HashSet<Long>()
        val mangas = items.mapNotNull { t ->
            val tid = t.optLong("titleId")
            if (tid <= 0 || !seen.add(tid)) return@mapNotNull null
            if (!adult && (t.optBoolean("adult") || t.optBoolean("nineteen"))) return@mapNotNull null
            // 도전만화·베스트도전은 회차 주소가 달라서 뺌 (검색 결과)
            val level = t.optString("webtoonLevelCode")
            if (level.isNotEmpty() && level != "WEBTOON") return@mapNotNull null
            SManga.create().apply {
                url = "/webtoon/list?titleId=$tid"
                title = t.optString("titleName").trim()
                thumbnail_url = t.optString("thumbnailUrl").ifEmpty { null }
                author = t.optString("author").ifEmpty { t.optString("displayAuthor") }.ifEmpty { null }
                description = t.optString("synopsis").trim().ifEmpty { null }
                status = if (t.optBoolean("finished") || t.optBoolean("finish")) SManga.COMPLETED else SManga.ONGOING
            }
        }.filter { it.title.isNotEmpty() }
        val info = o.optJSONObject("pageInfo")
        val hasNext = info != null && info.optInt("page") < info.optInt("totalPages")
        return MangasPage(mangas, hasNext)
    }

    // ---------- 상세 ----------
    private fun titleIdOf(url: String): String =
        TITLE_ID_REGEX.find(url)?.groupValues?.get(1) ?: throw Exception("작품 번호를 찾을 수 없습니다: $url")

    override fun mangaDetailsRequest(manga: SManga) =
        GET("$baseUrl/api/article/list/info?titleId=${titleIdOf(manga.url)}", headers)

    override fun getMangaUrl(manga: SManga) = "$baseUrl/webtoon/list?titleId=${titleIdOf(manga.url)}"

    override fun mangaDetailsParse(response: Response): SManga {
        val o = json(response)
        val artists = o.optJSONArray("communityArtists")
        fun names(type: String): String? {
            val out = mutableListOf<String>()
            for (i in 0 until (artists?.length() ?: 0)) {
                val a = artists!!.optJSONObject(i) ?: continue
                val types = a.optJSONArray("artistTypeList")?.toString().orEmpty()
                if (types.contains(type)) out.add(a.optString("name"))
            }
            return out.filter { it.isNotEmpty() }.distinct().joinToString(", ").ifEmpty { null }
        }
        val tags = o.optJSONArray("curationTagList")
        val genre = (0 until (tags?.length() ?: 0)).mapNotNull { tags!!.optJSONObject(it)?.optString("tagName")?.trim()?.ifEmpty { null } }
        val age = o.optJSONObject("age")
        val adult = age?.optString("type").orEmpty().contains("18") || age?.optString("type").orEmpty().contains("19")
        return SManga.create().apply {
            title = o.optString("titleName").trim()
            thumbnail_url = o.optString("thumbnailUrl").ifEmpty { o.optString("posterThumbnailUrl") }.ifEmpty { null }
            author = listOfNotNull(names("ARTIST_WRITER"), names("ARTIST_NOVEL_ORIGIN")).joinToString(", ").ifEmpty { null }
            artist = names("ARTIST_PAINTER")
            this.genre = genre.joinToString(", ").ifEmpty { null }
            description = listOfNotNull(
                o.optString("synopsis").trim().ifEmpty { null },
                listOfNotNull(
                    o.optString("publishDescription").trim().ifEmpty { null },
                    age?.optString("description")?.trim()?.ifEmpty { null },
                    if (o.optBoolean("rest")) "휴재 중" else null,
                ).joinToString(" · ").ifEmpty { null },
                if (adult) "19세 작품: WebView(오른쪽 위 지구본)에서 네이버에 로그인해야 볼 수 있어요." else null,
                "미리보기·유료 회차는 목록에 나오지 않아요 (무료 회차만).",
            ).joinToString("\n\n")
            status = if (o.optBoolean("finished")) SManga.COMPLETED else SManga.ONGOING
        }
    }

    // ---------- 회차 (무료 회차 전부, 최신순) ----------
    override fun chapterListRequest(manga: SManga) = articleListRequest(titleIdOf(manga.url), 1)

    private fun articleListRequest(titleId: String, page: Int) =
        GET("$baseUrl/api/article/list?titleId=$titleId&page=$page", headers)

    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> = Observable.fromCallable {
        val tid = titleIdOf(manga.url)
        val out = mutableListOf<SChapter>()
        var page = 1
        var last = 1
        do {
            val o = client.newCall(articleListRequest(tid, page)).execute().let(::json)
            out += parseArticles(tid, o)
            last = o.optJSONObject("pageInfo")?.optInt("totalPages", page) ?: page
            page++
        } while (page <= last && page <= MAX_LIST_PAGES)
        val list = out.distinctBy { it.url }.sortedByDescending { it.chapter_number }
        if (ChapterPosition.enabled(sp)) ChapterPosition.label(list, manga.title) else list
    }

    override fun chapterListParse(response: Response): List<SChapter> {
        val o = json(response)
        return parseArticles(o.optLong("titleId").toString(), o)
    }

    private fun parseArticles(titleId: String, o: JSONObject): List<SChapter> {
        val arr = o.optJSONArray("articleList") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val a = arr.optJSONObject(i) ?: return@mapNotNull null
            // 미리보기·유료 회차는 뺌 (무료 회차만)
            if (a.optBoolean("charge")) return@mapNotNull null
            val no = a.optInt("no", -1).takeIf { it >= 0 } ?: return@mapNotNull null
            val sub = a.optString("subtitle").trim()
            SChapter.create().apply {
                url = "/webtoon/detail?titleId=$titleId&no=$no"
                name = sub.ifEmpty { "${no}화" }
                chapter_number = no.toFloat()
                date_upload = dateOf(a.optString("serviceDateDescription"))
            }
        }
    }

    private val dateFmt = SimpleDateFormat("yy.MM.dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    private fun dateOf(text: String): Long = try {
        if (DATE_REGEX.matches(text.trim())) dateFmt.parse(text.trim())?.time ?: 0L else 0L
    } catch (e: Exception) {
        0L
    }

    override fun getChapterUrl(chapter: SChapter) = MOBILE + chapter.url

    // ---------- 이미지 (모바일 회차 화면) ----------
    override fun pageListRequest(chapter: SChapter) =
        GET(MOBILE + chapter.url, headersBuilder().set("Referer", "$MOBILE/").build())

    override fun pageListParse(response: Response): List<Page> {
        val html = response.use { it.body?.string().orEmpty() }
        val d = Jsoup.parse(html, response.request.url.toString())
        val urls = d.select("img.toon_image, #toonLayer img, #sectionContWide img, .wt_viewer img").mapNotNull { img ->
            listOf("data-src", "src").map { img.absUrl(it) }
                .firstOrNull { it.contains("pstatic.net") && !it.contains("/static/") }
        }.distinct()
        if (urls.isEmpty()) {
            val login = response.request.url.host.contains("nid.naver.com") || html.contains("nid.naver.com/nidlogin")
            throw Exception(
                if (login) {
                    "19세 작품이에요. WebView(오른쪽 위 지구본)에서 네이버에 로그인한 뒤 다시 열어 주세요."
                } else {
                    "이 회차의 그림을 찾을 수 없어요 (유료·미리보기 회차이거나 앱 전용 회차일 수 있어요)."
                },
            )
        }
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$MOBILE/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 작품·회차 주소 → 작품 주소 */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        u.queryParameter("titleId")?.takeIf { it.all(Char::isDigit) }?.let { "/webtoon/list?titleId=$it" }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    private class ListFilter : Filter.Select<String>("목록", LISTS.map { it.first }.toTypedArray())
    private class OrderFilter : Filter.Select<String>("정렬", ORDERS.map { it.first }.toTypedArray())

    override fun getFilterList() = tabRules.attach(
        FilterList(
            Filter.Header("검색어가 없을 때만 적용 (무료 회차만 보여요)"),
            ListFilter(),
            OrderFilter(),
        ),
    )

    private fun todayWeek(): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"))
        return when (c.get(Calendar.DAY_OF_WEEK)) {
            Calendar.MONDAY -> "mon"
            Calendar.TUESDAY -> "tue"
            Calendar.WEDNESDAY -> "wed"
            Calendar.THURSDAY -> "thu"
            Calendar.FRIDAY -> "fri"
            Calendar.SATURDAY -> "sat"
            else -> "sun"
        }
    }

    companion object {
        private const val KEY_ADULT = "pref_show_adult"
        private const val MOBILE = "https://m.comic.naver.com"
        private const val RATE_GAP_MS = 150L
        private const val MAX_LIST_PAGES = 200
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^(m\\.)?comic\\.naver\\.com$")
        private val TITLE_ID_REGEX = Regex("""titleId=(\d+)""")
        private val DATE_REGEX = Regex("""\d{2}\.\d{2}\.\d{2}""")
        private val WEEK_KEYS = listOf("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")

        private val LISTS = listOf(
            "전체 요일" to "all",
            "월요웹툰" to "mon", "화요웹툰" to "tue", "수요웹툰" to "wed", "목요웹툰" to "thu",
            "금요웹툰" to "fri", "토요웹툰" to "sat", "일요웹툰" to "sun",
            "매일+" to "dailyPlus", "신작" to "new", "완결" to "finished",
        ) + listOf(
            "로맨스" to "PURE", "판타지" to "FANTASY", "액션" to "ACTION", "일상" to "DAILY", "스릴러" to "THRILL",
            "개그" to "COMIC", "무협/사극" to "HISTORICAL", "드라마" to "DRAMA", "감성" to "SENSIBILITY", "스포츠" to "SPORTS",
        ).map { "장르: ${it.first}" to "genre:${it.second}" }

        private val ORDERS = listOf("인기순" to "user", "업데이트순" to "update", "조회순" to "view", "별점순" to "starScore")

        /** 완결 목록은 정렬 값 모양이 다름 */
        private val FINISHED_ORDER = mapOf("user" to "VIEW", "update" to "UPDATE", "view" to "VIEW", "starScore" to "STAR_SCORE")
    }
}
