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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import rx.Observable

/**
 * 마루마루 (marumaru###.com) - 화면은 React 앱이고 목록·작품은 사이트의 /api/works, 회차·본문은 api.storagewebtoon.store 에서 JSON 으로 받음.
 * 웹툰·만화·소설 세 소스가 주소·자동 찾기·User-Agent 설정을 같이 씀 (웹툰 소스 저장소).
 * 소설은 본문 글자를 그림(페이지)으로 그려서 보여 줌 (북코 소설과 같은 방식, 글자 크기·테마는 소설 소스 설정).
 */
class Marumaru(private val media: String = WEBTOON) : HttpSource(), ConfigurableSource {

    private val novel = media == NOVEL
    private val section = when (media) {
        MANHWA -> "manhwa"
        NOVEL -> "novel"
        else -> "webtoon"
    }

    override val name = when (media) {
        MANHWA -> "마루마루 만화"
        NOVEL -> "마루마루 소설"
        else -> "마루마루 웹툰"
    }

    override val id: Long = uniqueSourceId(
        when (media) {
            MANHWA -> "newxtoon.marumaru/ko/2"
            NOVEL -> "newxtoon.marumaru/ko/3"
            else -> BASE_KEY
        },
    )
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }

    /** 주소·자동 찾기·User-Agent: 세 소스가 같이 씀 */
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_${uniqueSourceId(BASE_KEY)}", 0) }

    /** 회차 이름 표시·소설 글자 설정: 소스마다 따로 */
    private val own: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    private fun pref(key: String, def: String): String = try {
        own.getString(key, def) ?: def
    } catch (e: Throwable) {
        def
    }

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

    // 직접 넣은 주소는 바로, 더 새 주소가 확인되면 자동으로 바뀜 (DomainGuard.pick)
    override val baseUrl: String
        get() = DomainGuard.pick(runCatching { sp }.getOrNull(), KEY_DOMAIN, DEFAULT, autoDomain(), { DOMAIN_REGEX.matches(it) })

    private fun autoDomain(): Boolean = try {
        sp.getBoolean(KEY_AUTO, true)
    } catch (e: Throwable) {
        true
    }

    private fun saveDomain(url: String) {
        try {
            DomainGuard.saveAuto(sp, KEY_DOMAIN, url)
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    // 주소 번호가 바뀌어 접속이 안 되면 자동으로 새 주소를 찾아 다시 요청
    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        // 맨 바깥: 오류를 쉬운 말로, 그다음: 실패한 그림 한 번 더 받기
        .apply { interceptors().add(0, FriendlyErrors) }
        .apply { interceptors().add(1, ImageRetry) }
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> renderIntercept(chain) ?: domainIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, MARKER))
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
        // 옛 주소가 사이트 대신 다른 화면(주차 페이지 등)을 주면 API 가 JSON 이 아니게 됨
        val notApi = ours && res.code == 200 && req.url.encodedPath.startsWith("/api/") &&
            res.header("Content-Type").orEmpty().contains("html", ignoreCase = true)
        if (ours && (res.code >= 500 || notApi)) {
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
        Regex("marumaru(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 현재 번호 주변(-3 ~ +30)의 marumaru#.com 중 사이트가 열리는 주소를 찾음 (가장 큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT)
        val tld = currentHost.substringAfterLast('.', "com")
        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val ua = userAgent
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        try {
            val futures = ((cur - 3).coerceAtLeast(1)..(cur + 30)).map { "marumaru$it.$tld" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (!HOST_REGEX.matches(fh) || res.code != 200) return@use null
                                if (res.peekBody(300_000).string().contains(MARKER)) fh else null
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
        // 만화·소설 소스 설정 화면에서 바꿔도 웹툰 소스와 같은 저장소(sp)에 써서 세 소스가 같이 씀
        val shared = media != WEBTOON
        fun share(key: String, v: Any?) {
            if (!shared) return
            try {
                when (v) {
                    is String -> sp.edit().putString(key, v).apply()
                    is Boolean -> sp.edit().putBoolean(key, v).apply()
                }
            } catch (e: Throwable) {
                // 저장 실패는 무시
            }
        }
        val same = if (shared) " (웹툰 소스와 같이 씀)" else ""
        ChapterPosition.addPref(screen)
        if (novel) addNovelPrefs(screen)

        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소$same"
            summary = "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 주소가 확인되면 자동으로 바뀜 (기본: $DEFAULT)"
            dialogTitle = "도메인 주소"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                val s = (v as String).trim().trimEnd('/')
                val ok = s.isEmpty() || DOMAIN_REGEX.matches(s)
                if (ok) share(KEY_DOMAIN, s)
                ok
            }
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기$same"
            summary = "주소 번호가 바뀌어 접속이 안 되면 marumaru###.com 중 열리는 주소로 자동 변경"
            setDefaultValue(if (shared) autoDomain() else true)
            setOnPreferenceChangeListener { _, v ->
                share(KEY_AUTO, v)
                true
            }
        }.also(screen::addPreference)

        EditTextPreference(screen.context).apply {
            key = KEY_UA
            title = "User-Agent (고급)$same"
            summary = "비워두면 폰 WebView 기준으로 자동 설정. 변경 후 앱 재시작 필요"
            dialogTitle = "User-Agent"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                share(KEY_UA, v)
                true
            }
        }.also(screen::addPreference)
    }

    private fun addNovelPrefs(screen: PreferenceScreen) {
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
    }

    // ---------- JSON ----------
    private fun Response.json(): JSONObject = use {
        val body = it.body?.string().orEmpty()
        if (!body.trimStart().startsWith("{")) throw Exception("사이트 응답을 읽을 수 없습니다 (상태 ${it.code})")
        JSONObject(body)
    }

    private fun fetchJson(url: String): JSONObject = client.newCall(GET(url, headers)).execute().json()

    private fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k)

    private fun toManga(w: JSONObject) = SManga.create().apply {
        url = "/$section/${w.optLong("id")}"
        title = w.str("title")
        thumbnail_url = w.str("thumbUrl").ifEmpty { w.str("coverUrl") }.ifEmpty { null }
    }

    private fun parseWorks(o: JSONObject, page: Int): MangasPage {
        val items = o.optJSONArray("items") ?: JSONArray()
        val list = (0 until items.length()).map { toManga(items.getJSONObject(it)) }.filter { it.title.isNotEmpty() }
        val size = o.optInt("size", items.length()).coerceAtLeast(1)
        return MangasPage(list, list.isNotEmpty() && page.toLong() * size < o.optLong("total"))
    }

    // ---------- 목록 ----------
    private class Query(
        var category: String = "",
        var completed: Boolean = false,
        var sort: String = "",
        var weekday: String = "",
        var platform: String = "",
        var genre: String = "",
        var initial: String = "",
    )

    /** /api/works?mediaType=…&page=(0부터)&size=… + 분류·정렬·요일·플랫폼·장르·초성 */
    private fun worksUrl(q: Query, page: Int): String {
        val b = "$baseUrl/api/works".toHttpUrl().newBuilder()
            .addQueryParameter("mediaType", media)
        when (q.category) {
            "ADULT" -> b.addQueryParameter("adult", "true")
            "BLGL" -> b.addQueryParameter("blgl", "true")
            "ALL" -> {}
            // 사이트처럼 웹툰 기본 목록은 BL/GL 을 뺌 (완결 목록은 전체)
            else -> if (media == WEBTOON && !q.completed) b.addQueryParameter("blgl", "false")
        }
        if (q.completed) b.addQueryParameter("completed", "true")
        listOf("weekday" to q.weekday, "initial" to q.initial, "platform" to q.platform, "genre" to q.genre, "sort" to q.sort)
            .forEach { (k, v) -> if (v.isNotEmpty()) b.addQueryParameter(k, v) }
        b.addQueryParameter("page", (page - 1).toString())
        b.addQueryParameter("size", PAGE_SIZE.toString())
        return b.build().toString()
    }

    override fun popularMangaRequest(page: Int) = GET(worksUrl(Query(sort = "VIEW"), page), headers)
    override fun latestUpdatesRequest(page: Int) = GET(worksUrl(Query(sort = "LATEST"), page), headers)

    private fun pageOf(response: Response): Int =
        (response.request.url.queryParameter("page")?.toIntOrNull() ?: 0) + 1

    override fun popularMangaParse(response: Response) = pageOf(response).let { parseWorks(response.json(), it) }
    override fun latestUpdatesParse(response: Response) = pageOf(response).let { parseWorks(response.json(), it) }
    override fun searchMangaParse(response: Response) = pageOf(response).let { parseWorks(response.json(), it) }

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        val q = Query()
        var status = ""
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                when (f.param) {
                    "category" -> q.category = v
                    "status" -> status = v
                    "sort" -> q.sort = v
                    "weekday" -> q.weekday = v
                    "platform" -> q.platform = v
                    "genre" -> q.genre = v
                    "initial" -> q.initial = v
                }
            }
        }
        val keyword = query.trim()
        if (keyword.isNotEmpty()) {
            // 검색: 정렬은 최신·북마크·조회·화수만, 상태는 연재/완결
            val b = "$baseUrl/api/search".toHttpUrl().newBuilder()
                .addQueryParameter("q", keyword)
                .addQueryParameter("page", (page - 1).toString())
                .addQueryParameter("media", media)
                .addQueryParameter("sort", q.sort.takeIf { it in SEARCH_SORTS } ?: "LATEST")
            when (status) {
                "completed" -> b.addQueryParameter("status", "COMPLETED")
                "ongoing" -> b.addQueryParameter("status", "ON")
            }
            return GET(b.build().toString(), headers)
        }
        // 목록에는 "완결"만 있음 (연재중만 고르는 값은 사이트에 없음)
        q.completed = status == "completed"
        return GET(worksUrl(q, page), headers)
    }

    // ---------- 상세 ----------
    private fun workId(url: String): String = url.trim('/').split('/').getOrNull(1).orEmpty()

    override fun getMangaUrl(manga: SManga): String = baseUrl + manga.url

    override fun getChapterUrl(chapter: SChapter): String = baseUrl + chapter.url

    override fun mangaDetailsRequest(manga: SManga) = GET("$baseUrl/api/works/${workId(manga.url)}", headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val o = response.json()
        val w = o.optJSONObject("work") ?: JSONObject()
        return SManga.create().apply {
            title = w.str("title")
            thumbnail_url = w.str("coverUrl").ifEmpty { w.str("thumbUrl") }.ifEmpty { null }
            author = w.str("author").ifEmpty { null }
            artist = o.str("illustrator").ifEmpty { null }
            genre = w.str("genres").split(",").map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                .joinToString(", ").ifEmpty { null }
            val info = listOfNotNull(
                w.str("platform").ifEmpty { null },
                WEEKDAY_NAMES[w.str("weekday")]?.let { "${it}요일" },
                w.optInt("episodeCount").takeIf { it > 0 }?.let { "총 ${it}화" },
            ).joinToString(" · ")
            description = listOf(o.str("synopsis").trim(), info).filter { it.isNotEmpty() }.joinToString("\n\n").ifEmpty { null }
            status = when (w.str("status")) {
                "SERIALIZING" -> SManga.ONGOING
                "COMPLETED" -> SManga.COMPLETED
                "HIATUS" -> SManga.ON_HIATUS
                else -> SManga.UNKNOWN
            }
        }
    }

    // ---------- 회차 (100화씩 나뉜 목록을 모두 받음) ----------
    override fun chapterListRequest(manga: SManga): Request =
        GET("$READER/works/${workId(manga.url)}?page=1&size=100&order=asc", headers)

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    private fun dateOf(text: String): Long = try {
        dateFmt.parse(text.take(19))?.time ?: 0L
    } catch (e: Exception) {
        0L
    }

    // 최신 화부터, 회차 이름 끝에 남은 화 수 ("51화 · 남은 102화")
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            val sorted = it.sortedByDescending { c -> c.chapter_number }
            if (ChapterPosition.enabled(own)) ChapterPosition.label(sorted, manga.title) else sorted
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val reqUrl = response.request.url
        val wid = reqUrl.pathSegments.lastOrNull().orEmpty()
        val first = response.json()
        val work = first.optJSONObject("item")?.str("title").orEmpty()
        val seen = HashSet<String>()
        val out = ArrayList<SChapter>()
        fun add(o: JSONObject): Int {
            val eps = o.optJSONArray("episodes") ?: return 0
            var n = 0
            for (i in 0 until eps.length()) {
                val e = eps.getJSONObject(i)
                if (e.has("ready") && !e.optBoolean("ready", true)) continue
                val url = "/$section/$wid/${e.optLong("id")}"
                if (!seen.add(url)) continue
                n++
                val num = e.optDouble("number", -1.0)
                out.add(
                    SChapter.create().apply {
                        this.url = url
                        name = epName(num, e.str("title"), work)
                        chapter_number = num.toFloat()
                        date_upload = dateOf(e.str("published_at"))
                    },
                )
            }
            return n
        }
        add(first)
        val pages = ((first.optInt("total") + 99) / 100).coerceAtMost(100)
        for (p in 2..pages) {
            val more = try {
                fetchJson(reqUrl.newBuilder().setQueryParameter("page", p.toString()).build().toString())
            } catch (e: Exception) {
                break
            }
            if (add(more) == 0) break
        }
        return out
    }

    /**
     * 회차 이름: 사이트 제목 그대로 ("59화 - 부제", "33-1화"). 단 앞에 (잘린) 작품 제목이 붙어 있으면 그 뒤 "N화"부터
     * ("여사친은 부탁하면 …외로 대준다 1화" → "1화"), 제목에 화 번호가 없으면 "N화 제목"
     */
    private fun epName(num: Double, title: String, work: String = ""): String {
        val t = title.trim()
        val w = work.trim()
        if (num < 0) return t.ifEmpty { "회차" }
        val n = if (num == Math.floor(num)) num.toLong().toString() else num.toString()
        EP_REGEX.find(t)?.let { m ->
            val start = m.groups[2]!!.range.first
            val head = t.substring(0, start).trim()
            val cut = head.isNotEmpty() && (head.contains('…') || (w.isNotEmpty() && (w.startsWith(head) || head.startsWith(w))))
            return if (cut) t.substring(start) else t
        }
        return if (t.isEmpty() || t == w) "${n}화" else "${n}화 $t"
    }

    // ---------- 그림 (웹툰·만화) ----------
    private fun episodeJson(chapterUrl: String): JSONObject {
        val ep = chapterUrl.trim('/').split('/').lastOrNull().orEmpty()
        val item = fetchJson("$READER/episodes/$ep").optJSONObject("item") ?: throw Exception("회차 정보를 찾을 수 없습니다")
        // 사이트에서 포인트로 사야 하는 회차 (확장으로는 볼 수 없음)
        val body = item.optJSONArray("body")
        if (body != null && (0 until body.length()).any { body.optJSONObject(it)?.str("kind") == "paid" }) {
            throw Exception("이 회차는 사이트에서 포인트로 사야 볼 수 있어요 (확장으로는 볼 수 없음)")
        }
        return item
    }

    override fun fetchPageList(chapter: SChapter): Observable<List<Page>> = Observable.fromCallable {
        if (novel) return@fromCallable novelPages(chapter)
        val body = episodeJson(chapter.url).optJSONArray("body") ?: JSONArray()
        val urls = (0 until body.length()).mapNotNull { i ->
            val b = body.optJSONObject(i) ?: return@mapNotNull null
            b.str("url").takeIf { b.str("kind").let { k -> k.isEmpty() || k == "image" } && it.startsWith("http") }
        }.distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (준비 중인 회차일 수 있어요)")
        urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 소설 본문 → 그림 페이지 ----------
    private class Doc(val title: String, val text: String)

    private val docCache = object : LinkedHashMap<String, Doc>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Doc>?) = size > 6
    }

    private fun loadDoc(chapterPath: String): Doc {
        val cacheKey = "$chapterPath|${gap()}"
        synchronized(docCache) { docCache[cacheKey] }?.let { return it }
        val item = episodeJson(chapterPath)
        // 본문: embed_url 의 글자 파일 (웹툰처럼 회차 API 주소면 body 의 글 조각)
        val raw = item.str("embed_url").takeIf { it.startsWith("http") && !it.contains("/reader/") }?.let { u ->
            client.newCall(GET(u, headers)).execute().use { r ->
                if (!r.isSuccessful) throw Exception("본문을 받지 못했습니다 (HTTP ${r.code})")
                String(r.body?.bytes() ?: ByteArray(0), Charsets.UTF_8)
            }
        } ?: item.optJSONArray("body")?.let { arr ->
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.str("text") }.joinToString("\n")
        }.orEmpty()
        val text = raw.replace("\r", "").split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            .joinToString(if (gap()) "\n\n" else "\n")
        if (text.isEmpty()) throw Exception("본문이 비어 있습니다")
        val num = item.optDouble("number", -1.0)
        return Doc(epName(num, item.str("title")), text).also { synchronized(docCache) { docCache[cacheKey] = it } }
    }

    private fun gap(): Boolean = try {
        own.getBoolean(KEY_GAP, true)
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

    private fun novelPages(chapter: SChapter): List<Page> {
        val (_, starts) = layout(loadDoc(chapter.url))
        val key = URLEncoder.encode(chapter.url, "UTF-8")
        val style = styleKey()
        return starts.indices.map { i -> Page(i, baseUrl + chapter.url, "https://$RENDER_HOST/$key/$i?s=$style") }
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

    // ---------- Popular/Latest 규칙 + 필터 ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 사이트 주소 → 작품 주소 (/webtoon/번호, 회차 주소면 작품까지만). 다른 분류 주소는 이 소스에서 안 엶 */
    private fun urlToManga(u: okhttp3.HttpUrl): String? {
        val seg = u.pathSegments.filter { it.isNotEmpty() }
        if (seg.size < 2 || seg[0] != section || seg[1].toLongOrNull() == null) return null
        return "/$section/${seg[1]}"
    }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    override fun getFilterList(): FilterList {
        val list = mutableListOf<Filter<*>>(
            Filter.Header("검색어를 넣으면 제목 검색 (정렬 최신·북마크·조회·화수, 상태만 적용)"),
        )
        when (media) {
            WEBTOON -> {
                list.add(Pick("분류", "category", WEBTOON_CATEGORIES))
                list.add(Pick("상태", "status", STATUSES))
                list.add(Pick("정렬", "sort", SORTS))
                list.add(Pick("요일", "weekday", WEEKDAYS))
                list.add(Pick("플랫폼", "platform", options(WEBTOON_PLATFORMS)))
                list.add(Pick("장르", "genre", options(WEBTOON_GENRES)))
            }
            MANHWA -> {
                list.add(Pick("분류", "category", CATEGORIES))
                list.add(Pick("상태", "status", STATUSES))
                list.add(Pick("정렬", "sort", SORTS))
                list.add(Pick("플랫폼", "platform", options(MANHWA_PLATFORMS)))
                list.add(Pick("장르", "genre", options(MANHWA_GENRES)))
            }
            else -> {
                list.add(Pick("분류", "category", CATEGORIES))
                list.add(Pick("상태", "status", STATUSES))
                list.add(Pick("정렬", "sort", SORTS))
                list.add(Pick("장르", "genre", options(NOVEL_GENRES)))
            }
        }
        list.add(Pick("초성", "initial", options(INITIALS)))
        return ExtStatus.prepend(if (media == WEBTOON) "marumaru" else "marumaru_$section", baseUrl, autoDomain(), tabRules.attach(FilterList(list)))
    }

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    companion object {
        const val WEBTOON = "WEBTOON"
        const val MANHWA = "MANHWA"
        const val NOVEL = "NOVEL"
        private const val BASE_KEY = "newxtoon.marumaru/ko/1"
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val KEY_FONT = "pref_font_px"
        private const val KEY_THEME = "pref_theme"
        private const val KEY_GAP = "pref_paragraph_gap"
        private const val KEY_LINE = "pref_line_spacing"
        private const val DEFAULT = "https://marumaru106.com"
        private const val READER = "https://api.storagewebtoon.store/api/v1/reader/A2"
        private const val RENDER_HOST = "marumaru-render.local"

        /** 진짜 사이트 첫 화면에만 있는 글자 (로고 그림 주소) */
        private const val MARKER = "/assets/logo/marumaru"
        private const val PAGE_SIZE = 49
        private const val PAGE_W = 1080
        private const val PAGE_H = 1800
        private const val PAD = 64
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^(www\\.)?marumaru\\d+\\.[a-z]{2,6}$")
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val EP_REGEX = Regex("""(^|[^\d.-])(\d+(?:[-.]\d+)?\s*화)""")

        private fun options(names: List<String>) = listOf("전체" to "") + names.map { it to it }

        private val WEBTOON_CATEGORIES = listOf("일반 (BL/GL 제외)" to "", "전체" to "ALL", "BL/GL" to "BLGL", "성인" to "ADULT")
        private val CATEGORIES = listOf("전체" to "", "BL/GL" to "BLGL", "성인" to "ADULT")
        private val STATUSES = listOf("전체" to "", "완결" to "completed", "연재 중 (검색만)" to "ongoing")
        private val SORTS = listOf(
            "최신순" to "LATEST", "신작순" to "NEW", "북마크순" to "BOOKMARK",
            "조회순" to "VIEW", "평점순" to "RATING", "화수순" to "EPISODE",
        )
        private val SEARCH_SORTS = setOf("LATEST", "BOOKMARK", "VIEW", "EPISODE")
        private val WEEKDAYS = listOf(
            "전체" to "", "월" to "MON", "화" to "TUE", "수" to "WED", "목" to "THU", "금" to "FRI", "토" to "SAT", "일" to "SUN",
        )
        private val WEEKDAY_NAMES = WEEKDAYS.drop(1).associate { it.second to it.first }
        private val WEBTOON_PLATFORMS = listOf(
            "네이버", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹스", "케이툰", "피너툰", "봄툰", "코미코", "리디북스", "기타",
        )
        private val MANHWA_PLATFORMS = listOf(
            "네이버", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹스", "코믹GT", "케이툰", "애니툰", "폭스툰",
            "피너툰", "봄툰", "코미코", "무툰", "리디북스", "기타",
        )
        private val WEBTOON_GENRES = listOf(
            "판타지", "액션", "미스터리", "로맨스", "드라마", "무협", "스포츠", "일상", "학원", "성인",
            "개그", "연애", "추리", "공포", "옴니버스", "에피소드", "소년", "기타", "고수위",
        )
        private val MANHWA_GENRES = listOf(
            "순정", "판타지", "러브코미디", "드라마", "17", "학원", "라노벨", "개그", "액션", "백합", "일상", "SF", "이세계",
            "스릴러", "애니화", "전생", "스포츠", "TS", "소년", "먹방", "붕탁", "게임", "호러", "시대", "로맨스", "추리", "음악",
            "무협", "BL", "스토리", "BL/백합", "성인", "연애", "공포", "옴니버스", "에피소드", "기타", "고수위",
        )
        private val NOVEL_GENRES = listOf("판타지", "무협", "19금", "현대", "로맨스", "로맨스 판타지", "BL", "라노벨", "기타")
        private val INITIALS = listOf("ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ")
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
