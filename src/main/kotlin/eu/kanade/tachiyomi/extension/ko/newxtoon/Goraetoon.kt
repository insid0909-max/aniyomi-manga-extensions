package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import android.util.JsonReader
import android.util.JsonToken
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
import rx.Observable
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 고래툰 (001.grtoon.com, 예전 주소 goraetoon##.com 은 새 주소로 넘겨 줌).
 * 목록: 사이트가 작품 목록을 통째로 JSON 으로 줌 (/catalog-data/webtoon-active·ongoing·completed.json, top.json)
 * → 사이트 화면과 같은 방식으로 걸러서 보여 줌. 완결 목록은 커서(약 14MB) 완결·검색을 볼 때만 받고 한동안 다시 받지 않음.
 * 작품: /webtoon/{번호}.html (회차 전부), 회차: /webtoons/{번호}/{회차}.html (그림은 img[o_src] + 그림 서버 주소)
 */
class Goraetoon : HttpSource(), ConfigurableSource {

    override val name = "고래툰 웹툰"

    override val id: Long = uniqueSourceId("newxtoon.goraetoon/ko/1")
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
        .addInterceptor { chain -> domainIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, MARKER))
        .build()

    private fun domainIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
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
        if (ours && (res.code >= 500 || res.code == 403)) {
            val found = discoverDomain(baseHost!!)
            if (found != null) {
                res.close()
                saveDomain("https://$found")
                return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
            }
        }
        val finalHost = res.request.url.host
        if (ours && finalHost != baseHost && GRTOON_HOST.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("^(\\d+)\\.grtoon").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /**
     * 현재 번호 주변(-2 ~ +30)의 ###.grtoon.com, 그리고 예전 주소 goraetoon1~40.com 이 넘겨 주는 주소 중
     * 고래툰이 열리는 ###.grtoon.com 을 찾음 (가장 큰 번호 우선)
     */
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
        fun open(url: String): String? = try {
            val r = Request.Builder().url(url).header("User-Agent", ua).build()
            plain.newCall(r).execute().use { res ->
                val fh = res.request.url.host
                if (!GRTOON_HOST.matches(fh) || res.code != 200) return@use null
                if (res.peekBody(300_000).string().contains(MARKER)) fh else null
            }
        } catch (e: Exception) {
            null
        }

        // ① 최신 주소 안내 페이지에 적힌 주소 (번호가 큰 것부터, 진짜 사이트가 열리는지 확인)
        for (g in GUIDE_URLS) {
            val body = try {
                plain.newCall(Request.Builder().url(g).header("User-Agent", ua).build()).execute()
                    .use { if (it.code == 200) it.body?.string().orEmpty() else "" }
            } catch (e: Exception) {
                ""
            }
            Regex("""\d{3}\.grtoon\.com""", RegexOption.IGNORE_CASE).findAll(body).map { it.value.lowercase() }.distinct()
                .filter { it != currentHost }.sortedByDescending { hostNumber(it) }.take(3)
                .forEach { h -> open("https://$h/")?.let { return@synchronized it } }
        }

        // ② 지금 번호 주변, 예전 주소 goraetoon##.com 이 넘겨 주는 주소
        val hosts = ((cur - 2).coerceAtLeast(1)..(cur + 30)).map { "%03d.grtoon.com".format(it) } +
            (1..40).map { "goraetoon%02d.com".format(it) }
        val pool = java.util.concurrent.Executors.newFixedThreadPool(12)
        try {
            val futures = hosts.filter { it != currentHost }.map { host -> pool.submit<String?> { open("https://$host/") } }
            futures.mapNotNull { it.get() }.distinct().maxByOrNull { hostNumber(it) }?.takeIf { it != currentHost }
        } finally {
            pool.shutdown()
        }
    }

    override fun headersBuilder(): Headers.Builder =
        super.headersBuilder().set("User-Agent", userAgent).set("Referer", "$baseUrl/")

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        ChapterPosition.addPref(screen)
        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소"
            summary = "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 주소가 확인되면 자동으로 바뀜 (기본: $DEFAULT, ###.grtoon.com 모양)"
            dialogTitle = "도메인 주소"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                val s = (v as String).trim().trimEnd('/')
                s.isEmpty() || DOMAIN_REGEX.matches(s)
            }
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "주소 번호가 바뀌어 접속이 안 되면 ###.grtoon.com 과 예전 주소(goraetoon##.com)가 넘겨 주는 주소 중 열리는 주소로 자동 변경"
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

    // ---------- 작품 목록 데이터 (사이트가 주는 JSON) ----------
    private class Work(
        val id: Long,
        val pid: String,
        val title: String,
        val author: String,
        val cover: String,
        val status: String,
        val day: String,
        val platform: String,
        val genres: List<String>,
        val updated: String,
        val views: Long,
        val order: Double?,
    )

    private val cacheLock = Any()
    private val cache = HashMap<String, Pair<Long, Any>>()

    /** 파일마다 받아 둔 시간 동안은 다시 받지 않음 (완결 목록은 커서 6시간) */
    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> cached(name: String, ttl: Long, load: () -> T): T {
        synchronized(cacheLock) {
            cache[name]?.let { (at, v) -> if (System.currentTimeMillis() - at < ttl) return v as T }
        }
        val v = try {
            load()
        } catch (e: Exception) {
            synchronized(cacheLock) { cache[name]?.second as T? } ?: throw e
        }
        synchronized(cacheLock) { cache[name] = System.currentTimeMillis() to v }
        return v
    }

    private fun works(file: String): List<Work> = cached(file, TTL[file] ?: 1_800_000L) {
        client.newCall(GET("$baseUrl/catalog-data/webtoon-$file.json", headers)).execute().use { res ->
            if (!res.isSuccessful) throw IOException("고래툰 작품 목록 요청 실패 HTTP ${res.code}")
            // 큰 파일이라 한 번에 풀지 않고 조금씩 읽음
            JsonReader(res.body!!.charStream()).use { readWorks(it) }
        }
    }

    private fun JsonReader.str(): String = if (peek() == JsonToken.NULL) {
        nextNull()
        ""
    } else {
        nextString()
    }

    private fun JsonReader.nameOf(): String {
        var out = ""
        beginObject()
        while (hasNext()) if (nextName() == "name") out = str() else skipValue()
        endObject()
        return out
    }

    private fun readWorks(r: JsonReader): List<Work> {
        val out = ArrayList<Work>()
        r.beginArray()
        while (r.hasNext()) {
            var id = 0L
            var pid = ""
            var title = ""
            var author = ""
            var cover = ""
            var status = ""
            var day = ""
            var platform = ""
            val genres = ArrayList<String>()
            var updated = ""
            var views = 0L
            var order: Double? = null
            r.beginObject()
            while (r.hasNext()) {
                val k = r.nextName()
                if (r.peek() == JsonToken.NULL) {
                    r.nextNull()
                    continue
                }
                when (k) {
                    "id" -> id = r.nextLong()
                    "public_id" -> pid = r.nextString()
                    "title" -> title = r.nextString()
                    "author" -> author = r.nextString()
                    "cover_path" -> cover = r.nextString()
                    "status" -> status = r.nextString()
                    "publish_day" -> day = r.nextString()
                    "platform" -> platform = r.nameOf()
                    "genres" -> {
                        r.beginArray()
                        while (r.hasNext()) genres.add(r.nameOf())
                        r.endArray()
                    }
                    "updated_at" -> updated = r.nextString()
                    "view_count_total" -> views = r.nextLong()
                    "catalog_order" -> order = r.nextString().toDoubleOrNull()
                    else -> r.skipValue()
                }
            }
            r.endObject()
            if (title.isNotEmpty() && (pid.isNotEmpty() || id > 0)) {
                out.add(Work(id, pid.ifEmpty { id.toString() }, title, author, cover, status, day, platform, genres, updated, views, order))
            }
        }
        r.endArray()
        return out
    }

    /** BEST 목록: 기간(day·week·month·realtime) → 분류(comm·adult·bl) → 작품 id 목록 */
    private fun top(): JSONObject = cached("top", 600_000L) {
        client.newCall(GET("$baseUrl/catalog-data/top.json", headers)).execute().use { res ->
            if (!res.isSuccessful) throw IOException("고래툰 BEST 목록 요청 실패 HTTP ${res.code}")
            JSONObject(res.body!!.string())
        }
    }

    // ---------- 목록 만들기 (사이트 화면과 같은 규칙) ----------
    private class Query(
        var list: String = "ongoing",
        var best: String = "comm",
        var day: String = "",
        var platform: String = "",
        var genre: String = "",
        var sort: String = "new",
    )

    private fun squash(s: String) = s.trim().replace(SPACES, "").uppercase()

    private fun select(q: Query, keyword: String): List<Work> {
        val base: List<Work> = when {
            keyword.isNotEmpty() -> {
                val k = squash(keyword)
                (works("ongoing") + works("completed")).distinctBy { it.id }
                    .filter { squash(it.title).contains(k) || squash(it.author).contains(k) }
            }
            q.list in BEST_PERIODS -> {
                val ids = top().optJSONObject(q.list)?.optJSONArray(q.best)
                    ?: return emptyList()
                val byId = (works("ongoing") + works("active")).associateBy { it.id }
                return (0 until ids.length()).mapNotNull { byId[ids.optLong(it)] }
            }
            q.list == "completed" -> works("completed")
            q.day.isEmpty() -> works("active")
            else -> works("ongoing").filter { it.day == q.day }
        }
        val filtered = base.filter {
            (q.platform.isEmpty() || it.platform == q.platform) && (q.genre.isEmpty() || q.genre in it.genres)
        }
        return if (q.sort == "hot") {
            filtered.sortedByDescending { it.views }
        } else {
            // 사이트 순서: catalog_order(있는 것 먼저, 작은 순) → 업데이트 최신순
            filtered.sortedWith(compareBy<Work>({ it.order == null }, { it.order ?: 0.0 }).thenByDescending { it.updated })
        }
    }

    private fun cover(path: String): String? = when {
        path.isEmpty() -> null
        path.startsWith("http") -> path
        else -> baseUrl + "/" + path.trimStart('/')
    }

    private fun Work.toSManga() = SManga.create().apply {
        url = "/webtoon/$pid.html"
        title = this@toSManga.title
        thumbnail_url = cover(this@toSManga.cover)
        author = this@toSManga.author.ifEmpty { null }
        genre = genres.joinToString(", ").ifEmpty { null }
        status = statusOf(this@toSManga.status)
    }

    private fun page(list: List<Work>, page: Int): MangasPage {
        val from = (page - 1) * PAGE_SIZE
        val part = list.drop(from).take(PAGE_SIZE).map { it.toSManga() }
        return MangasPage(part, from + PAGE_SIZE < list.size)
    }

    private fun queryOf(filters: FilterList): Query {
        val q = Query()
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                when (f.param) {
                    "list" -> q.list = v
                    "best" -> q.best = v
                    "day" -> q.day = v
                    "platform" -> q.platform = v
                    "genre" -> q.genre = v
                    "sort" -> q.sort = v
                }
            }
        }
        return q
    }

    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { page(select(Query(list = "realtime"), ""), page) }

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { page(select(Query(), ""), page) }

    /** 붙여 넣은 사이트 주소 → 작품 주소 (회차 주소면 그 작품) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? {
        val seg = u.pathSegments.filter { it.isNotEmpty() }
        return when {
            seg.size == 2 && seg[0] == "webtoon" && seg[1].endsWith(".html") -> "/webtoon/${seg[1]}"
            seg.size == 3 && seg[0] == "webtoons" -> "/webtoon/${seg[1]}.html"
            else -> null
        }
    }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return Observable.fromCallable { page(select(queryOf(filters), query.trim()), page) }
    }

    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request = throw UnsupportedOperationException()
    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    // ---------- 상세 ----------
    private fun Response.asDoc(): Document = use { Jsoup.parse(it.body?.string().orEmpty(), it.request.url.toString()) }

    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga = detailsOf(response.asDoc())

    private fun detailsOf(d: Document): SManga {
        val meta = d.selectFirst("article.work-detail .work-meta")
        val head = d.selectFirst(".episode-list .section-header h2")?.text().orEmpty()
        return SManga.create().apply {
            title = meta?.selectFirst("h1")?.text()?.trim()
                ?: d.selectFirst("article.work-detail")?.attr("data-work-title").orEmpty()
            thumbnail_url = d.selectFirst("article.work-detail .work-cover img")?.absUrl("src")?.ifEmpty { null }
                ?: d.selectFirst("article.work-detail")?.attr("data-work-cover")?.ifEmpty { null }
            author = meta?.selectFirst(".author-meta")?.text()?.substringAfter(":")?.trim()?.ifEmpty { null }
            genre = meta?.select(".tag-list .tag-badge:not(.day-badge)")?.map { it.text().trim() }
                ?.filter { it.isNotEmpty() }?.joinToString(", ")?.ifEmpty { null }
            val info = listOfNotNull(
                meta?.selectFirst(".platform-meta")?.text()?.trim()?.ifEmpty { null },
                meta?.selectFirst(".day-badge")?.text()?.trim()?.ifEmpty { null }?.let { if (it == "10") "10일마다" else "${it}요일" },
                meta?.selectFirst(".age-rating-badge")?.text()?.trim()?.takeIf { it.isNotEmpty() && it != "ALL" }?.let { "${it}세" },
                head.ifEmpty { null },
            ).joinToString(" · ")
            val synopsis = meta?.select("> p")?.firstOrNull { it.classNames().isEmpty() }?.text()?.trim()?.trim('"')?.trim().orEmpty()
            description = listOf(synopsis, info).filter { it.isNotEmpty() }.joinToString("\n\n").ifEmpty { null }
            status = when {
                head.startsWith("완결") -> SManga.COMPLETED
                head.startsWith("휴재") -> SManga.ON_HIATUS
                head.startsWith("연재") -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    private fun statusOf(s: String) = when (s) {
        "ongoing" -> SManga.ONGOING
        "completed" -> SManga.COMPLETED
        "paused" -> SManga.ON_HIATUS
        else -> SManga.UNKNOWN
    }

    override fun getMangaUrl(manga: SManga): String = baseUrl + manga.url

    override fun getChapterUrl(chapter: SChapter): String = baseUrl + chapter.url

    // ---------- 회차 (작품 화면에 전부 있음, 최신 → 과거) ----------
    override fun chapterListRequest(manga: SManga): Request = GET(baseUrl + manga.url, headers)

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    private fun dateOf(text: String): Long = try {
        DATE_REGEX.find(text)?.value?.let { dateFmt.parse(it)?.time } ?: 0L
    } catch (e: Exception) {
        0L
    }

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서), 이름 끝에 남은 화 수
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            ChapterOrder.sort(it, manga.title).let { l -> if (ChapterPosition.enabled(sp)) ChapterPosition.label(l, manga.title) else l }
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val seen = HashSet<String>()
        return d.select("#episode-list a.episode-row[href]").mapNotNull { a ->
            val path = pathOf(a.absUrl("href").ifEmpty { a.attr("href") })
            if (!path.startsWith("/webtoons/") || !seen.add(path)) return@mapNotNull null
            SChapter.create().apply {
                url = path
                name = a.selectFirst(".episode-title-line strong")?.text()?.trim()?.ifEmpty { null }
                    ?: a.text().trim()
                chapter_number = a.attr("data-episode-no").toFloatOrNull() ?: -1f
                date_upload = dateOf(a.selectFirst(".episode-meta-line")?.text().orEmpty())
            }
        }
    }

    // ---------- 그림 ----------
    override fun pageListRequest(chapter: SChapter) = GET(baseUrl + chapter.url, headers)

    override fun pageListParse(response: Response): List<Page> {
        val body = response.use { it.body?.string().orEmpty() }
        val d = Jsoup.parse(body, response.request.url.toString())
        // 사이트 스크립트와 같은 방식: o_src 가 주소 모양이 아니면 그림 서버 주소(__IMAGE_HOST) 뒤에 붙임
        val host = IMAGE_HOST_REGEX.find(body)?.groupValues?.get(1)?.replace("\\/", "/")?.trimEnd('/').orEmpty()
        val urls = d.select("img[o_src]").mapNotNull { img ->
            val p = img.attr("o_src").trim()
            when {
                p.isEmpty() -> null
                p.startsWith("http") -> p
                p.startsWith("/") -> img.absUrl("o_src")
                host.isNotEmpty() -> "$host/$p"
                else -> null
            }
        }.distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (제목: ${d.title().take(40)})")
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    private fun pathOf(href: String): String = Regex("^https?://[^/]+(/.*)$").find(href)?.groupValues?.get(1) ?: href

    // ---------- 필터 ----------
    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    override fun getFilterList() = ExtStatus.prepend(
        "goraetoon",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어는 제목·작가 (연재·완결 전체에서 찾음, 정렬만 적용)"),
                Pick("목록", "list", LISTS),
                Pick("BEST 분류 (BEST 목록만)", "best", BEST_TYPES),
                Pick("요일 (연재만)", "day", DAYS),
                Pick("플랫폼 (연재·완결)", "platform", listOf("전체" to "") + PLATFORMS.map { it to it }),
                Pick("장르 (연재·완결)", "genre", listOf("전체" to "") + GENRES.map { it to it }),
                Pick("정렬 (연재·완결)", "sort", SORTS),
            ),
        ),
    )

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://002.grtoon.com"

        // 최신 주소 안내 (사용자가 알려 줌, 2026-10-31, "고래툰 최신주소 https://NNN.grtoon.com/")
        private val GUIDE_URLS = listOf("https://goraetoonurl.com/latest-address")

        /** 진짜 사이트 화면마다 있는 글자 (로딩 그림 이름) */
        private const val MARKER = "goraetoon-loading.svg"
        private const val PAGE_SIZE = 30
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"

        /** 지금 주소(###.grtoon.com)와 예전 주소(goraetoon##.com, 새 주소로 넘겨 줌) */
        private val HOST_REGEX = Regex("^(\\d{3}\\.grtoon\\.com|(www\\.)?goraetoon\\d+\\.com)$")
        private val GRTOON_HOST = Regex("^\\d{3}\\.grtoon\\.com$")
        private val DOMAIN_REGEX = Regex("^https?://\\d{3}\\.grtoon\\.com$")
        private val DATE_REGEX = Regex("""\d{4}-\d{2}-\d{2}""")
        private val IMAGE_HOST_REGEX = Regex("""__IMAGE_HOST\s*=\s*['"]([^'"]+)['"]""")
        private val SPACES = Regex("""\s+""")

        /** 받아 둔 목록을 다시 받기까지 (오늘 업데이트 10분, 연재 30분, 완결 6시간) */
        private val TTL = mapOf("active" to 600_000L, "ongoing" to 1_800_000L, "completed" to 21_600_000L)
        private val BEST_PERIODS = setOf("day", "week", "month", "realtime")

        private val LISTS = listOf(
            "연재 (오늘 업데이트)" to "ongoing", "완결" to "completed",
            "실시간 BEST" to "realtime", "일간 BEST" to "day", "주간 BEST" to "week", "월간 BEST" to "month",
        )
        private val BEST_TYPES = listOf("일반웹툰" to "comm", "성인웹툰" to "adult", "BL/백합" to "bl")
        private val DAYS = listOf(
            "전체 (UP)" to "", "월" to "mon", "화" to "tue", "수" to "wed", "목" to "thu",
            "금" to "fri", "토" to "sat", "일" to "sun", "10일" to "ten",
        )
        private val SORTS = listOf("최신순" to "new", "인기순" to "hot")
        private val PLATFORMS = listOf(
            "네이버", "다음", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹", "코믹GT",
            "케이툰", "애니툰", "폭스툰", "피너툰", "봄툰", "코미코", "무툰", "기타",
        )
        private val GENRES = listOf(
            "학원", "액션", "SF", "스토리", "판타지", "BL/백합", "개그/코미디", "연애/순정", "드라마", "로맨스", "시대극",
            "스포츠", "일상", "추리/미스터리", "공포/스릴러", "성인", "옴니버스", "에피소드", "무협", "소년", "기타",
        )
    }
}
