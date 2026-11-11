package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.annotation.SuppressLint
import android.app.Application
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
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
import rx.Observable
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 토끼 소설 (뉴토끼 sbxh9.com 의 소설, 2026-11-10) — 망가요미 tokinovel.js 0.1.0 과 같은 방법.
 * 목록: /api/novel-list?q&g&p&t&sort&status&page&pageSize=40 → {novels:[{id,title,author,genre,thumbnailUrl}]}
 * 최신: /novel/updates 화면 안 self.__next_f 조각을 이은 글의 "allCards":[…] (novelId·novelTitle…)
 * 작품: /novel/{id} 화면(section.novel-detail), 회차: /api/novel/{id}/episodes/window?direction=older&cursor=… (커서로 이어 받음)
 * 본문: 사이트가 화면 안(그림자 DOM)에 그려서 보여 줌 → 숨은 WebView 로 회차 화면을 열어 다 그려진 문단을 받음(망가요미판과 같은 스크립트).
 * 애니요미는 소설 화면이 없으므로 북코 소설처럼 본문 글자를 그림(페이지)으로 그림 (글자 크기·테마는 설정).
 */
class TokiNovel : HttpSource(), ConfigurableSource {

    override val name = "토끼 소설"

    override val id: Long = uniqueSourceId("newxtoon.tokinovel/ko/1")
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

    // Cloudflare 통과 쿠키는 User-Agent 에 묶임 → 휴대폰 WebView 와 같은 값 (북코와 같음)
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

    // 직접 넣은 주소는 바로, 더 새 번호 주소가 확인되면 자동으로 바뀜 (DomainGuard.pick)
    override val baseUrl: String
        get() = DomainGuard.pick(runCatching { sp }.getOrNull(), KEY_DOMAIN, DEFAULT, autoDomain(), { DOMAIN_REGEX.matches(it) })

    private fun autoDomain(): Boolean = try {
        sp.getBoolean(KEY_AUTO, true)
    } catch (e: Throwable) {
        true
    }

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .apply { interceptors().add(0, FriendlyErrors) }
        .apply { interceptors().add(1, ImageRetry) }
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> renderIntercept(chain) ?: domainIntercept(chain) }
        .build()

    override fun headersBuilder(): Headers.Builder =
        super.headersBuilder().set("User-Agent", userAgent).set("Referer", "$baseUrl/")

    // ---------- 주소 자동 찾기 (연결 실패·5xx·451 일 때만, Cloudflare 403 은 주소 바뀜 아님) ----------
    private fun domainIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val ours = autoDomain() && baseHost != null && req.url.host == baseHost && HOST_REGEX.matches(baseHost)
        val res = try {
            chain.proceed(req)
        } catch (e: java.io.IOException) {
            val found = if (ours) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            DomainGuard.saveAuto(sp, KEY_DOMAIN, "https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }
        // 옛 주소는 오류 없이 텔레그램 안내 글(t.me/s/toki1234)로 넘겨 줌 → 사이트 밖으로 넘어가면 끊긴 주소로 봄
        val movedAway = !HOST_REGEX.matches(res.request.url.host)
        if (ours && (res.code >= 500 || res.code == 451 || movedAway)) {
            val found = discoverDomain(baseHost!!)
            if (found != null) {
                res.close()
                DomainGuard.saveAuto(sp, KEY_DOMAIN, "https://$found")
                return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
            }
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    /** 저장소 주소 목록(domains.json) → 공식 안내 페이지(뉴토주소.com)의 주소 → 같은 이름 번호 +1 ~ +8, -1 ~ -2 (소설 목록 API 가 열리는 진짜 사이트만).
     *  뉴토끼는 이름을 바꿔 가며 옮겨 다님(안내 페이지 변경 기록: newtoki463~469 → sbxh2~9 → toki25~36) — 세 이름 모두 같은 사이트 */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now
        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .build()
        val ua = userAgent
        fun open(host: String): String? = try {
            val r = Request.Builder().url("https://$host/api/novel-list?page=1&pageSize=1")
                .header("User-Agent", ua).header("Accept", "application/json").build()
            plain.newCall(r).execute().use { res ->
                val fh = res.request.url.host
                if (res.code != 200 || !HOST_REGEX.matches(fh)) return@use null
                if (res.body?.string().orEmpty().contains("\"novels\"")) fh else null
            }
        } catch (e: Exception) {
            null
        }
        DomainList.host("tokinovel")?.takeIf { it != currentHost && HOST_REGEX.matches(it) }?.let { open(it) }?.let { return@synchronized it }
        val guided = runCatching {
            plain.newCall(Request.Builder().url(GUIDE_URL).header("User-Agent", ua).build()).execute().use { r ->
                if (!r.isSuccessful) emptyList() else GUIDE_HOST.findAll(r.body?.string().orEmpty().lowercase()).map { it.value }.distinct().take(4).toList()
            }
        }.getOrDefault(emptyList())
        for (h in guided) if (h != currentHost) open(h)?.let { return@synchronized it }
        val m = Regex("""^([a-z]+)(\d+)\.([a-z]+)$""").find(currentHost) ?: return@synchronized null
        val (stem, num, tld) = m.destructured
        val n = num.toInt()
        val pool = java.util.concurrent.Executors.newFixedThreadPool(6)
        try {
            ((n + 1)..(n + 8)).plus(listOf(n - 1, n - 2)).filter { it > 0 }
                .map { "$stem$it.$tld" }
                .map { h -> pool.submit<String?> { open(h) } }
                .mapNotNull { it.get() }
                .maxByOrNull { DomainGuard.hostNumber(it) }
        } finally {
            pool.shutdown()
        }
    }

    // ---------- 통신 ----------
    /** 사이트 요청. 실패하면 오류 끝에 [단계 · HTTP · 주소 모양 · 응답 앞부분] */
    private fun fetchText(path: String, json: Boolean, stage: String): String {
        val h = headers.newBuilder().apply { if (json) set("Accept", "application/json") }.build()
        client.newCall(GET(baseUrl + path, h)).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (CF_MARK.containsMatchIn(body)) throw Exception("Cloudflare 보안 확인이 필요해요. 메뉴 → WebView 에서 열기로 한 번 통과한 뒤 다시 시도해 주세요 [$stage]")
            if (!res.isSuccessful) {
                throw Exception("사이트 요청 실패 [$stage · HTTP ${res.code} · ${res.request.url.host}${path.substringBefore('?').take(40)} · ${body.replace(Regex("\\s+"), " ").take(50)}]")
            }
            return body
        }
    }

    private fun fetchJson(path: String, stage: String): JSONObject {
        val t = fetchText(path, true, stage)
        return try {
            JSONObject(t)
        } catch (e: Exception) {
            throw Exception("사이트 응답을 읽지 못했어요 [$stage · ${t.replace(Regex("\\s+"), " ").take(60)}]")
        }
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun query(map: List<Pair<String, String>>): String =
        map.filter { it.second.isNotEmpty() }.joinToString("&") { enc(it.first) + "=" + enc(it.second) }

    private fun toManga(o: JSONObject): SManga? {
        val id = (o.opt("id") ?: o.opt("novelId"))?.toString().orEmpty()
        val title = o.optString("title").ifEmpty { o.optString("novelTitle") }.trim()
        if (!NUM_ONLY.matches(id) || title.isEmpty()) return null
        return SManga.create().apply {
            url = "/novel/$id"
            this.title = title
            thumbnail_url = o.optString("thumbnailUrl").takeIf { it.startsWith("http") }
            author = o.optString("author").trim().ifEmpty { null }
            genre = o.optString("genre").split(',').map { it.trim() }.filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null }
        }
    }

    // ---------- 목록 ----------
    private class Opts(
        val q: String = "",
        val genres: List<String> = emptyList(),
        val platforms: List<String> = emptyList(),
        val tags: List<String> = emptyList(),
        val sort: String = "new",
        val completed: Boolean = false,
    )

    private fun listing(page: Int, o: Opts): MangasPage {
        val path = "/api/novel-list?" + query(
            listOf(
                "q" to o.q,
                "g" to o.genres.distinct().joinToString(","),
                "p" to o.platforms.distinct().joinToString(","),
                "t" to o.tags.distinct().joinToString(","),
                "sort" to o.sort,
                "status" to if (o.completed) "completed" else "",
                "page" to page.toString(),
                "pageSize" to PAGE_SIZE.toString(),
            ),
        )
        val arr = fetchJson(path, "목록").optJSONArray("novels") ?: throw Exception("소설 목록을 찾지 못했어요 [목록 · novels 없음]")
        val seen = HashSet<String>()
        val list = (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::toManga) }.filter { seen.add(it.url) }
        return MangasPage(list, arr.length() >= PAGE_SIZE)
    }

    @Volatile
    private var updatesCache: Pair<Long, List<JSONObject>>? = null

    /** 최신 업데이트 화면의 allCards (5분 기억 — 쪽을 넘길 때 다시 받지 않게) */
    private fun allCards(): List<JSONObject> {
        updatesCache?.let { (t, v) -> if (System.currentTimeMillis() - t < 300_000) return v }
        val html = fetchText("/novel/updates", false, "최신")
        val sb = StringBuilder()
        NEXT_F.findAll(html).forEach { m ->
            runCatching { JSONArray(m.groupValues[1]) }.getOrNull()?.let { a -> (a.opt(1) as? String)?.let { sb.append(it) } }
        }
        val s = sb.toString()
        val start = s.indexOf("\"allCards\":[")
        if (start < 0) throw Exception("업데이트 목록을 찾지 못했어요 [최신 · allCards 없음 · 조각 ${s.length}자]")
        // 대괄호를 세어 목록 끝을 찾음 (글자 안의 괄호·따옴표는 건너뜀)
        var depth = 0
        var inStr = false
        var i = start + 11
        var end = -1
        while (i < s.length) {
            val c = s[i]
            if (inStr) {
                if (c == '\\') i++ else if (c == '"') inStr = false
            } else if (c == '"') {
                inStr = true
            } else if (c == '[' || c == '{') {
                depth++
            } else if ((c == ']' || c == '}') && --depth == 0) {
                end = i
                break
            }
            i++
        }
        if (end < 0) throw Exception("업데이트 목록을 읽지 못했어요 [최신]")
        val arr = JSONArray(s.substring(start + 11, end + 1))
        val seen = HashSet<String>()
        val out = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
            .filter { NUM_ONLY.matches(it.opt("novelId")?.toString().orEmpty()) && it.optString("novelTitle").isNotEmpty() }
            .filter { seen.add(it.opt("novelId").toString()) }
        updatesCache = System.currentTimeMillis() to out
        return out
    }

    private fun updates(page: Int, q: String): MangasPage {
        val w = q.trim().lowercase()
        val all = allCards().filter { w.isEmpty() || it.optString("novelTitle").lowercase().contains(w) }
        val from = UPDATES_PER_PAGE * (page - 1)
        val list = all.drop(from).take(UPDATES_PER_PAGE).mapNotNull(::toManga)
        return MangasPage(list, all.size > from + UPDATES_PER_PAGE)
    }

    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> {
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { return fetchSearchManga(page, "", it) }
        return Observable.fromCallable { listing(page, Opts(sort = "views")) }
    }

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> {
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { return fetchSearchManga(page, "", it) }
        return Observable.fromCallable { updates(page, "") }
    }

    // 검색 띄어쓰기: 결과가 없으면 띄어쓰기 뺀 검색어 등으로 다시 찾음(SearchSpacing)
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> =
        SearchSpacing.wrap(page, query) { q, p -> fetchSearchInner(p, q, filters) }

    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        NOVEL_PATH.find(u.encodedPath)?.groupValues?.get(1)?.let { "/novel/$it" }

    private fun fetchSearchInner(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품·회차 주소를 붙여 넣으면 그 작품을 바로 보여 줌
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        var mode = "list"
        var sort = "new"
        val genres = mutableListOf<String>()
        val platforms = mutableListOf<String>()
        val tags = mutableListOf<String>()
        filters.forEach { f ->
            when (f) {
                is Pick -> when (f.param) {
                    "mode" -> mode = f.pairs[f.state].second
                    "sort" -> sort = f.pairs[f.state].second
                }
                is GenreTri -> when (f.state) {
                    Filter.TriState.STATE_INCLUDE -> genres.add(f.name)
                    Filter.TriState.STATE_EXCLUDE -> genres.add("-" + f.name)
                }
                is PlatformTri -> when (f.state) {
                    Filter.TriState.STATE_INCLUDE -> platforms.add(f.value)
                    Filter.TriState.STATE_EXCLUDE -> platforms.add("-" + f.value)
                }
                is Words -> f.state.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                    .forEach { if (f.param == "genre") genres.add(it) else tags.add(it) }
                else -> {}
            }
        }
        return Observable.fromCallable {
            if (mode == "updates") {
                updates(page, query)
            } else {
                listing(page, Opts(query.trim(), genres, platforms, tags, sort, mode == "completed"))
            }
        }
    }

    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request = throw UnsupportedOperationException()
    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    // ---------- 작품 ----------
    private fun novelId(url: String): String =
        NOVEL_PATH.find(url)?.groupValues?.get(1) ?: throw Exception("소설 주소가 아니에요 [${url.take(40)}]")

    override fun getMangaUrl(manga: SManga): String = baseUrl + "/novel/" + novelId(manga.url)

    override fun fetchMangaDetails(manga: SManga): Observable<SManga> = Observable.fromCallable {
        detailsOf(fetchText("/novel/" + novelId(manga.url), false, "작품"))
    }

    override fun mangaDetailsParse(response: Response): SManga = throw UnsupportedOperationException()

    private fun plain(s: String): String = Jsoup.parse(s).text().replace(Regex("\\s+"), " ").trim()

    private fun detailsOf(html: String): SManga {
        val sec = DETAIL_SECTION.find(html)?.groupValues?.get(1)
        val title = sec?.let { H1.find(it)?.groupValues?.get(1) }?.let(::plain).orEmpty()
        if (sec == null || title.isEmpty()) throw Exception("작품 정보를 찾지 못했어요 [작품 · ${html.replace(Regex("\\s+"), " ").take(50)}]")
        val thumbBox = THUMB_BOX.find(sec)?.groupValues?.get(1).orEmpty()
        val img = IMG_SRC.find(thumbBox)?.groupValues?.get(1)?.let { Jsoup.parse(it).text() }.orEmpty()
        return SManga.create().apply {
            this.title = title
            thumbnail_url = img.takeIf { it.startsWith("http") }
            author = AUTHOR.findAll(sec).map { plain(it.groupValues[1]) }.filter { it.isNotEmpty() }.distinct().joinToString(", ").ifEmpty { null }
            description = DESC.find(sec)?.groupValues?.get(1)?.let { d ->
                Jsoup.parse(d.replace(Regex("(?i)<br\\s*/?>"), "\n")).wholeText()
                    .lines().map { it.replace(Regex("[ \\t]+"), " ").trim() }.joinToString("\n").trim()
            }
            genre = TAG.findAll(sec).map { plain(it.groupValues[1]) }.filter { it.isNotEmpty() }.distinct().joinToString(", ").ifEmpty { null }
            status = if (thumbBox.contains("nv-badge--done")) SManga.COMPLETED else SManga.ONGOING
        }
    }

    // ---------- 회차 (커서로 오래된 쪽까지 이어 받음) ----------
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> = Observable.fromCallable {
        val id = novelId(manga.url)
        val html = fetchText("/novel/$id", false, "작품")
        val total = EP_TOTAL.find(html)?.groupValues?.get(1)?.replace(Regex("\\D"), "")?.toIntOrNull() ?: 0
        chapters(id, total)
    }

    override fun chapterListParse(response: Response): List<SChapter> = throw UnsupportedOperationException()

    private fun chapters(id: String, total: Int): List<SChapter> {
        val out = LinkedHashMap<String, SChapter>()
        val seen = HashSet<String>()
        val usedNum = HashSet<Float>()
        var cursor = "999999999:999999999999"
        for (round in 0 until EPISODE_PAGES) {
            val r = fetchJson("/api/novel/$id/episodes/window?" + query(listOf("direction" to "older", "cursor" to cursor)), "회차")
            val items = r.optJSONArray("items")
            if (!r.optBoolean("ok") || items == null) {
                throw Exception(if (round > 0) "회차 목록 일부를 받지 못했어요. 다시 시도해 주세요 [회차 ${seen.size}개째]" else "회차 목록을 찾지 못했어요 [회차 · ok=${r.opt("ok")}]")
            }
            for (k in 0 until items.length()) {
                val t = items.optJSONObject(k) ?: continue
                val eid = t.opt("id")?.toString().orEmpty()
                if (!NUM_ONLY.matches(eid)) continue
                val url = "/novel/$id/$eid"
                if (!seen.add(url) || t.optBoolean("isNotReady")) continue
                val num = t.optDouble("number", Double.NaN)
                val label = t.optString("episodeLabel").ifEmpty { if (!num.isNaN()) "${fmtNum(num)}화" else "" }.trim()
                var name = listOf(label, t.optString("title").trim()).filter { it.isNotEmpty() && it != "null" }.joinToString(" ")
                    .ifEmpty { "회차 $eid" }
                val gate = t.optString("gateMode")
                if ((t.optBoolean("isPaid") || (gate.isNotEmpty() && gate != "none" && gate != "null")) &&
                    !t.optBoolean("isUnlocked") && !t.optBoolean("showFree")
                ) {
                    val cost = t.optInt("cost", 0)
                    name = "🔒 [${if (cost > 0) "${cost}P" else "유료"}] $name"
                }
                out[url] = SChapter.create().apply {
                    this.url = url
                    this.name = name
                    var n = if (!num.isNaN() && num > 0) num.toFloat() else -1f
                    if (n > 0) {
                        while (!usedNum.add(n)) n += 0.01f
                    }
                    chapter_number = n
                    date_upload = dateOf(t.optString("publishedAtLabel"))
                }
            }
            val older = r.optString("olderCursor")
            if (!r.optBoolean("hasOlder") || older.isEmpty() || older == "null" || older == cursor || items.length() == 0) break
            cursor = older
            if (round == EPISODE_PAGES - 1) throw Exception("회차가 너무 많아 끝까지 받지 못했어요 [회차 ${seen.size}개]")
        }
        if (seen.isEmpty()) throw Exception("회차가 없어요 [회차 0개]")
        if (total > seen.size) throw Exception("회차 일부만 받았어요 (${seen.size}/$total). 다시 시도해 주세요")
        // 번호 없는 회차는 올라온 순서(오래된 것부터)로 앞 회차 번호 + 0.5 — 번호가 겹치지 않게
        val list = out.values.toList() // 최신 → 오래된
        var prev = 0f
        list.asReversed().forEach { c ->
            if (c.chapter_number <= 0f) {
                var n = prev + 0.5f
                while (!usedNum.add(n)) n += 0.01f
                c.chapter_number = n
            }
            prev = c.chapter_number
        }
        return list
    }

    private fun fmtNum(d: Double): String = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

    /** "26. 11. 10." → 그날 0시(한국 시간) */
    private fun dateOf(s: String): Long {
        val m = DATE_LABEL.find(s.trim()) ?: return 0L
        return try {
            Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).apply {
                clear()
                set(2000 + m.groupValues[1].toInt(), m.groupValues[2].toInt() - 1, m.groupValues[3].toInt(), 0, 0, 0)
            }.timeInMillis
        } catch (e: Exception) {
            0L
        }
    }

    // ---------- 본문: 숨은 WebView 로 회차 화면을 열어 다 그려진 문단을 받음 ----------
    /** 본문 조각: 글자(text) 또는 그림 주소(image) */
    private class Part(val text: String?, val image: String?)

    private class Doc(val title: String, val parts: List<Part>)

    private val docCache = object : LinkedHashMap<String, Doc>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Doc>?) = size > 6
    }

    private fun loadDoc(chapterPath: String): Doc {
        synchronized(docCache) { docCache[chapterPath] }?.let { return it }
        val raw = readWithWebView(baseUrl + chapterPath)
            ?: throw Exception("회차 본문을 받지 못했어요 (시간 초과). 메뉴 → WebView 에서 열기로 사이트를 한 번 연 뒤 다시 시도해 주세요 [본문 · 웹뷰 ${READ_TIMEOUT_S}초]")
        val o = try {
            JSONObject(raw)
        } catch (e: Exception) {
            throw Exception("본문 응답을 읽지 못했어요 [본문 · ${raw.take(60)}]")
        }
        o.optString("error").takeIf { it.isNotEmpty() }?.let { throw Exception("$it [본문]") }
        val arr = o.optJSONArray("paragraphs") ?: JSONArray()
        val parts = (0 until arr.length()).mapNotNull { i ->
            val p = arr.optJSONObject(i) ?: return@mapNotNull null
            val img = p.optString("image").takeIf { it.startsWith("http") }
            val text = p.optString("text").trim().takeIf { it.isNotEmpty() && it != "null" }
            if (img != null) Part(null, img) else text?.let { Part(it, null) }
        }
        if (parts.isEmpty()) throw Exception("회차 본문이 비어 있어요 [본문 · 문단 0개]")
        return Doc(o.optString("title").trim(), parts).also { synchronized(docCache) { docCache[chapterPath] = it } }
    }

    private class Bridge(private val done: (String) -> Unit) {
        @JavascriptInterface
        fun setResponse(s: String) = done(s)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun readWithWebView(url: String): String? {
        val latch = CountDownLatch(1)
        var result: String? = null
        val handler = Handler(Looper.getMainLooper())
        var webView: WebView? = null
        val script = READER_JS
        handler.post {
            try {
                val wv = WebView(app)
                webView = wv
                wv.settings.javaScriptEnabled = true
                wv.settings.domStorageEnabled = true
                wv.settings.userAgentString = userAgent
                wv.settings.mediaPlaybackRequiresUserGesture = true
                wv.addJavascriptInterface(
                    Bridge { s ->
                        if (result == null) {
                            result = s
                            latch.countDown()
                        }
                    },
                    "TokiBridge",
                )
                wv.webViewClient = object : WebViewClient() {
                    override fun onPageStarted(view: WebView, u: String?, favicon: Bitmap?) {
                        view.evaluateJavascript(script, null)
                    }

                    override fun onPageFinished(view: WebView, u: String?) {
                        view.evaluateJavascript(script, null)
                    }
                }
                wv.loadUrl(url, mapOf("Referer" to "$baseUrl/"))
            } catch (e: Throwable) {
                result = JSONObject().put("error", "WebView 를 열지 못했어요 (${e.javaClass.simpleName})").toString()
                latch.countDown()
            }
        }
        latch.await(READ_TIMEOUT_S, TimeUnit.SECONDS)
        handler.post {
            runCatching {
                webView?.stopLoading()
                webView?.destroy()
            }
        }
        return result
    }

    // ---------- 본문 → 그림 페이지 (북코 소설과 같은 방법) ----------
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

    private fun styleKey(): String = "f${fontPx().toInt()}-${pref(KEY_THEME, "dark")}-l${lineMult()}-g${if (gap()) 1 else 0}"

    /** 본문을 글자 덩어리·그림으로 나눔 (그림 사이의 글자는 한 덩어리, 첫 덩어리 앞에 제목) */
    private fun blocks(doc: Doc): List<Part> {
        val out = mutableListOf<Part>()
        val buf = mutableListOf<String>()
        var first = true
        fun flush() {
            if (buf.isEmpty() && !(first && doc.title.isNotEmpty())) return
            val head = if (first && doc.title.isNotEmpty()) "${doc.title}\n\n" else ""
            out.add(Part(head + buf.joinToString(if (gap()) "\n\n" else "\n"), null))
            buf.clear()
            first = false
        }
        doc.parts.forEach { p ->
            if (p.image != null) {
                flush()
                out.add(p)
            } else {
                buf.add(p.text!!)
            }
        }
        flush()
        return out
    }

    private fun layout(text: String): Pair<StaticLayout, List<Int>> {
        val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
            textSize = fontPx()
            color = colors().second
        }
        @Suppress("DEPRECATION")
        val sl = StaticLayout(text, paint, PAGE_W - PAD * 2, Layout.Alignment.ALIGN_NORMAL, lineMult(), 0f, false)
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
        val bs = blocks(loadDoc(chapter.url))
        val key = enc(chapter.url)
        val style = styleKey()
        val pages = mutableListOf<Page>()
        bs.forEachIndexed { b, part ->
            if (part.image != null) {
                pages.add(Page(pages.size, "", part.image))
            } else {
                val (_, starts) = layout(part.text!!)
                starts.indices.forEach { i -> pages.add(Page(pages.size, "", "https://$RENDER_HOST/$key/$b/$i?s=$style")) }
            }
        }
        pages
    }

    private fun renderIntercept(chain: okhttp3.Interceptor.Chain): Response? {
        val req = chain.request()
        if (req.url.host != RENDER_HOST) return null
        val parts = req.url.encodedPath.trim('/').split('/')
        val chapterPath = URLDecoder.decode(parts.getOrNull(0).orEmpty(), "UTF-8")
        val b = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val index = parts.getOrNull(2)?.toIntOrNull() ?: 0
        val text = blocks(loadDoc(chapterPath)).getOrNull(b)?.text.orEmpty()
        val (sl, starts) = layout(text)
        val bmp = Bitmap.createBitmap(PAGE_W, PAGE_H, Bitmap.Config.RGB_565)
        val canvas = Canvas(bmp)
        canvas.drawColor(colors().first)
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

    // ---------- 필터 ----------
    override fun getFilterList() = ExtStatus.prepend(
        "tokinovel",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                listOf(
                    Filter.Header("업데이트 목록은 검색어로 제목만 거르고 다른 조건은 안 씀"),
                    Pick("목록", "mode", MODES),
                    Pick("정렬", "sort", SORTS),
                    Filter.Header("장르 (한 번 누르면 포함, 두 번 누르면 빼기)"),
                ) + GENRES.map { GenreTri(it) } + listOf(
                    Words("장르 직접 입력 (쉼표로 구분, 앞에 - 는 빼기)", "genre"),
                    Filter.Header("플랫폼 (한 번 누르면 포함, 두 번 누르면 빼기)"),
                ) + PLATFORMS.map { PlatformTri(it.first, it.second) } + listOf(
                    Words("태그 직접 입력 (쉼표로 구분)", "tag"),
                ),
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    class GenreTri(name: String) : Filter.TriState(name)

    class PlatformTri(name: String, val value: String) : Filter.TriState(name)

    class Words(name: String, val param: String) : Filter.Text(name)

    // ---------- 설정 ----------
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
            summary = "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 번호 주소가 확인되면 자동으로 바뀜 (기본: $DEFAULT)"
            dialogTitle = "도메인 주소 (예: https://sbxh9.com)"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                val s = (v as String).trim().trimEnd('/')
                s.isEmpty() || DOMAIN_REGEX.matches(s)
            }
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "접속이 안 되면 저장소 주소 목록과 번호가 다른 같은 이름 주소(sbxh10.com 등) 중 열리는 주소로 자동 변경"
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

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val KEY_FONT = "pref_font_px"
        private const val KEY_THEME = "pref_theme"
        private const val KEY_GAP = "pref_paragraph_gap"
        private const val KEY_LINE = "pref_line_spacing"
        private const val DEFAULT = "https://sbxh9.com"
        private const val RENDER_HOST = "tokinovel-render.local"
        private const val PAGE_W = 1080
        private const val PAGE_H = 1800
        private const val PAD = 64
        private const val PAGE_SIZE = 40
        private const val UPDATES_PER_PAGE = 50
        private const val EPISODE_PAGES = 200
        private const val READ_TIMEOUT_S = 45L
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"

        // 같은 사이트의 세 이름 (망가요미판 설정과 같음): sbxhN.com · tokiN.com · newtokiN.org
        private const val GUIDE_URL = "https://xn--vg1b79zgsf1sj.com/" // 뉴토주소.com (맨 위가 지금 주소)
        private val GUIDE_HOST = Regex("""(?:toki|sbxh|newtoki)\d+\.(?:com|org|net)""")
        private val HOST_REGEX = Regex("""^(?:www\.)?(?:sbxh|toki|newtoki)\d+\.(?:com|org|net)$""")
        private val DOMAIN_REGEX = Regex("""^https://(?:www\.)?(?:sbxh|toki|newtoki)\d+\.(?:com|org|net)$""")
        private val NOVEL_PATH = Regex("""/novel/(\d+)""")
        private val NUM_ONLY = Regex("""^\d+$""")
        private val CF_MARK = Regex("""cf-chl-|cf-turnstile|<title>Just a moment""", RegexOption.IGNORE_CASE)
        private val NEXT_F = Regex("""self\.__next_f\.push\((\[[\s\S]*?\])\)</script>""")
        private val DETAIL_SECTION = Regex("""<section class="novel-detail">([\s\S]*?)</section>""")
        private val H1 = Regex("""<h1[^>]*>([\s\S]*?)</h1>""")
        private val THUMB_BOX = Regex("""<div class="nd-thumb[^"]*"[^>]*>([\s\S]*?)</div>""")
        private val IMG_SRC = Regex("""<img[^>]+src="([^"]+)"""")
        private val AUTHOR = Regex("""field=author[^>]*>([\s\S]*?)</a>""")
        private val DESC = Regex("""<p class="nd-desc">([\s\S]*?)</p>""")
        private val TAG = Regex("""class="hero-v2-tag"[^>]*>([\s\S]*?)</a>""")
        private val EP_TOTAL = Regex("""에피소드 \(([\d,<!\- >]*)화\)""")
        private val DATE_LABEL = Regex("""^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$""")

        private val MODES = listOf("작품 목록" to "list", "업데이트" to "updates", "완결" to "completed")
        private val SORTS = listOf(
            "최신순" to "new", "신작순" to "fresh", "북마크순" to "hot",
            "조회순" to "views", "평점순" to "rating", "화수순" to "episodes",
        )
        private val GENRES = listOf("판타지", "무협", "19금", "현대", "로맨스", "로맨스 판타지", "BL", "라노벨", "기타")
        private val PLATFORMS = listOf(
            "직접 업로드" to "user", "노벨피아" to "novelpia", "북토끼" to "booktoki", "문피아" to "munpia",
            "조아라" to "joara", "카카오페이지" to "kakaopage", "네이버 시리즈" to "series", "리디북스" to "ridi", "기타" to "etc",
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

        /**
         * 망가요미판(tokiNovelReader)과 같은 본문 읽기 스크립트. 사이트가 그린 그림자 DOM(attachShadow) 안의 문단이나
         * 낭독용 글(__novelTTSText)을 읽어 TokiBridge.setResponse 로 돌려줌. 봇 확인(퍼즐)·권한 오류면 그 이유를 돌려줌.
         */
        private val READER_JS = """
(function(){
if(window.__tkReader)return;window.__tkReader=true;
var sent=false,n=0,bad=0,shadows=[],orig=Element.prototype.attachShadow;
function send(o){if(sent)return;sent=true;try{TokiBridge.setResponse(JSON.stringify(o));}catch(e){}}
Element.prototype.attachShadow=function(o){var s=orig.call(this,o);shadows.push(s);return s;};
function readRoot(root){var out=[];var kids=root.children;for(var k=0;k<kids.length;k++){var r=kids[k];
if(r.tagName==='P'){var t=(r.textContent||'').trim();if(t)out.push({text:t});}
else if(r.tagName==='FIGURE'){var im=r.querySelector('img');if(im&&im.src)out.push({image:im.src});}
else if(r.classList&&r.classList.contains('novel-epub-rendered')){var buf='';
var flush=function(){if(buf.trim())out.push({text:buf.trim()});buf='';};
var walk=function(x){if(x.nodeType===3){buf+=x.textContent||'';return;}
if(x.nodeType!==1||/^(SCRIPT|STYLE|NOSCRIPT)${'$'}/.test(x.tagName))return;
if(x.tagName==='IMG'){flush();if(x.src)out.push({image:x.src});return;}
if(x.tagName==='BR'){buf+='\n';return;}
var blk=/^(P|DIV|SECTION|ARTICLE|H[1-6]|LI|BLOCKQUOTE|FIGURE|TR)${'$'}/.test(x.tagName);
if(blk)flush();for(var c=0;c<x.childNodes.length;c++)walk(x.childNodes[c]);if(blk)flush();};
walk(r);flush();}}return out;}
var timer=setInterval(function(){if(sent){clearInterval(timer);return;}n++;
var extra=[];var all=document.querySelectorAll('article.novel-viewer *');for(var i=0;i<all.length;i++){if(all[i].__novelShadow)extra.push(all[i].__novelShadow);}
var roots=shadows.concat(extra),root=null;for(var j=0;j<roots.length;j++){if(roots[j].querySelector('p, figure, .novel-epub-rendered')){root=roots[j];break;}}
var tts=typeof window.__novelTTSText==='string'?window.__novelTTSText.trim():'';
if(root||tts){var ps=root?readRoot(root):[];
if(!ps.length&&tts){ps=tts.split(/\n{2,}/).map(function(s){return s.trim();}).filter(function(s){return s;}).map(function(s){return {text:s};});}
if(ps.length){var h=document.querySelector('h1.ne-h1');send({title:h?(h.textContent||'').trim():'',paragraphs:ps});return;}}
var art=document.querySelector('article.novel-viewer');var txt=art?(art.innerText||''):'';
if(/퍼즐 조각을 맞춰주세요|봇 확인/.test(txt)){send({error:'사이트가 봇 확인(퍼즐)을 요구해요. 메뉴 → WebView 에서 열기로 이 회차를 열어 확인을 마친 뒤 다시 시도해 주세요'});return;}
bad=/일시적 오류|다시 시도|로그인|이용 권한|포인트/.test(txt)?bad+1:0;
if(bad>=12||n>=170){send({error:bad?('사이트가 본문을 내주지 않았어요: '+txt.replace(/\s+/g,' ').trim().slice(0,80)):'회차 본문을 받지 못했어요. 메뉴 → WebView 에서 열기로 사이트를 한 번 연 뒤 다시 시도해 주세요'});}
},250);
})();
        """.trimIndent()
    }
}
