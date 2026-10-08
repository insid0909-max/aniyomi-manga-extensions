package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
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
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 블랙툰 (blacktoon423.com)
 * 작품 목록은 사이트가 data/webtoon_0.js, webtoon_1.js 로 통째로 내려주므로 받아서 앱에서 정렬/검색/필터.
 * 사이트 구조 참고: oneulddu/Korean-Mihon-Extensions-Source ko/blacktoon (Apache-2.0)
 */
class Blacktoon : HttpSource(), ConfigurableSource {

    override val name = "Blacktoon 웹툰"

    // 다른 저장소의 블랙툰 확장과 소스 ID가 겹치지 않도록 고유 ID 사용
    override val id: Long = uniqueSourceId("newxtoon.blacktoon/ko/1")
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_$id", 0) }

    // 설정에 직접 넣은 값이 있으면 그것, 없으면 기본(데스크톱 크롬) — 다른 웹툰 확장과 같은 설정 항목
    private val userAgent: String
        get() = try {
            sp.getString(KEY_UA, "")?.trim().orEmpty()
        } catch (e: Throwable) {
            ""
        }.ifEmpty { USER_AGENT }

    override val baseUrl: String
        get() {
            val v = try {
                sp.getString(KEY_DOMAIN, "")?.trim()?.trimEnd('/').orEmpty()
            } catch (e: Throwable) {
                ""
            }
            return if (Regex("^https?://[^\\s/]+$").matches(v)) DomainGuard.preferDefault(v, DEFAULT) else DEFAULT
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

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("User-Agent", userAgent)
        .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

    // 주소 번호가 바뀌면 자동으로 찾아 연결 + 이미지 서버 요청에 Referer/Origin 추가
    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> smartIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, "webtoon_"))
        .build()

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
        var req = chain.request()
        if (req.header("Referer") == null && !HOST_REGEX.matches(req.url.host)) {
            req = req.newBuilder()
                .header("Referer", "$baseUrl/")
                .header("Origin", baseUrl)
                .build()
        }
        if (req.url.encodedFragment?.startsWith(COVER_MARK) == true) return coverIntercept(chain, req)
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val ours = autoDomain() && baseHost != null && req.url.host == baseHost && HOST_REGEX.matches(baseHost)

        val res = try {
            chain.proceed(req)
        } catch (e: IOException) {
            val found = if (ours) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            saveDomain("https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }

        if (res.code == 451) {
            res.close()
            throw IOException("접근 차단됨 (HTTP 451). 확장 설정에서 도메인 주소를 확인하세요.")
        }
        val finalHost = res.request.url.host
        if (ours && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    // ---------- 표지: 이미지 서버가 바뀌어도 열리도록 여러 서버/경로를 차례로 시도 ----------
    @Volatile
    private var imageHosts: List<String> = emptyList()

    // 표지 서버 = 사이트의 inc_url2 / inc_url1 (현재 ttjsde.speedwebgo.com)
    @Volatile
    private var posterHosts: List<String> = emptyList()

    private fun rememberImageHosts(v: Map<String, String>) {
        val posters = listOf("inc_url2", "inc_url1")
            .mapNotNull { v[it]?.trim()?.takeIf { u -> u.startsWith("http") }?.trimEnd('/')?.plus("/") }
            .distinct()
        if (posters.isNotEmpty()) posterHosts = posters
        val hosts = (listOf("img_domain") + (2..8).map { "img_domain$it" })
            .mapNotNull { v[it]?.trim()?.takeIf { u -> u.startsWith("http") }?.trimEnd('/')?.plus("/") }
            .distinct()
        if (hosts.isNotEmpty()) imageHosts = hosts
    }

    private fun coverIntercept(chain: okhttp3.Interceptor.Chain, req: Request): Response {
        val original = java.net.URLDecoder.decode(req.url.encodedFragment!!.removePrefix(COVER_MARK), "UTF-8")
        val stripped = original.replace("_x4", "").replace("_x3", "")
        val urls = if (original.startsWith("http") || original.startsWith("//")) {
            listOf(stripped, original).map { if (it.startsWith("//")) "https:$it" else it }
        } else {
            val paths = listOf(stripped, original).map { it.removePrefix("/") }.distinct()
            (posterHosts + POSTER_URL + CDN_URL + imageHosts + "$baseUrl/").distinct().flatMap { b -> paths.map { b + it } }
        }
        var last: String? = null
        for (u in urls.distinct()) {
            val url = u.toHttpUrlOrNull() ?: continue
            try {
                val res = chain.proceed(req.newBuilder().url(url).build())
                val type = res.body?.contentType()?.type
                if (res.isSuccessful && (type == null || type == "image" || type == "application")) return res
                last = "${url.host} HTTP ${res.code}"
                res.close()
            } catch (e: IOException) {
                last = "${url.host} ${e.message}"
            }
        }
        throw IOException("표지 이미지 로드 실패 ($last)")
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("blacktoon(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 공식 주소 안내(blacktoonurl.net)에서 최신 주소 확인, 실패하면 현재 번호 다음 30개 중 열리는 주소 (큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .build()

        fun fetch(url: String): Pair<String, String>? = try {
            val r = Request.Builder().url(url).header("User-Agent", userAgent).build()
            plain.newCall(r).execute().use { res ->
                if (res.code != 200) null else res.request.url.host to (res.body?.string() ?: "")
            }
        } catch (e: Exception) {
            null
        }

        // 1) 공식 주소 안내 사이트
        fetch(GUIDE_URL)?.let { (_, html) ->
            val found = Jsoup.parse(html, GUIDE_URL).select("a[href]")
                .mapNotNull { it.absUrl("href").toHttpUrlOrNull()?.host }
                .filter { HOST_REGEX.matches(it) && it != currentHost }
                .maxByOrNull { hostNumber(it) }
            if (found != null) return found
        }

        // 2) 번호 주소 순회
        val start = hostNumber(currentHost).coerceAtLeast(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(10)
        try {
            val futures = (start - 2..start + 30).filter { it > 0 }.map { "blacktoon$it.com" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        val hit = fetch("https://$host/") ?: return@submit null
                        if (HOST_REGEX.matches(hit.first) && hit.second.contains("webtoon_")) hit.first else null
                    }
                }
            futures.mapNotNull { it.get() }.maxByOrNull { hostNumber(it) }
        } finally {
            pool.shutdown()
        }
    }

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        ChapterPosition.addPref(screen)
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

        SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "주소 번호가 바뀌어 접속이 안 되면 blacktoonurl.net / 다음 번호 주소에서 새 주소로 자동 변경"
            setDefaultValue(true)
        }.also(screen::addPreference)

        EditTextPreference(screen.context).apply {
            key = KEY_UA
            title = "User-Agent (고급)"
            summary = "비워두면 기본값(데스크톱 크롬) 사용. 변경 후 앱 재시작 필요"
            dialogTitle = "User-Agent"
            setDefaultValue("")
        }.also(screen::addPreference)
    }

    // ---------- 작품 목록 (전체 목록을 받아 15분간 보관) ----------
    private class Series(
        val id: String,
        val title: String,
        val poster: String,
        val author: String,
        val updatedAt: Long,
        val tags: List<Int>,
        val platform: Int,
        val day: Int,
        val hot: Int,
        val listIndex: Int, // 0 = 완결, 1 = 연재
    )

    private val catalogLock = Any()

    @Volatile
    private var catalogCache: List<Series>? = null

    @Volatile
    private var catalogAt = 0L

    private fun catalog(refresh: Boolean): List<Series> = synchronized(catalogLock) {
        val cur = catalogCache
        if (cur != null && (!refresh || System.currentTimeMillis() - catalogAt < CATALOG_TTL)) return cur
        return try {
            loadCatalog().also {
                catalogCache = it
                catalogAt = System.currentTimeMillis()
            }
        } catch (e: Exception) {
            cur ?: throw e
        }
    }

    private fun loadCatalog(): List<Series> {
        val (html, pageUrl) = client.newCall(GET("$baseUrl/", headers)).execute().use { res ->
            if (!res.isSuccessful) throw IOException("블랙툰 목록 요청 실패 HTTP ${res.code}")
            (res.body?.string() ?: "") to res.request.url.toString()
        }
        val scripts = pageScripts(html, pageUrl, withConfig = false) { fetchScript(it, pageUrl) }
        rememberImageHosts(scripts.variables)
        val byIndex = scripts.urls.mapNotNull { url ->
            val m = CATALOG_PATH.matchEntire(url.encodedPath) ?: return@mapNotNull null
            (m.groups[1] ?: m.groups[2])!!.value.toInt() to url
        }.groupBy({ it.first }, { it.second })

        // 연재(1) / 완결(0) 데이터를 동시에 받음
        fun load(index: Int): List<Series> {
            val urls = byIndex[index].orEmpty()
                .sortedBy { it.encodedPath.startsWith("/data/webtoon/") }
                .map { it.toString() }
                .distinct()
            if (urls.isEmpty()) throw IOException("블랙툰 작품 데이터(webtoon_$index)를 찾을 수 없습니다")
            var items: List<Series>? = null
            var failure: Exception? = null
            for (url in urls) {
                try {
                    val m = CATALOG_PAYLOAD.matchEntire(fetchScript(url, pageUrl))
                        ?: throw IOException("작품 데이터 형식이 다릅니다")
                    if (m.groupValues[1].toInt() != index) throw IOException("작품 데이터 번호가 다릅니다")
                    items = parseSeries(JSONArray(m.groupValues[2]), index)
                        .also { if (it.isEmpty()) throw IOException("작품 데이터가 비어 있습니다") }
                    break
                } catch (e: Exception) {
                    failure = e
                }
            }
            return items ?: throw IOException("블랙툰 작품 데이터 로드 실패", failure)
        }
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val jobs = listOf(1, 0).map { index -> pool.submit<List<Series>> { load(index) } }
            return jobs.flatMap {
                try {
                    it.get()
                } catch (e: java.util.concurrent.ExecutionException) {
                    throw (e.cause as? Exception) ?: e
                }
            }
        } finally {
            pool.shutdown()
        }
    }

    private fun parseSeries(arr: JSONArray, index: Int): List<Series> = (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("x").ifEmpty { return@mapNotNull null }
        Series(
            id = id,
            title = o.optString("t"),
            poster = o.optString("p"),
            author = o.optString("au"),
            updatedAt = o.optLong("g", 0L),
            tags = o.optString("tag").split(",").mapNotNull { it.trim().toIntOrNull() },
            platform = o.optString("c").toIntOrNull() ?: -1,
            day = o.optString("pd").toIntOrNull() ?: -1,
            hot = o.optInt("h", 0),
            listIndex = index,
        )
    }

    private fun Series.toSManga() = SManga.create().apply {
        url = this@toSManga.id
        title = this@toSManga.title
        // 실제 주소는 요청 때 coverIntercept 에서 정함 (#bt= 뒤에 원래 경로를 담아 둠)
        thumbnail_url = poster.takeIf { it.isNotBlank() }?.let { p ->
            val path = p.replace("_x4", "").replace("_x3", "")
            val first = when {
                path.startsWith("http") -> path
                path.startsWith("//") -> "https:$path"
                else -> (posterHosts.firstOrNull() ?: POSTER_URL) + path.removePrefix("/")
            }
            first + "#" + COVER_MARK + java.net.URLEncoder.encode(p, "UTF-8")
        }
        author = this@toSManga.author
        genre = (listOf(PLATFORMS[platform], DAYS[day]) + tags.map { TAGS[it] })
            .filterNotNull().joinToString(", ")
        status = if (listIndex == 0) SManga.COMPLETED else SManga.ONGOING
    }

    private fun dataHeaders(pageUrl: String): Headers {
        val origin = pageUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null)
            .build().toString().trimEnd('/')
        return headers.newBuilder().set("Referer", pageUrl).set("Origin", origin).build()
    }

    private fun fetchScript(url: String, pageUrl: String): String =
        client.newCall(GET(url, dataHeaders(pageUrl))).execute().use { res ->
            if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
            res.body?.string() ?: ""
        }

    private fun browse(page: Int, sel: Selection): Observable<MangasPage> = Observable.fromCallable {
        val all = catalog(refresh = page == 1)
        val ordered = when (sel.order) {
            1 -> all.sortedByDescending { it.hot }
            else -> all.sortedByDescending { it.updatedAt }
        }
        val q = sel.query.lowercase(Locale.ROOT)
        val filtered = ordered.filter { s ->
            (q.isEmpty() || s.title.lowercase(Locale.ROOT).contains(q) || s.author.lowercase(Locale.ROOT).contains(q)) &&
                (sel.status == -1 || s.listIndex == sel.status) &&
                (sel.platform == -1 || s.platform == sel.platform) &&
                (sel.day == -1 || s.day == sel.day) &&
                (sel.tag == -1 || sel.tag in s.tags)
        }
        val start = ((page - 1) * PAGE_SIZE).coerceAtMost(filtered.size)
        val end = (start + PAGE_SIZE).coerceAtMost(filtered.size)
        MangasPage(filtered.subList(start, end).map { it.toSManga() }, end < filtered.size)
    }

    private data class Selection(
        val query: String = "",
        val order: Int = 0,
        val status: Int = -1,
        val platform: Int = -1,
        val day: Int = -1,
        val tag: Int = -1,
    )

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: browse(page, Selection(order = 1))
    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: browse(page, Selection(order = 0))

    /** 붙여 넣은 사이트 주소 → 작품 주소 (모르는 모양이면 null) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        Regex("^/webtoon/([^/]+)\\.html$").find(u.encodedPath)?.groupValues?.get(1)

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        fun pick(param: String) = filters.filterIsInstance<IntPick>().firstOrNull { it.param == param }?.value() ?: -1
        return browse(
            page,
            Selection(
                query = query.trim(),
                order = pick("order").coerceAtLeast(0),
                status = pick("status"),
                platform = pick("platform"),
                day = pick("day"),
                tag = pick("tag"),
            ),
        )
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga): Request = GET("$baseUrl/webtoon/${manga.url}.html", headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val doc = Jsoup.parse(response.body?.string().orEmpty(), response.request.url.toString())
        val mangaId = response.request.url.pathSegments.last().removeSuffix(".html")
        // 전체 목록은 크므로 새로 받지 않음 (이미 받아 둔 경우에만 사용), 없으면 작품 페이지에서 읽음
        val meta = catalogCache?.firstOrNull { it.id == mangaId }?.toSManga()
        return (meta ?: SManga.create()).apply {
            if (meta == null) {
                title = (doc.selectFirst("h3 b") ?: doc.selectFirst("h1, h2, h3"))?.text()?.trim().orEmpty()
                thumbnail_url = doc.selectFirst("img.thumb2")?.attr("src")?.ifEmpty { null }
                    ?: doc.selectFirst("meta[property=og:image]")?.attr("content")
                author = doc.select("p").firstOrNull { it.ownText().contains("작가 :") }
                    ?.ownText()?.substringAfter("작가 :")?.trim()?.ifEmpty { null }
                genre = doc.select("span.badge-light").map { it.text().trim() }.filter { it.isNotEmpty() }
                    .joinToString(", ").ifEmpty { null }
            }
            description = doc.select("p.mt-2").last()?.text()
        }
    }

    // ---------- 회차 (data/toonlist/{id}.js 의 clist) ----------
    override fun chapterListRequest(manga: SManga): Request = GET("$baseUrl/webtoon/${manga.url}.html", headers)

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH)

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서)
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            ChapterOrder.sort(it, manga.title).let { l -> if (ChapterPosition.enabled(sp)) ChapterPosition.label(l, manga.title) else l }
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val pageUrl = response.request.url.toString()
        val mangaId = response.request.url.pathSegments.last().removeSuffix(".html")
        if (mangaId.toLongOrNull() == null) throw IOException("잘못된 작품 주소")
        val html = response.body?.string().orEmpty()
        val page = pageScripts(html, pageUrl, withConfig = false) { fetchScript(it, pageUrl) }
        val found = page.urls.filter { it.encodedPath == "/data/toonlist/$mangaId.js" }.map { it.toString() }
        // 페이지에서 주소를 못 찾았을 때: 설정(config.js)의 inc_url / 알려진 데이터 서버 / 사이트 순으로 시도
        val siteRoot = pageUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null)
            .build().toString().trimEnd('/')
        val fallback = (listOf(page.variables["inc_url1"], page.variables["inc_url"], page.variables["inc_url2"]) + DATA_HOSTS + siteRoot)
            .mapNotNull { it?.trim()?.trimEnd('/')?.takeIf { b -> b.startsWith("http") } }
            .map { "$it/data/toonlist/$mangaId.js?v=${Math.random()}" }
        val scripts = (found + fallback).distinctBy { it.substringBefore('?') }
        val errors = ArrayList<String>()
        for (script in scripts) {
            try {
                val m = CHAPTER_PAYLOAD.matchEntire(fetchScript(script.toString(), pageUrl))
                    ?: throw IOException("회차 데이터 형식이 다릅니다")
                val arr = JSONArray(m.groupValues[1])
                val list = (0 until arr.length()).mapNotNull { i ->
                    val o = arr.optJSONObject(i) ?: return@mapNotNull null
                    val cid = o.optString("id")
                    SChapter.create().apply {
                        url = o.optString("u").removePrefix("/webtoons/").removeSuffix(".html")
                            .ifBlank { "$mangaId/$cid" }
                        name = o.optString("t")
                        date_upload = try {
                            synchronized(dateFmt) { dateFmt.parse(o.optString("d"))?.time } ?: 0L
                        } catch (e: Exception) {
                            0L
                        }
                    }
                }
                if (list.isEmpty()) throw IOException("회차 목록이 비어 있습니다")
                return list.reversed()
            } catch (e: Exception) {
                errors.add("${script.toHttpUrlOrNull()?.host}: ${e.message}")
            }
        }
        throw IOException(
            "블랙툰 회차 목록 로드 실패 (페이지 내 주소 ${found.size}개) " + errors.joinToString(" / ").take(200),
        )
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter): Request = GET("$baseUrl/webtoons/${chapter.url}.html", headers)

    override fun pageListParse(response: Response): List<Page> {
        val pageUrl = response.request.url.toString()
        val scripts = pageScripts(response.body?.string().orEmpty(), pageUrl) { fetchScript(it, pageUrl) }
        rememberImageHosts(scripts.variables)
        val cdn = imageCdn(scripts.variables, System.currentTimeMillis())
        val siteUrl = pageUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null).build().toString()
        val pages = scripts.document.select("#toon_content_imgs img").mapIndexed { i, el ->
            val img = el.attr("data-original").ifBlank { el.attr("o_src") }.ifBlank { el.attr("src") }
            if (img.isBlank()) throw IOException("이미지 주소가 비어 있습니다")
            Page(i, pageUrl, img.toImageUrl(siteUrl, cdn))
        }
        if (pages.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        return pages
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, dataHeaders(page.url.ifBlank { "$baseUrl/" }))

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // 목록은 fetch* 에서 직접 처리하므로 사용하지 않음
    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request =
        throw UnsupportedOperationException()
    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    /** content.js 의 이미지 서버 선택 규칙을 그대로 계산 (스크립트는 실행하지 않음) */
    private fun imageCdn(v: Map<String, String>, nowMs: Long): String {
        fun domain(name: String): String? = v[name]?.toHttpUrlOrNull()
            ?.takeIf { it.username.isEmpty() && it.password.isEmpty() && it.query == null && it.fragment == null }
            ?.toString()?.let { it.trimEnd('/') + "/" }

        val x = v["toonlistid"]?.toLongOrNull()?.rem(100)
        val uptime = v["uptime"]?.toLongOrNull()
        val delay = v["img_per8"]?.toDoubleOrNull()
        if (x != null && uptime != null && delay != null) {
            if (nowMs > uptime.toDouble() - 5 * 60 * 60 * 1000 + delay * 60 * 1000) {
                var threshold = 0.0
                for (index in 3..7) {
                    threshold += v["img_per$index"]?.toDoubleOrNull() ?: break
                    if (x < threshold) return domain("img_domain$index") ?: domain("img_domain2") ?: CDN_URL
                }
            }
            return domain("img_domain8") ?: domain("img_domain2") ?: CDN_URL
        }
        return domain("img_domain2") ?: domain("img_domain") ?: CDN_URL
    }

    private fun String.toImageUrl(siteUrl: String, cdnUrl: String): String = when {
        startsWith("https://") || startsWith("http://") -> this
        startsWith("//") -> "https:$this"
        startsWith("/") -> siteUrl.trimEnd('/') + this
        else -> cdnUrl + this
    }

    // ---------- 페이지 안 스크립트에서 데이터 주소/설정값 읽기 (사이트 JS는 실행하지 않음) ----------
    private class PageScripts(val document: Document, val variables: Map<String, String>, val urls: List<HttpUrl>)

    // config.js 는 이미지 서버를 고를 때만 필요 (목록/회차는 페이지 변수로 충분)
    private fun pageScripts(
        html: String,
        pageUrl: String,
        withConfig: Boolean = true,
        fetchConfig: (String) -> String,
    ): PageScripts {
        val base = pageUrl.toHttpUrl()
        val document = Jsoup.parse(html, pageUrl)
        val variables = HashMap<String, String>()
        val configs = HashSet<String>()
        val candidates = ArrayList<HttpUrl>()
        val timeKey = SimpleDateFormat("mmHHddMMyy", Locale.US).format(Date())
        val random = Math.random().toString()

        fun addCandidate(value: String) {
            val url = base.resolve(value)
                ?.takeIf { it.username.isEmpty() && it.password.isEmpty() && it.fragment == null } ?: return
            if (CATALOG_PATH.matches(url.encodedPath) || CHAPTER_SCRIPT_PATH.matches(url.encodedPath)) candidates.add(url)
        }

        fun readConfig(value: String) {
            if (!withConfig) return
            val url = base.resolve(value) ?: return
            if (url.host != base.host || url.encodedPath != "/data/config.js" || url.fragment != null) return
            if (!configs.add(url.toString())) return
            try {
                readVariables(fetchConfig(url.toString()), variables)
            } catch (e: Exception) {
                // 다른 경로(script src / 인라인)로도 목록을 찾을 수 있으므로 무시
            }
        }

        for (script in document.select("script")) {
            if (script.hasAttr("src")) {
                readConfig(script.attr("src"))
                addCandidate(script.attr("src"))
            } else {
                val code = stripComments(script.data())
                readVariables(code, variables)
                CONFIG_SOURCE.findAll(code).forEach { m ->
                    readConfig(m.groupValues[1] + if (m.groupValues[2].isNotEmpty()) timeKey else "")
                }
                LOAD_SCRIPT_CALL.findAll(code).forEach { m ->
                    expression(m.groupValues[1], variables, random)?.let(::addCandidate)
                }
            }
        }
        return PageScripts(document, variables, candidates.distinct())
    }

    private fun readVariables(code: String, variables: MutableMap<String, String>) {
        VARIABLE.findAll(stripComments(code)).forEach { m ->
            val value = expression(m.groupValues[2], variables)
            if (value == null) variables.remove(m.groupValues[1]) else variables[m.groupValues[1]] = value
        }
    }

    /** "문자열" + 변수 + 숫자 + Math.random() 형태의 단순 이어붙이기만 계산 */
    private fun expression(expr: String, variables: Map<String, String>, random: String? = null): String? {
        val sb = StringBuilder()
        var offset = 0
        while (offset < expr.length) {
            val token = EXPR_TOKEN.find(expr, offset)?.takeIf { it.range.first == offset } ?: return null
            val value = token.groups[1]?.value ?: token.groups[2]?.value ?: token.groups[4]?.value
                ?: if (token.groups[5] != null) random else variables[token.groupValues[3]]
            sb.append(value ?: return null)
            offset = token.range.last + 1
            if (offset == expr.length) return sb.toString()
            if (expr[offset] != '+') return null
            offset++
        }
        return null
    }

    private fun stripComments(code: String): String = JS_COMMENTS.replace(code) {
        if (it.value.startsWith("//") || it.value.startsWith("/*")) "\n" else it.value
    }

    // ---------- 필터 ----------
    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun getFilterList() = ExtStatus.prepend(
        "blacktoon",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어와 필터를 함께 쓸 수 있음"),
                IntPick("정렬", "order", listOf(0 to "최신순", 1 to "인기순")),
                IntPick("상태", "status", listOf(-1 to "전체", 1 to "연재", 0 to "완결")),
                IntPick("플랫폼", "platform", listOf(-1 to "전체") + PLATFORMS.toList()),
                IntPick("요일", "day", listOf(-1 to "전체") + DAYS.toList()),
                IntPick("장르", "tag", listOf(-1 to "전체") + TAGS.toList()),
            ),
        ),
    )

    private class IntPick(name: String, val param: String, private val pairs: List<Pair<Int, String>>) :
        Filter.Select<String>(name, pairs.map { it.second }.toTypedArray()) {
        fun value(): Int = pairs[state].first
    }

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://blacktoon423.com"
        private const val GUIDE_URL = "https://blacktoonurl.net/"
        private const val CDN_URL = "https://aa3cc9.speedwebgo.com/"
        private const val POSTER_URL = "https://ttjsde.speedwebgo.com/"
        private const val COVER_MARK = "bt="
        private val DATA_HOSTS = listOf("https://jsc.speedwebgo.com", "https://ttjsde.speedwebgo.com")
        private const val USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
        private const val PAGE_SIZE = 24
        private val CATALOG_TTL = TimeUnit.MINUTES.toMillis(15)
        private val HOST_REGEX = Regex("^(www\\.)?blacktoon\\d+\\.com$")

        private val CATALOG_PATH = Regex("""/(?:webtoon_([01])|data/webtoon/webtoon_([01])_\d+)\.js""")
        private val CHAPTER_SCRIPT_PATH = Regex("""/data/toonlist/\d+\.js""")
        private const val LITERAL_VARIABLES = "inc_url2|inc_url1|inc_url|poster_js|img_domain[2-8]?|img_per[3-8]|toonlistid|uptime"
        private val VARIABLE =
            Regex("""(?:^|[;\r\n])\s*(?:(?:var|let|const)\s+)?($LITERAL_VARIABLES)\s*=\s*([^;\r\n]+)""")
        private val EXPR_TOKEN =
            Regex("""\s*(?:"([^"\\]*)"|'([^'\\]*)'|($LITERAL_VARIABLES)|(\d+(?:\.\d+)?)|(Math\.random\(\)))\s*""")
        private val LOAD_SCRIPT_CALL =
            Regex("""\b(?:loadScript|loadjs)\s*\(((?:"[^"\\]*"|'[^'\\]*'|Math\.random\(\)|[^"'();\r\n])+)\)""")
        private val CONFIG_SOURCE = Regex("""\bsrc=['"]([^'"\s]*?/data/config\.js[^'"\s]*)['"](\s*\+\s*timeKey\b)?""")
        private val CATALOG_PAYLOAD =
            Regex("""\s*(?:(?:var|let|const)\s+)?data([01])\s*=\s*(\[.*])\s*;?\s*""", RegexOption.DOT_MATCHES_ALL)
        private val CHAPTER_PAYLOAD =
            Regex("""\s*(?:(?:var|let|const)\s+)?clist\s*=\s*(\[.*])\s*;?\s*""", RegexOption.DOT_MATCHES_ALL)
        private val JS_COMMENTS =
            Regex(""""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|//[^\r\n]*|/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)

        private val PLATFORMS = mapOf(
            1 to "네이버", 2 to "다음", 3 to "카카오", 4 to "레진", 5 to "투믹스", 6 to "탑툰",
            7 to "코미카", 8 to "배틀코믹", 9 to "코믹GT", 10 to "케이툰", 11 to "애니툰", 12 to "폭스툰",
            13 to "피너툰", 14 to "봄툰", 15 to "코미코", 16 to "무툰", 17 to "지존신마", 99 to "기타",
        )
        private val TAGS = mapOf(
            1 to "학원", 2 to "액션", 3 to "SF", 4 to "스토리", 5 to "판타지", 6 to "BL/백합",
            7 to "개그/코미디", 8 to "연애/순정", 9 to "드라마", 10 to "로맨스", 11 to "시대극",
            12 to "스포츠", 13 to "일상", 14 to "추리/미스터리", 15 to "공포/스릴러", 16 to "성인",
            17 to "옴니버스", 18 to "에피소드", 19 to "무협", 20 to "소년", 99 to "기타",
        )
        private val DAYS = mapOf(
            1 to "월", 2 to "화", 3 to "수", 4 to "목", 5 to "금", 6 to "토", 7 to "일", 10 to "열흘",
        )
    }
}
