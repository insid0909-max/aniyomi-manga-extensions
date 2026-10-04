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
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.net.URLEncoder
import java.util.Calendar
import java.util.TimeZone
import rx.Observable

/**
 * 뉴토끼 소설 (sbxh##.com) - 목록·검색·작품 정보·회차 목록.
 * 본문은 사이트가 광고 확인·캡차·암호화로 보호하므로 앱 안에서 읽지 않고,
 * 회차를 열면 나오는 "WebView에서 열기" 버튼으로 사이트 뷰어에서 읽는다.
 */
class Toki : HttpSource(), ConfigurableSource {

    override val name = "토끼 소설"

    override val id: Long = uniqueSourceId("newxtoon.toki/ko/1")
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
        val finalHost = res.request.url.host
        // 옛 주소는 텔레그램 주소 안내로 넘어가거나 5xx 를 냄
        if (ours && (res.code >= 500 || (finalHost != baseHost && !HOST_REGEX.matches(finalHost)))) {
            val found = discoverDomain(baseHost!!)
            if (found != null) {
                res.close()
                saveDomain("https://$found")
                return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
            }
        }
        if (ours && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("sbxh(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 현재 번호 주변(-3 ~ +40)의 sbxh##.com 중 사이트가 열리는 주소를 찾음 (가장 큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT)
        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val ua = userAgent
        val pool = java.util.concurrent.Executors.newFixedThreadPool(10)
        try {
            val futures = ((cur - 3).coerceAtLeast(1)..(cur + 40)).map { "sbxh$it.com" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (!HOST_REGEX.matches(fh) || res.code != 200) return@use null
                                if (res.body?.string().orEmpty().contains("ntk-fonts")) fh else null
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
            summary = "주소 번호가 바뀌어 접속이 안 되면 sbxh##.com 중 열리는 주소로 자동 변경"
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

    private fun Response.asDoc(): Document =
        use { Jsoup.parse(it.body?.string().orEmpty(), it.request.url.toString()) }

    // ---------- 목록 ----------
    private fun listReq(list: String, page: Int, params: Map<String, String>): Request {
        if (list.startsWith("rank:")) return GET("$baseUrl/rank?kind=novel&period=${list.substring(5)}", headers)
        val q = params.filter { it.value.isNotEmpty() }
            .map { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }.toMutableList()
        if (page > 1) q.add("page=$page")
        return GET(baseUrl + list + if (q.isEmpty()) "" else "?" + q.joinToString("&"), headers)
    }

    override fun popularMangaRequest(page: Int) = GET("$baseUrl/rank?kind=novel", headers)
    override fun latestUpdatesRequest(page: Int) = listReq("/novel", page, emptyMap())

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        var list = "/novel"
        val params = LinkedHashMap<String, String>()
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                if (f.param == "list") list = v else params[f.param] = v
            }
        }
        if (query.isNotBlank()) {
            list = "/novel"
            params["q"] = query.trim()
        }
        if (list != "/novel") {
            params.remove("g")
            params.remove("p")
        }
        if (params["sort"] == "new") params.remove("sort")
        return listReq(list, page, params)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    /** 목록·랭킹·완결 페이지 공통: /novel/{번호} 로 가는 카드를 모두 모음 */
    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val paged = !doc.location().contains("/rank")
        val seen = HashSet<String>()
        val mangas = doc.select("a[href]").mapNotNull { a ->
            val path = pathOf(a.attr("href")).substringBefore('?').substringBefore('#')
            if (!NOVEL_PATH.matches(path) || path in seen) return@mapNotNull null
            val img = a.selectFirst("img")
            val title = (
                a.selectFirst(".nv-title")?.text()?.takeIf { it.isNotBlank() }
                    ?: img?.attr("alt")?.takeIf { it.isNotBlank() }
                    ?: a.selectFirst("h2")?.text()?.takeIf { it.isNotBlank() }
                    ?: a.selectFirst("strong")?.text()
                ).orEmpty().trim()
            if (title.isEmpty()) return@mapNotNull null
            seen.add(path)
            SManga.create().apply {
                url = path
                this.title = title
                thumbnail_url = img?.absUrl("src")?.ifEmpty { null }
            }
        }
        return MangasPage(mangas, paged && mangas.size >= 40)
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        return SManga.create().apply {
            title = (d.selectFirst(".nd-info h1") ?: d.selectFirst("h1"))?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst(".nd-thumb img")?.absUrl("src")?.ifEmpty { null }
            author = d.selectFirst(".nd-meta a")?.text()?.trim()
            val desc = d.selectFirst("p.nd-desc")?.wholeText()?.trim().orEmpty()
            description = (desc + "\n\n※ 본문은 회차를 연 뒤 \"WebView에서 열기\" 버튼으로 사이트에서 읽습니다.").trim()
            genre = (
                d.select(".hero-v2-tags a.hero-v2-tag").map { it.text().trim() } +
                    listOfNotNull(d.selectFirst(".nd-platform")?.text()?.trim())
                ).filter { it.isNotEmpty() }.joinToString(", ")
            status = SManga.UNKNOWN
        }
    }

    // ---------- 회차 (페이지에 최신 일부, 나머지는 "이전 회차 더 보기"와 같은 주소로 이어 받음) ----------
    override fun chapterListRequest(manga: SManga): Request = GET(baseUrl + manga.url, headers)

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val nid = NOVEL_PATH.find(pathOf(d.location()).substringBefore('?'))?.groupValues?.get(1)
            ?: d.selectFirst("ul.novel-eps[data-novel-id]")?.attr("data-novel-id").orEmpty()
        val seen = HashSet<String>()
        val out = ArrayList<SChapter>()
        var oldest: String? = null
        for (li in d.select("li.novel-ep-row")) {
            val epId = li.attr("data-episode-id")
            val path = li.selectFirst("a.novel-ep-link")?.attr("href")?.let { pathOf(it) }
                ?: if (epId.isNotEmpty()) "/novel/$nid/$epId" else continue
            if (!seen.add(path)) continue
            val num = li.attr("data-ep")
            val label = li.selectFirst(".ne-num")?.text()?.trim()?.ifEmpty { null } ?: "${num}화"
            val title = li.selectFirst(".ne-title")?.text()?.trim().orEmpty()
            out.add(chapter(path, if (title.isEmpty()) label else "$label $title", num.toFloatOrNull(), li.selectFirst(".ne-date")?.text()))
            if (num.isNotEmpty() && epId.isNotEmpty()) oldest = "$num:$epId"
        }

        var i = 0
        while (oldest != null && nid.isNotEmpty() && i++ < 80) {
            val json = try {
                val url = "$baseUrl/api/novel/$nid/episodes/window?direction=older&cursor=${URLEncoder.encode(oldest, "UTF-8")}"
                client.newCall(GET(url, headersBuilder().set("Accept", "application/json").build())).execute()
                    .use { JSONObject(it.body?.string().orEmpty()) }
            } catch (e: Exception) {
                break
            }
            val items = json.optJSONArray("items")
            if (!json.optBoolean("ok") || items == null || items.length() == 0) break
            var added = 0
            var minNum = Int.MAX_VALUE
            var minId = ""
            for (k in 0 until items.length()) {
                val it = items.getJSONObject(k)
                val epId = it.optString("id")
                val number = it.optInt("number")
                if (number < minNum) {
                    minNum = number
                    minId = epId
                }
                val path = "/novel/$nid/$epId"
                if (epId.isEmpty() || !seen.add(path)) continue
                added++
                val label = it.optString("episodeLabel").ifEmpty { "${number}화" }
                val title = it.optString("title")
                out.add(chapter(path, if (title.isEmpty()) label else "$label $title", number.toFloat(), it.optString("publishedAtLabel")))
            }
            oldest = if (json.optBoolean("hasOlder") && minId.isNotEmpty()) "$minNum:$minId" else null
            if (added == 0) break
        }
        return out
    }

    private fun chapter(path: String, name: String, num: Float?, date: String?) = SChapter.create().apply {
        url = path
        this.name = name
        chapter_number = num ?: -1f
        date_upload = parseDate(date)
    }

    /** "26. 10. 03." / "3시간 전" → 밀리초 */
    private fun parseDate(s: String?): Long {
        val t = s?.trim().orEmpty()
        Regex("(\\d{2,4})\\.\\s*(\\d{1,2})\\.\\s*(\\d{1,2})").find(t)?.let { m ->
            val y = m.groupValues[1].toInt().let { if (it < 100) 2000 + it else it }
            return Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).apply {
                clear()
                set(y, m.groupValues[2].toInt() - 1, m.groupValues[3].toInt())
            }.timeInMillis
        }
        Regex("(\\d+)\\s*(분|시간|일)\\s*전").find(t)?.let { m ->
            val unit = when (m.groupValues[2]) {
                "분" -> 60_000L
                "시간" -> 3_600_000L
                else -> 86_400_000L
            }
            return System.currentTimeMillis() - m.groupValues[1].toLong() * unit
        }
        return 0L
    }

    // ---------- 본문: 회차 주소를 한 장짜리 페이지로 넘겨 리더의 "WebView에서 열기" 버튼으로 사이트 뷰어를 연다 ----------
    override fun fetchPageList(chapter: SChapter): Observable<List<Page>> =
        Observable.just(listOf(Page(0, baseUrl + chapter.url, baseUrl + chapter.url)))

    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        return super.fetchSearchManga(page, query, filters)
    }

    override fun getFilterList() = ExtStatus.prepend(
        "toki",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어를 넣으면 소설 전체에서 제목 검색"),
                Filter.Header("본문은 회차를 연 뒤 \"WebView에서 열기\"로 읽기"),
                Pick("목록", "list", LISTS),
                Pick("정렬", "sort", SORTS),
                Pick("장르", "g", GENRES),
                Pick("플랫폼", "p", PLATFORMS),
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    private fun pathOf(href: String): String =
        Regex("^https?://[^/]+(/.*)$").find(href)?.groupValues?.get(1) ?: href

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://sbxh9.com"
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^sbxh\\d+\\.com$")
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val NOVEL_PATH = Regex("^/novel/(\\d+)/?$")

        private val LISTS = listOf(
            "소설 (아래 정렬·장르·플랫폼 적용)" to "/novel",
            "완결소설" to "/novel-end",
            "소설 업데이트" to "/novel/updates",
            "랭킹 일간" to "rank:day",
            "랭킹 주간" to "rank:week",
            "랭킹 월간" to "rank:month",
        )
        private val SORTS = listOf(
            "업데이트순" to "new", "신작순" to "fresh", "인기순" to "hot",
            "조회순" to "views", "평점순" to "rating", "회차 많은 순" to "episodes",
        )
        private val GENRES = listOf(
            "전체" to "", "판타지" to "fantasy", "무협" to "wuxia", "현대" to "modern",
            "로맨스" to "romance", "로맨스 판타지" to "romance_fantasy", "BL" to "bl",
            "라노벨" to "light_novel", "19금" to "adult19", "기타" to "etc",
        )
        private val PLATFORMS = listOf(
            "전체" to "", "문피아" to "munpia", "노벨피아" to "novelpia", "카카오페이지" to "kakaopage",
            "네이버 시리즈" to "series", "리디" to "ridi", "조아라" to "joara", "북토끼" to "booktoki",
            "직접 업로드" to "user", "기타" to "etc",
        )
    }
}
