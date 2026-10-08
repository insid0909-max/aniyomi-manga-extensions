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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 11toon (일일툰, 11toon2.com) 모바일 페이지(/mb) 구조
 * - 작품: /mb/content/info/{id}?page=toon, 회차: /mb/content/image/{id}?page=toon&parent_id={작품id}
 * - 데이터 API: /iapi/t3 (작품 정보+회차 목록), /iapi/t4 (랭킹), /iapi/t5 (회차 이미지)
 */
class Toon11 : HttpSource(), ConfigurableSource {

    override val name = "11toon 만화"
    override val lang = "ko"
    override val supportsLatest = true

    // 다른 저장소의 11toon 확장과 소스 ID가 겹치지 않도록 고유 ID 사용
    override val id: Long = uniqueSourceId("newxtoon.toon11/ko/1")

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
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            }
        }

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
        .set("Referer", "$baseUrl/mb")

    // 사이트는 모든 API 요청에 페이지의 _token 을 X-CSRF-TOKEN 헤더로 보냄
    @Volatile
    private var csrfToken: String? = null

    private fun token(): String? {
        csrfToken?.let { return it }
        return try {
            client.newCall(GET("$baseUrl/mb", headers)).execute().use { res ->
                res.asDoc().selectFirst("meta[name=_token]")?.attr("content")?.ifEmpty { null }
            }?.also { csrfToken = it }
        } catch (e: Exception) {
            null
        }
    }

    private fun apiHeaders(referer: String, withToken: Boolean = true): Headers = headersBuilder()
        .apply { if (withToken) token()?.let { set("X-CSRF-TOKEN", it) } }
        .set("Referer", referer)
        .set("Accept", "application/json, text/javascript, */*; q=0.01")
        .set("X-Requested-With", "XMLHttpRequest")
        .build()

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> smartIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, "content/info/"))
        .build()

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val auto = baseHost != null && req.url.host == baseHost && autoDomain() && HOST_REGEX.matches(baseHost)

        val res = try {
            chain.proceed(req)
        } catch (e: IOException) {
            val found = if (auto) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            saveDomain("https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }

        if (res.code == 451) {
            res.close()
            throw IOException("접근 차단됨 (HTTP 451). 확장 설정에서 도메인 주소를 확인하세요.")
        }
        val finalHost = res.request.url.host
        if (auto && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("11toon(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 11toon1~30.com 중 일일툰 페이지가 열리는 주소 (큰 번호 우선) */
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
        val www = if (currentHost.startsWith("www.")) "www." else ""
        val pool = java.util.concurrent.Executors.newFixedThreadPool(10)
        try {
            val futures = (1..30).map { "${www}11toon$it.com" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/mb").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                val ok = res.code == 200 && HOST_REGEX.matches(fh) &&
                                    (res.body?.string() ?: "").contains("content/info/")
                                if (ok) fh else null
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
            summary = "주소 번호가 바뀌어 접속이 안 되면 11toon1~30.com 중 열리는 주소로 자동 변경"
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

    // ---------- 공통: API(JSON) ----------
    // 조회(GET) API는 토큰 없이 바로 요청 (메인 페이지를 먼저 받지 않아 빠름), 실패하면 토큰을 붙여 한 번 더
    private fun getJson(url: String, referer: String): JSONObject? {
        for (withToken in listOf(false, true)) {
            val json = try {
                client.newCall(GET(url, apiHeaders(referer, withToken))).execute().use { res ->
                    if (!res.isSuccessful) return@use null
                    val body = res.body?.string().orEmpty()
                    val start = body.indexOf('{')
                    if (start < 0) null else JSONObject(body.substring(start))
                }
            } catch (e: Exception) {
                null
            }
            if (json != null && (!json.has("code") || json.optInt("code") == 200)) return json
        }
        return null
    }

    /** 응답 형식: {"data":{"SucCode":20000,"SucData":{...}},"code":200} */
    private fun sucData(o: JSONObject): JSONObject =
        o.optJSONObject("data")?.optJSONObject("SucData") ?: o.optJSONObject("SucData") ?: o.optJSONObject("data") ?: o

    /** 스크립트가 채우기 전 자리표시 글자 */
    private fun isPlaceholder(t: String?) = t.isNullOrBlank() || t.trim().lowercase().startsWith("loading")

    /** 응답 안 어디에 있든 id + subject 를 가진 작품 객체들을 모음 */
    private fun collectItems(node: Any?, out: MutableList<JSONObject>) {
        when (node) {
            is JSONObject -> {
                if (node.has("id") && node.has("subject")) {
                    out.add(node)
                } else {
                    node.keys().forEach { collectItems(node.opt(it), out) }
                }
            }
            is JSONArray -> for (i in 0 until node.length()) collectItems(node.opt(i), out)
            is String -> if (node.startsWith("{")) {
                try {
                    collectItems(JSONObject(node), out)
                } catch (e: Exception) {
                    // 무시
                }
            }
        }
    }

    private fun imageOf(o: JSONObject): String? {
        val img = o.opt("image")
        val raw = when (img) {
            is JSONObject -> img.optString("Big").ifEmpty { img.optString("Small") }
            is String -> img
            else -> ""
        }
        return raw.takeIf { it.isNotBlank() }?.let { absolute(it) }
    }

    private fun absolute(u: String): String = when {
        u.startsWith("http") -> u
        u.startsWith("//") -> "https:$u"
        else -> "$baseUrl/${u.removePrefix("/")}"
    }

    private fun mangaUrl(id: String) = "/mb/content/info/$id?page=toon"

    private fun mangaId(url: String): String? = Regex("/content/info/(\\d+)").find(url)?.groupValues?.get(1)

    // ---------- 목록 ----------
    // 인기: 랭킹 API(t4, menucode=TopCoce 400) → 실패하면 메인(/mb) 목록
    // 필터 조건을 인기/최신 탭에 저장해 두었으면 그 조건으로
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { rankingPage(TOP_CODE, page) ?: mainPage(page) }

    // 최신: t4 (menucode=NewCoce 100) → 실패하면 메인(/mb) 목록
    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { rankingPage(NEW_CODE, page) ?: mainPage(page) }

    private fun mainPage(page: Int): MangasPage =
        if (page == 1) client.newCall(GET("$baseUrl/mb", headers)).execute().use { parseHtmlList(it) } else MangasPage(emptyList(), false)

    /** 응답: {"data":{"SucData":[작품...],"SucAllCnt":N},"code":200} */
    private fun rankingPage(menuCode: String, page: Int): MangasPage? {
        val api = "$baseUrl/iapi/t4".toHttpUrl().newBuilder()
            .addQueryParameter("usercode", USER_CODE)
            .addQueryParameter("menucode", menuCode)
            .addQueryParameter("page", page.toString())
            .addQueryParameter("pagerow", PAGE_ROW.toString())
            .addQueryParameter("type", "0")
            .build().toString()
        return apiListPage(api, "$baseUrl/mb", page)
    }

    /** 사이트 "만화분류" 화면과 같은 목록 (/iapi/t2: 장르 SType, 국가 SCountry, 연재 SEnd) */
    private fun categoryPage(filters: FilterList, page: Int): MangasPage {
        fun sel(f: Filter.Select<String>?) = f?.state ?: 0
        val genre = sel(filters.filterIsInstance<GenreFilter>().firstOrNull())
        val country = COUNTRIES.getOrNull(sel(filters.filterIsInstance<CountryFilter>().firstOrNull()))?.second ?: 0
        val end = sel(filters.filterIsInstance<EndFilter>().firstOrNull())
        val api = "$baseUrl/iapi/t2".toHttpUrl().newBuilder()
            .addQueryParameter("Page", page.toString())
            .addQueryParameter("Pagerow", PAGE_ROW.toString())
            .addQueryParameter("SType", genre.toString())
            .addQueryParameter("SCountry", country.toString())
            .addQueryParameter("SEnd", end.toString())
            .addQueryParameter("SzA_Z", "0")
            .addQueryParameter("MenuCode", "1000")
            .build().toString()
        val referer = "$baseUrl/mb/search/content?page=toon&SType=$genre&SCountry=$country&SEnd=$end"
        return apiListPage(api, referer, page) ?: MangasPage(emptyList(), false)
    }

    private fun apiListPage(api: String, referer: String, page: Int): MangasPage? {
        val json = getJson(api, referer) ?: return null
        val items = ArrayList<JSONObject>()
        collectItems(sucData(json).opt("SucData") ?: json.optJSONObject("data")?.opt("SucData") ?: json, items)
        val mangas = items.mapNotNull { o ->
            val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            SManga.create().apply {
                url = mangaUrl(id)
                title = o.optString("subject").trim()
                author = o.optString("maker").trim().ifEmpty { null }
                thumbnail_url = imageOf(o)?.also { rememberCover(it) } ?: coverFor(id)
            }
        }.filter { !isPlaceholder(it.title) }.distinctBy { it.url }
        if (mangas.isEmpty()) return if (page > 1) MangasPage(emptyList(), false) else null
        // 다음 쪽은 이번 쪽이 꽉 찼고(요청한 개수만큼 옴) 전체 개수가 더 많을 때만
        val total = json.optJSONObject("data")?.optInt("SucAllCnt", -1) ?: -1
        val hasNext = items.size >= PAGE_ROW && (total < 0 || page * PAGE_ROW < total)
        return MangasPage(mangas, hasNext)
    }

    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()

    // 검색: 사이트처럼 검색 페이지를 연 뒤(토큰/쿠키) POST /mb/top_search 로 결과(JSON)를 받음
    /** 붙여 넣은 사이트 주소 → 작품 주소 (모르는 모양이면 null) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        mangaId(u.toString())?.let { mangaUrl(it) }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        // 검색어가 없으면 필터(만화분류) 목록
        if (query.isBlank()) return Observable.fromCallable { categoryPage(filters, page) }
        return Observable.fromCallable {
            val q = query.trim()
            val pageUrl = "$baseUrl/mb/top_search".toHttpUrl().newBuilder()
                .addQueryParameter("subject", q).build().toString()
            val doc = client.newCall(GET(pageUrl, headers)).execute().use { it.asDoc() }

            // 결과가 페이지에 이미 그려져 있으면 그대로 사용
            val inPage = parseCards(doc)
            if (inPage.isNotEmpty() && page == 1) return@fromCallable MangasPage(inPage, false)

            val token = doc.selectFirst("meta[name=_token]")?.attr("content").orEmpty()
            if (token.isNotEmpty()) csrfToken = token
            val form = okhttp3.FormBody.Builder()
                .add("subject", q)
                .add("page", page.toString())
                .add("pagerow", SEARCH_ROW.toString())
                .apply { if (token.isNotEmpty()) add("_token", token) }
                .build()
            val h = apiHeaders(pageUrl).newBuilder()
                .apply { if (token.isNotEmpty()) set("X-CSRF-TOKEN", token) }
                .set("Origin", baseUrl)
                .build()
            val body = client.newCall(okhttp3.Request.Builder().url("$baseUrl/mb/top_search").headers(h).post(form).build())
                .execute().use { if (it.isSuccessful) it.body?.string().orEmpty() else "" }

            val items = ArrayList<JSONObject>()
            parseJsonAny(body)?.let { collectItems(it, items) }
            val mangas = items
                .filter { o -> o.optString("type").let { it.isEmpty() || it == "만화" || it == "toon" } }
                .mapNotNull { o ->
                    val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    SManga.create().apply {
                        url = mangaUrl(id)
                        title = o.optString("subject").trim()
                        author = o.optString("maker").trim().ifEmpty { null }
                        thumbnail_url = imageOf(o) ?: coverFor(id)
                    }
                }.filter { it.title.isNotEmpty() }.distinctBy { it.url }
            MangasPage(mangas, items.size >= SEARCH_ROW)
        }
    }

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request =
        throw UnsupportedOperationException()

    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    private fun parseJsonAny(body: String): Any? {
        val i = body.indexOfFirst { it == '{' || it == '[' }
        if (i < 0) return null
        return try {
            if (body[i] == '{') JSONObject(body.substring(i)) else JSONArray(body.substring(i))
        } catch (e: Exception) {
            null
        }
    }

    // 표지 서버 (예: //11toon8.com/data/toon_category/{id}.webp) - 목록에서 본 주소를 기억
    @Volatile
    private var coverBase = "https://11toon8.com/data/toon_category/"

    private fun coverFor(id: String) = "$coverBase$id.webp"

    private fun rememberCover(url: String?) {
        val u = url ?: return
        val i = u.indexOf("/data/toon_category/")
        if (i > 0) coverBase = u.substring(0, i) + "/data/toon_category/"
    }

    /** /mb/content/info/{id} 링크가 걸린 카드들을 모두 읽음 (메인, 랭킹, 검색 공통) */
    private fun parseHtmlList(response: Response): MangasPage = MangasPage(parseCards(response.asDoc()), false)

    private fun parseCards(doc: Document): List<SManga> {
        val seen = HashSet<String>()
        // 검색 결과처럼 링크 대신 onclick="ContentView('/mb/content/info/1?page=toon')" 인 경우
        val clicks = doc.select("[onclick*=/content/info/]").mapNotNull { el ->
            val id = mangaId(el.attr("onclick")) ?: return@mapNotNull null
            if (el.attr("onclick").contains("page=aini") || !seen.add(id)) return@mapNotNull null
            val title = el.ownText().trim().ifEmpty { el.text().trim() }
            if (isPlaceholder(title)) return@mapNotNull null
            SManga.create().apply {
                url = mangaUrl(id)
                this.title = title
                thumbnail_url = coverFor(id)
            }
        }
        return clicks + doc.select("a[href*=/content/info/]").mapNotNull { a ->
            val id = mangaId(a.attr("href")) ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            val title = (a.selectFirst("h4, h3, .subject, .title")?.text() ?: a.selectFirst("img[alt]")?.attr("alt"))
                ?.trim().orEmpty()
            if (isPlaceholder(title)) return@mapNotNull null
            SManga.create().apply {
                url = mangaUrl(id)
                this.title = title
                // 실제 표지(toon_category)가 아니면 자리표시 그림이므로 작품 번호로 표지 주소를 만듦
                thumbnail_url = a.select("img").map { it.attr("data-original").ifEmpty { it.attr("data-src") }.ifEmpty { it.attr("src") } }
                    .firstOrNull { it.contains("toon_category") }
                    ?.let { absolute(it) }?.also { rememberCover(it) } ?: coverFor(id)
            }
        }
    }

    // ---------- 상세 + 회차 (작품 페이지 / t3 API) ----------
    private fun t3(id: String): JSONObject? {
        val url = "$baseUrl/iapi/t3".toHttpUrl().newBuilder()
            .addQueryParameter("usercode", USER_CODE)
            .addQueryParameter("menucode", MENU_CODE)
            .addQueryParameter("parent", id)
            .addQueryParameter("ordertype", "1")
            .build().toString()
        return getJson(url, baseUrl + mangaUrl(id))?.let { sucData(it) }
    }

    override fun mangaDetailsRequest(manga: SManga): Request = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val doc = response.asDoc()
        val id = mangaId(response.request.url.toString())
        val data = id?.let { t3(it)?.optJSONObject("ToonData") }
        fun dd(label: String) = doc.select(".head-text dl").firstOrNull { it.selectFirst("dt")?.text()?.contains(label) == true }
            ?.selectFirst("dd")?.text()?.trim()?.takeUnless { isPlaceholder(it) }
        return SManga.create().apply {
            title = data?.optString("subject")?.trim()?.ifEmpty { null }
                ?: doc.selectFirst(".head-text h3")?.text()?.trim()?.takeUnless { isPlaceholder(it) }.orEmpty()
            thumbnail_url = data?.let { imageOf(it) }
                ?: doc.selectFirst(".head-img img")?.attr("src")?.takeIf { it.contains("toon_category") }?.let { absolute(it) }
                ?: id?.let { coverFor(it) }
            author = data?.optString("maker")?.trim()?.ifEmpty { null } ?: dd("작가")
            genre = (data?.optString("caname")?.trim()?.ifEmpty { null } ?: dd("장르"))
                ?.split(",", "/")?.map { it.trim() }?.filter { it.isNotEmpty() }?.joinToString(", ")
            description = data?.optString("memo")?.trim()?.ifEmpty { null }
                ?: doc.selectFirst(".manga-detail-body .pre p")?.text()?.trim()?.ifEmpty { null }
            val state = data?.optString("end")?.trim()?.ifEmpty { null } ?: dd("상태").orEmpty()
            status = when {
                state.contains("완결") -> SManga.COMPLETED
                state.contains("연재") || state.contains("주간") || state.contains("월간") || state.contains("격주") -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    override fun chapterListRequest(manga: SManga): Request = GET(baseUrl + manga.url, headers)

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서)
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            ChapterOrder.sort(it, manga.title).let { l -> if (ChapterPosition.enabled(sp)) ChapterPosition.label(l) else l }
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val doc = response.asDoc()
        val id = mangaId(response.request.url.toString()) ?: throw IOException("잘못된 작품 주소")
        val title = doc.selectFirst(".head-text h3")?.text()?.trim().orEmpty()

        // 1) t3 API (사이트가 목록을 그리는 데 쓰는 데이터, 날짜 포함)
        var list: List<SChapter> = emptyList()
        val data = t3(id)
        if (data != null) {
            val subject = data.optJSONObject("ToonData")?.optString("subject")?.trim().orEmpty().ifEmpty { title }
            val arr = data.optJSONArray("ToonList") ?: JSONArray()
            list = (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val cid = o.optString("id").ifEmpty { return@mapNotNull null }
                val full = o.optString("subject").trim()
                // 사이트와 같이 회차 제목에서 작품 제목을 뺌 ("Re: 열혈강호 14권" → "Re: 14권")
                val name = (if (subject.isNotEmpty()) full.replace(subject, "") else full)
                    .replace(Regex("\\s+"), " ").trim().ifEmpty { full }
                chapter(cid, o.optString("parentid").ifEmpty { id }, name).apply {
                    date_upload = try {
                        synchronized(dateFmt) { dateFmt.parse(o.optString("datetime"))?.time } ?: 0L
                    } catch (e: Exception) {
                        0L
                    }
                }
            }
        }

        // 2) 실패하면 페이지에 그려진 목록
        if (list.isEmpty()) {
            list = doc.select("a[href*=/content/image/]").mapNotNull { a ->
                val cid = Regex("/content/image/(\\d+)").find(a.attr("href"))?.groupValues?.get(1) ?: return@mapNotNull null
                val name = a.ownText().trim().ifEmpty { a.text().substringBefore("(").trim() }
                chapter(cid, id, name.ifEmpty { cid })
            }
        }
        if (list.isEmpty()) throw IOException("11toon 회차 목록을 불러오지 못했습니다")
        // 사이트는 1화부터 순서대로 → 앱은 최신화가 위로
        return list.distinctBy { it.url }.reversed()
    }

    private val dateFmt = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.ROOT).apply {
        timeZone = java.util.TimeZone.getTimeZone("Asia/Seoul")
    }

    private fun chapter(cid: String, parent: String, name: String) = SChapter.create().apply {
        url = "/mb/content/image/$cid?page=toon&parent_id=$parent"
        this.name = name.replace(' ', ' ')
        chapter_number = Regex("(\\d+(?:\\.\\d+)?)\\s*화").find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
    }

    // ---------- 이미지 ----------
    // 1) t5 API를 바로 호출 (회차 페이지를 먼저 받지 않아 빠름)
    // 2) 실패하면 회차 페이지를 한 번 열어 세션/쿠키를 만든 뒤 다시 시도 (최대 3번)
    // 3) 그래도 없으면 회차 페이지의 #ImageShow 이미지
    override fun fetchPageList(chapter: SChapter): Observable<List<Page>> = Observable.fromCallable {
        val pageUrl = (baseUrl + chapter.url).toHttpUrl()
        val referer = pageUrl.toString()
        val cid = Regex("/content/image/(\\d+)").find(pageUrl.encodedPath)?.groupValues?.get(1)
            ?: throw IOException("잘못된 회차 주소")
        val parent = pageUrl.queryParameter("parent_id").orEmpty()

        var urls = emptyList<String>()
        var doc: Document? = null
        for (attempt in 0 until 3) {
            urls = t5Images(cid, parent, referer)
            if (urls.isNotEmpty()) break
            if (attempt == 0) {
                doc = try {
                    client.newCall(GET(referer, headers)).execute().use { it.asDoc() }
                } catch (e: Exception) {
                    null
                }
                doc?.selectFirst("meta[name=_token]")?.attr("content")?.ifEmpty { null }?.let { csrfToken = it }
            } else {
                Thread.sleep(500L * attempt)
            }
        }
        if (urls.isEmpty()) {
            urls = doc?.select("#ImageShow img")
                ?.mapNotNull { it.attr("src").takeIf { s -> s.isNotBlank() }?.let { s -> absolute(s) } }
                .orEmpty()
        }
        if (urls.isEmpty()) throw IOException("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        urls.distinct().mapIndexed { i, u -> Page(i, referer, u) }
    }

    /** 응답: data.SucData.Image.imagelist (JSON 문자열 배열) + Image.file (이미지 주소 앞부분) */
    private fun t5Images(cid: String, parent: String, referer: String): List<String> {
        val api = "$baseUrl/iapi/t5".toHttpUrl().newBuilder()
            .addQueryParameter("id", cid)
            .addQueryParameter("parent", parent)
            .build().toString()
        val image = getJson(api, referer)?.let { sucData(it) }?.optJSONObject("Image") ?: return emptyList()
        val file = image.optString("file")
        val arr = when (val raw = image.opt("imagelist")) {
            is JSONArray -> raw
            is String -> try {
                JSONArray(raw)
            } catch (e: Exception) {
                JSONArray()
            }
            else -> JSONArray()
        }
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
            .map { if (it.startsWith("http") || it.startsWith("//")) absolute(it) else absolute(file + it) }
    }

    override fun pageListRequest(chapter: SChapter): Request = GET(baseUrl + chapter.url, headers)
    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", page.url.ifEmpty { "$baseUrl/mb" }).build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 필터 (사이트 "만화분류"와 같음, 검색어가 없을 때 사용) ----------
    private class GenreFilter : Filter.Select<String>("장르", GENRES)
    private class CountryFilter : Filter.Select<String>("국가", COUNTRIES.map { it.first }.toTypedArray())
    private class EndFilter : Filter.Select<String>("연재", arrayOf("전체", "연재만화", "완결만화"))

    override fun getFilterList() = ExtStatus.prepend(
        "toon11",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어를 입력하면 필터는 무시됩니다"),
                GenreFilter(),
                CountryFilter(),
                EndFilter(),
            ),
        ),
    )

    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://11toon2.com"
        private const val USER_CODE = "100"
        private const val MENU_CODE = "2001"
        private const val PAGE_ROW = 30
        private const val TOP_CODE = "400"
        private const val NEW_CODE = "100"
        private const val SEARCH_ROW = 20
        private val HOST_REGEX = Regex("^(www\\.)?11toon\\d*\\.com$")

        /** 장르 (번호 = 사이트 SType, 0 = 전체) */
        private val GENRES = arrayOf(
            "전체", "SF", "TS", "개그", "드라마", "러브코미디", "먹방", "백합", "붕탁", "순정", "스릴러",
            "스포츠", "시대", "액션", "인기", "일상 + 치유", "추리", "판타지", "학원", "호러", "BL",
        )

        /** 국가 (사이트 SCountry) */
        private val COUNTRIES = listOf("전체" to 0, "일본만화" to 2)
    }
}
