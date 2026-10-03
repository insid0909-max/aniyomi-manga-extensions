package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.source.ConfigurableSource
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
            return if (Regex("^https?://[^\\s/]+$").matches(v)) v else DEFAULT
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

    private fun apiHeaders(referer: String): Headers = headersBuilder()
        .apply { token()?.let { set("X-CSRF-TOKEN", it) } }
        .set("Referer", referer)
        .set("Accept", "application/json, text/javascript, */*; q=0.01")
        .set("X-Requested-With", "XMLHttpRequest")
        .build()

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor { chain -> smartIntercept(chain) }
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
    private fun getJson(url: String, referer: String): JSONObject? = try {
        client.newCall(GET(url, apiHeaders(referer))).execute().use { res ->
            if (!res.isSuccessful) return@use null
            val body = res.body?.string().orEmpty()
            val start = body.indexOf('{')
            if (start < 0) null else JSONObject(body.substring(start))
        }
    } catch (e: Exception) {
        null
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
    override fun fetchPopularManga(page: Int): Observable<MangasPage> = Observable.fromCallable {
        rankingPage(TOP_CODE, page) ?: mainPage(page)
    }

    // 최신: t4 (menucode=NewCoce 100) → 실패하면 메인(/mb) 목록
    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> = Observable.fromCallable {
        rankingPage(NEW_CODE, page) ?: mainPage(page)
    }

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
        val json = getJson(api, "$baseUrl/mb") ?: return null
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
        if (mangas.isEmpty()) return null
        val total = json.optJSONObject("data")?.optInt("SucAllCnt", -1) ?: -1
        val hasNext = if (total > 0) page * PAGE_ROW < total else mangas.size >= PAGE_ROW
        return MangasPage(mangas, hasNext)
    }

    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()

    // 검색: 사이트처럼 검색 페이지를 연 뒤(토큰/쿠키) POST /mb/top_search 로 결과(JSON)를 받음
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> =
        Observable.fromCallable {
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

    // ---------- 이미지 (t5 API → 실패하면 회차 페이지의 #ImageShow) ----------
    override fun pageListRequest(chapter: SChapter): Request = GET(baseUrl + chapter.url, headers)

    override fun pageListParse(response: Response): List<Page> {
        val pageUrl = response.request.url
        val doc = response.asDoc()
        val referer = pageUrl.toString()

        var urls = doc.select("#ImageShow img").mapNotNull { it.attr("src").takeIf { s -> s.isNotBlank() }?.let { s -> absolute(s) } }

        if (urls.isEmpty()) {
            val cid = Regex("/content/image/(\\d+)").find(pageUrl.encodedPath)?.groupValues?.get(1)
                ?: throw IOException("잘못된 회차 주소")
            val parent = pageUrl.queryParameter("parent_id").orEmpty()
            val api = "$baseUrl/iapi/t5".toHttpUrl().newBuilder()
                .addQueryParameter("id", cid)
                .addQueryParameter("parent", parent)
                .build().toString()
            val data = getJson(api, referer)?.let { sucData(it) }
            val image = data?.optJSONObject("Image")
            val file = image?.optString("file").orEmpty()
            val listRaw = image?.opt("imagelist")
            val arr = when (listRaw) {
                is JSONArray -> listRaw
                is String -> try {
                    JSONArray(listRaw)
                } catch (e: Exception) {
                    JSONArray()
                }
                else -> JSONArray()
            }
            urls = (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
                .map { if (it.startsWith("http") || it.startsWith("//")) absolute(it) else absolute(file + it) }
        }
        if (urls.isEmpty()) throw IOException("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        return urls.distinct().mapIndexed { i, u -> Page(i, referer, u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", page.url.ifEmpty { "$baseUrl/mb" }).build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // fetchPopularManga 에서 직접 처리
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
    }
}
