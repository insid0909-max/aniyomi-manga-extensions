package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import rx.Observable

/**
 * 북코 소설 (###.bookkor.com) - Laravel + Inertia 사이트라 페이지마다 <script data-page="app"> 에 화면 데이터(JSON)가 들어 있음.
 * 애니요미는 소설 화면이 없으므로, 본문 글자를 그림(페이지)으로 그려서 보여 준다 (글자 크기·테마는 확장 설정).
 */
class Bookkor : HttpSource(), ConfigurableSource {

    override val name = "북코 소설"

    override val id: Long = uniqueSourceId("newxtoon.bookkor/ko/1")
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    private fun pref(key: String, def: String): String = try {
        sp.getString(key, def) ?: def
    } catch (e: Throwable) {
        def
    }

    private val userAgent: String
        get() {
            val custom = pref(KEY_UA, "").trim()
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
            val v = pref(KEY_DOMAIN, "").trim().trimEnd('/')
            return if (DOMAIN_REGEX.matches(v)) DomainGuard.preferDefault(v, DEFAULT) else DEFAULT
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

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> renderIntercept(chain) ?: domainIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, "data-page="))
        .build()

    // ---------- 주소 자동 찾기 ----------
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
        if (ours && res.code >= 500) {
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
        Regex("^(\\d+)\\.bookkor").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 현재 번호 주변(-3 ~ +30)의 ###.bookkor.com 중 사이트가 열리는 주소를 찾음 (가장 큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT.substringAfter("://"))
        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val ua = userAgent
        val pool = java.util.concurrent.Executors.newFixedThreadPool(10)
        try {
            val futures = ((cur - 3).coerceAtLeast(1)..(cur + 30)).map { "%03d.bookkor.com".format(it) }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (!HOST_REGEX.matches(fh) || res.code != 200) return@use null
                                if (res.body?.string().orEmpty().contains("data-page=\"app\"")) fh else null
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
        ListPreference(screen.context).apply {
            key = KEY_FONT
            title = "글자 크기"
            entries = FONT_SIZES.map { it.first }.toTypedArray()
            entryValues = FONT_SIZES.map { it.second }.toTypedArray()
            setDefaultValue("44")
            summary = "%s (바꾼 뒤 회차를 다시 열면 바로 적용)"
        }.also(screen::addPreference)

        ListPreference(screen.context).apply {
            key = KEY_THEME
            title = "본문 테마"
            entries = THEMES.map { it.first }.toTypedArray()
            entryValues = THEMES.map { it.second }.toTypedArray()
            setDefaultValue("dark")
            summary = "%s"
        }.also(screen::addPreference)

        ListPreference(screen.context).apply {
            key = KEY_LINE
            title = "줄 간격"
            entries = LINE_SPACINGS.map { it.first }.toTypedArray()
            entryValues = LINE_SPACINGS.map { it.second }.toTypedArray()
            setDefaultValue("1.6")
            summary = "%s"
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_GAP
            title = "문단 사이 빈 줄"
            summary = "문단마다 한 줄씩 띄워서 보기"
            setDefaultValue(true)
        }.also(screen::addPreference)

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
            summary = "주소 번호가 바뀌어 접속이 안 되면 ###.bookkor.com 중 열리는 주소로 자동 변경"
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

    // ---------- 화면 데이터(JSON) ----------
    private fun Response.props(): JSONObject = use {
        val body = it.body?.string().orEmpty()
        val m = PAGE_JSON.find(body) ?: throw Exception("페이지 데이터를 찾을 수 없습니다 (상태 ${it.code})")
        JSONObject(m.groupValues[1]).getJSONObject("props")
    }

    private fun fetchProps(url: String): JSONObject = client.newCall(GET(url, headers)).execute().props()

    private fun seg(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun thumb(t: String?): String? {
        if (t.isNullOrEmpty() || t == "null") return null
        if (t.startsWith("http")) return t
        return "$baseUrl/storage/" + t.removePrefix("/").removePrefix("storage/")
    }

    private fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k)

    private fun toManga(c: JSONObject) = SManga.create().apply {
        url = "/" + seg(c.str("slug"))
        title = c.str("title")
        thumbnail_url = thumb(c.str("thumbnail"))
    }

    // ---------- 목록 ----------
    private fun listUrl(menu: String, page: Int, keyword: String, genres: List<String>, status: String, sort: String): String {
        val q = mutableListOf<String>()
        if (keyword.isNotEmpty()) q.add("keyword=" + seg(keyword))
        genres.forEachIndexed { i, g -> q.add("genres%5B$i%5D=" + seg(g)) }
        if (status.isNotEmpty()) q.add("status=" + seg(status))
        if (sort.isNotEmpty() && sort != "latest") q.add("sort=" + seg(sort))
        if (page > 1) q.add("page=$page")
        return "$baseUrl/" + (if (menu.isEmpty()) "" else seg(menu)) + if (q.isEmpty()) "" else "?" + q.joinToString("&")
    }

    private fun parseComics(props: JSONObject): MangasPage {
        val c = props.optJSONObject("comics") ?: return MangasPage(emptyList(), false)
        val data = c.optJSONArray("data") ?: JSONArray()
        val list = (0 until data.length()).map { toManga(data.getJSONObject(it)) }.filter { it.title.isNotEmpty() }
        return MangasPage(list, !c.isNull("next_page_url"))
    }

    /** 사이트의 "실시간 인기순위"(작품 페이지 옆 목록)를 인기 탭으로 씀 */
    override fun fetchPopularManga(page: Int): Observable<MangasPage> {
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { return fetchSearchManga(page, "", it) }
        return Observable.fromCallable {
            val home = fetchProps("$baseUrl/")
            val first = home.optJSONObject("comics")?.optJSONArray("data")?.optJSONObject(0)
            val pop = first?.let { fetchProps("$baseUrl/" + seg(it.str("slug"))).optJSONArray("popular") }
            if (pop == null || pop.length() == 0) {
                parseComics(home)
            } else {
                MangasPage((0 until pop.length()).map { toManga(pop.getJSONObject(it)) }.filter { it.title.isNotEmpty() }, false)
            }
        }
    }

    override fun popularMangaRequest(page: Int) = GET("$baseUrl/", headers)
    override fun popularMangaParse(response: Response) = parseComics(response.props())

    override fun latestUpdatesRequest(page: Int) = GET(listUrl("", page, "", emptyList(), "", "latest"), headers)
    override fun latestUpdatesParse(response: Response) = parseComics(response.props())

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        var menu = ""
        var status = ""
        var sort = "latest"
        val genres = mutableListOf<String>()
        filters.forEach { f ->
            when (f) {
                is Pick -> when (f.param) {
                    "menu" -> menu = f.pairs[f.state].second
                    "status" -> status = f.pairs[f.state].second
                    "sort" -> sort = f.pairs[f.state].second
                }
                is GenreBox -> if (f.state) genres.add(f.name)
                else -> {}
            }
        }
        val keyword = query.trim()
        if (keyword.isNotEmpty()) menu = ""
        return GET(listUrl(menu, page, keyword, genres, status, sort), headers)
    }

    override fun searchMangaParse(response: Response) = parseComics(response.props())

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val c = response.props().optJSONObject("comic") ?: JSONObject()
        return SManga.create().apply {
            title = c.str("title")
            thumbnail_url = thumb(c.str("thumbnail"))
            author = c.str("author").ifEmpty { null }
            description = c.str("description")
            val tags = c.optJSONArray("tags") ?: JSONArray()
            genre = (0 until tags.length()).mapNotNull { i ->
                val n = tags.getJSONObject(i).opt("name")
                (if (n is JSONObject) n.optString("ko") else n?.toString())?.takeIf { it.isNotEmpty() }
            }.distinct().joinToString(", ")
            status = when (c.optJSONObject("metadata")?.optString("ntk_status")) {
                "completed" -> SManga.COMPLETED
                "ongoing" -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    // ---------- 회차 (100화씩 나뉜 목록을 모두 받음) ----------
    override fun chapterListRequest(manga: SManga): Request = GET(baseUrl + manga.url, headers)

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun chapterListParse(response: Response): List<SChapter> {
        val path = response.request.url.encodedPath
        val props = response.props()
        val slug = props.optJSONObject("comic")?.str("slug").orEmpty()
        val seen = HashSet<String>()
        val out = ArrayList<SChapter>()
        fun add(eps: JSONObject?): Int {
            val data = eps?.optJSONArray("data") ?: return 0
            var n = 0
            for (i in 0 until data.length()) {
                val e = data.getJSONObject(i)
                val url = "/" + seg(slug) + "/" + seg(e.str("slug"))
                if (!seen.add(url)) continue
                n++
                out.add(
                    SChapter.create().apply {
                        this.url = url
                        name = e.str("title").ifEmpty { "${e.optInt("sort")}화" }
                        chapter_number = e.optDouble("sort", -1.0).toFloat()
                        date_upload = try {
                            dateFmt.parse(e.str("published_at").take(19))?.time ?: 0L
                        } catch (x: Exception) {
                            0L
                        }
                    },
                )
            }
            return n
        }
        val first = props.optJSONObject("episodes")
        add(first)
        val last = (first?.optInt("last_page") ?: 1).coerceAtMost(100)
        for (p in 2..last) {
            val more = try {
                fetchProps("$baseUrl$path?page=$p").optJSONObject("episodes")
            } catch (e: Exception) {
                break
            }
            if (add(more) == 0) break
        }
        return out
    }

    // ---------- 본문 → 그림 페이지 ----------
    private class Doc(val title: String, val text: String)

    private val docCache = object : LinkedHashMap<String, Doc>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Doc>?) = size > 6
    }

    private fun loadDoc(chapterPath: String): Doc {
        val cacheKey = "$chapterPath|${gap()}"
        synchronized(docCache) { docCache[cacheKey] }?.let { return it }
        val ep = fetchProps(baseUrl + chapterPath).optJSONObject("episode") ?: throw Exception("회차 정보를 찾을 수 없습니다")
        val body = ep.optJSONObject("body")
        val raw = body?.let { it.str("html").ifEmpty { it.str("text") } }.orEmpty()
        val paragraphs = if (body?.str("type").let { it.isNullOrEmpty() || it == "html" }) {
            Jsoup.parse(raw).body().let { b ->
                b.select("p, div, br").forEach { if (it.tagName() == "br") it.after("\n") }
                b.select("p").map { it.text().trim() }.ifEmpty { b.wholeText().split("\n").map { it.trim() } }
            }
        } else {
            raw.split("\n").map { it.trim() }
        }
        val text = paragraphs.filter { it.isNotEmpty() }.joinToString(if (gap()) "\n\n" else "\n")
        if (text.isEmpty()) throw Exception("본문이 비어 있습니다")
        return Doc(ep.str("title"), text).also { synchronized(docCache) { docCache[cacheKey] = it } }
    }

    private fun gap(): Boolean = try {
        sp.getBoolean(KEY_GAP, true)
    } catch (e: Throwable) {
        true
    }

    private fun fontPx(): Float = pref(KEY_FONT, "44").toFloatOrNull()?.coerceIn(24f, 96f) ?: 44f

    private fun lineMult(): Float = pref(KEY_LINE, "1.6").toFloatOrNull()?.coerceIn(1.0f, 3.0f) ?: 1.6f

    private fun colors(): Pair<Int, Int> = when (pref(KEY_THEME, "dark")) {
        "light" -> Color.rgb(250, 250, 248) to Color.rgb(34, 34, 34)
        "sepia" -> Color.rgb(244, 236, 216) to Color.rgb(68, 52, 36)
        "black" -> Color.rgb(0, 0, 0) to Color.rgb(200, 200, 200)
        "gray" -> Color.rgb(58, 60, 64) to Color.rgb(230, 230, 230)
        "green" -> Color.rgb(204, 232, 207) to Color.rgb(36, 50, 38)
        "navy" -> Color.rgb(22, 30, 46) to Color.rgb(214, 222, 235)
        else -> Color.rgb(24, 24, 24) to Color.rgb(222, 222, 222)
    }

    /** 설정이 바뀌면 그림 주소도 바뀌도록 (앱이 저장해 둔 예전 그림을 다시 쓰지 않게) */
    private fun styleKey(): String = "f${fontPx().toInt()}-${pref(KEY_THEME, "dark")}-l${lineMult()}-g${if (gap()) 1 else 0}"

    /** 제목 + 본문을 한 덩어리로 배치하고, 페이지 높이에 맞춰 줄 단위로 나눈 시작 줄 목록 */
    private fun layout(doc: Doc): Pair<StaticLayout, List<Int>> {
        val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
            textSize = fontPx()
            color = colors().second
        }
        val width = PAGE_W - PAD * 2
        val full = "${doc.title}\n\n${doc.text}"
        @Suppress("DEPRECATION")
        val sl = StaticLayout(full, paint, width, Layout.Alignment.ALIGN_NORMAL, lineMult(), 0f, false)
        val starts = mutableListOf(0)
        val usable = PAGE_H - PAD * 2
        var top = 0
        for (line in 0 until sl.lineCount) {
            if (sl.getLineBottom(line) - top > usable) {
                starts.add(line)
                top = sl.getLineTop(line)
            }
        }
        return sl to starts
    }

    override fun fetchPageList(chapter: SChapter): Observable<List<Page>> = Observable.fromCallable {
        val (_, starts) = layout(loadDoc(chapter.url))
        val key = seg(chapter.url)
        val style = styleKey()
        starts.indices.map { i -> Page(i, baseUrl + chapter.url, "https://$RENDER_HOST/$key/$i?s=$style") }
    }

    /** 그림 페이지 주소면 직접 그려서 PNG 로 돌려줌 */
    private fun renderIntercept(chain: okhttp3.Interceptor.Chain): Response? {
        val req = chain.request()
        if (req.url.host != RENDER_HOST) return null
        val parts = req.url.encodedPath.trim('/').split('/')
        val chapterPath = URLDecoder.decode(parts.getOrNull(0).orEmpty(), "UTF-8")
        val index = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val (sl, starts) = layout(loadDoc(chapterPath))
        val (bg, _) = colors()
        val bmp = Bitmap.createBitmap(PAGE_W, PAGE_H, Bitmap.Config.RGB_565)
        val canvas = Canvas(bmp)
        canvas.drawColor(bg)
        if (index < starts.size) {
            val firstLine = starts[index]
            val endLine = if (index + 1 < starts.size) starts[index + 1] else sl.lineCount
            val top = sl.getLineTop(firstLine)
            val bottom = sl.getLineTop(endLine)
            canvas.save()
            canvas.translate(PAD.toFloat(), (PAD - top).toFloat())
            canvas.clipRect(0, top, PAGE_W - PAD * 2, bottom)
            sl.draw(canvas)
            canvas.restore()
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        return Response.Builder()
            .request(req)
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body(out.toByteArray().toResponseBody("image/png".toMediaType()))
            .build()
    }

    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- Popular/Latest 규칙 + 필터 ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 사이트 주소 → 작품 주소 (모르는 모양이면 null) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        u.pathSegments.firstOrNull { it.isNotEmpty() }?.let { "/$it" }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    override fun getFilterList() = ExtStatus.prepend(
        "bookkor",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                listOf(
                    Filter.Header("검색어를 넣으면 제목 검색 (메뉴 선택은 무시)"),
                    Pick("메뉴", "menu", MENUS),
                    Pick("상태", "status", STATUSES),
                    Pick("정렬", "sort", SORTS),
                    Filter.Header("장르 (여러 개 선택 가능)"),
                ) + GENRES.map { GenreBox(it) },
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    class GenreBox(name: String) : Filter.CheckBox(name)

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val KEY_FONT = "pref_font_px"
        private const val KEY_THEME = "pref_theme"
        private const val KEY_GAP = "pref_paragraph_gap"
        private const val KEY_LINE = "pref_line_spacing"
        private const val DEFAULT = "https://002.bookkor.com"
        private const val RENDER_HOST = "bookkor-render.local"
        private const val PAGE_W = 1080
        private const val PAGE_H = 1800
        private const val PAD = 64
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^\\d+\\.bookkor\\.com$")
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val PAGE_JSON = Regex("<script[^>]*data-page=\"app\"[^>]*>([\\s\\S]*?)</script>")

        private val MENUS = listOf(
            "전체 (아래 장르·상태·정렬 적용)" to "",
            "일반소설" to "일반소설",
            "성인소설" to "성인소설",
            "BL/GL" to "BLGL",
            "완결소설" to "완결소설",
        )
        private val STATUSES = listOf("전체" to "", "연재중" to "연재중", "완결" to "완결")
        private val SORTS = listOf("최신" to "latest", "북마크" to "bookmark", "조회수" to "views", "평점" to "rating")
        private val GENRES = listOf(
            "판타지", "무협", "19금", "현대", "로맨스", "로맨스 판타지", "BL", "라노벨", "드라마", "기타",
        )
        private val FONT_SIZES = listOf(
            "아주 작게" to "32", "작게" to "38", "보통" to "44", "조금 크게" to "50",
            "크게" to "56", "아주 크게" to "64", "최대" to "74",
        )
        private val THEMES = listOf(
            "어둡게 (진회색)" to "dark", "검정 (OLED)" to "black", "회색" to "gray", "남색" to "navy",
            "밝게 (흰색)" to "light", "세피아 (종이)" to "sepia", "연두 (눈 보호)" to "green",
        )
        private val LINE_SPACINGS = listOf("좁게" to "1.3", "보통" to "1.6", "넓게" to "1.9", "아주 넓게" to "2.2")
    }
}
