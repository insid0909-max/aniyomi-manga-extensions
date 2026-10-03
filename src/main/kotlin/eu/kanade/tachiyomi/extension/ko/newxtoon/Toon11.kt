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
import org.jsoup.nodes.Element
import java.io.IOException
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 11toon (11toon2.com) - 그누보드 게시판(toon_c 목록 / toons 작품) 구조
 * 사이트 구조 참고: oneulddu/Korean-Mihon-Extensions-Source ko/toon11 (Apache-2.0)
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

    /** 게시판 경로 앞부분 ("" 또는 "/mb"). 404가 나면 반대쪽으로 바꿔 보고 맞는 쪽을 기억 */
    private val prefix: String
        get() = try {
            sp.getString(KEY_PREFIX, DEFAULT_PREFIX) ?: DEFAULT_PREFIX
        } catch (e: Throwable) {
            DEFAULT_PREFIX
        }

    private fun autoDomain(): Boolean = try {
        sp.getBoolean(KEY_AUTO, true)
    } catch (e: Throwable) {
        true
    }

    private fun save(key: String, value: String) {
        try {
            sp.edit().putString(key, value).apply()
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("User-Agent", userAgent)
        .set("Referer", "$baseUrl/")

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor { chain -> smartIntercept(chain) }
        .build()

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val ours = baseHost != null && req.url.host == baseHost
        val auto = ours && autoDomain() && HOST_REGEX.matches(baseHost!!)

        val res = try {
            chain.proceed(req)
        } catch (e: IOException) {
            val found = if (auto) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            save(KEY_DOMAIN, "https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }

        if (res.code == 451) {
            res.close()
            throw IOException("접근 차단됨 (HTTP 451). 확장 설정에서 도메인 주소를 확인하세요.")
        }

        // 게시판 경로가 "/mb/bbs/..." 인지 "/bbs/..." 인지 자동 맞춤
        if (ours && res.code == 404) {
            val path = req.url.encodedPath
            val swapped = when {
                path.startsWith("/mb/bbs/") -> path.removePrefix("/mb")
                path.startsWith("/bbs/") -> "/mb$path"
                else -> null
            }
            if (swapped != null) {
                val retry = chain.proceed(req.newBuilder().url(req.url.newBuilder().encodedPath(swapped).build()).build())
                if (retry.isSuccessful) {
                    res.close()
                    save(KEY_PREFIX, if (swapped.startsWith("/mb/")) "/mb" else "")
                    return retry
                }
                retry.close()
            }
        }

        val finalHost = res.request.url.host
        if (auto && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            save(KEY_DOMAIN, "https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("11toon(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 11toon1~30.com 중 열리는 주소 (큰 번호 우선) */
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
            val futures = (listOf("") + (1..30).map { it.toString() }).map { "${www}11toon$it.com" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (res.code == 200 && HOST_REGEX.matches(fh)) fh else null
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

    // ---------- 목록 ----------
    private fun bbs(path: String): HttpUrl = "$baseUrl$prefix/bbs/$path".toHttpUrl()

    override fun popularMangaRequest(page: Int): Request = GET(
        bbs("board.php").newBuilder()
            .addQueryParameter("bo_table", "toon_c")
            .addQueryParameter("is_over", "0")
            .addQueryParameter("page", page.toString())
            .build(),
        headers,
    )

    override fun latestUpdatesRequest(page: Int): Request = GET(
        bbs("board.php").newBuilder()
            .addQueryParameter("bo_table", "toon_c")
            .addQueryParameter("type", "upd")
            .addQueryParameter("page", page.toString())
            .build(),
        headers,
    )

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) {
            return GET(
                bbs("search_stx.php").newBuilder()
                    .addQueryParameter("stx", query.trim())
                    .addQueryParameter("page", page.toString())
                    .build(),
                headers,
            )
        }
        fun pick(param: String) = filters.filterIsInstance<Pick>().firstOrNull { it.param == param }
            ?.let { it.pairs[it.state].second }.orEmpty()
        val b = bbs("board.php").newBuilder().addQueryParameter("bo_table", "toon_c")
        if (pick("sort") == "upd") b.addQueryParameter("type", "upd")
        b.addQueryParameter("is_over", pick("is_over").ifEmpty { "0" })
        pick("sca").takeIf { it.isNotEmpty() }?.let { b.addQueryParameter("sca", it) }
        if (page > 1) b.addQueryParameter("page", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val mangas = doc.select("li[data-id]").mapNotNull { li ->
            val title = li.selectFirst(".homelist-title")?.text()?.trim().orEmpty()
            if (title.isEmpty()) return@mapNotNull null
            val href = li.selectFirst("a[href]")?.absUrl("href").orEmpty()
            val path = href.toHttpUrlOrNull()?.let { u -> u.encodedPath + (u.encodedQuery?.let { "?$it" } ?: "") }
                // 검색 결과처럼 링크가 없으면 작품 번호로 상세 주소를 만듦
                ?: li.attr("data-id").takeIf { it.isNotBlank() }?.let { dataId ->
                    "$prefix/bbs/board.php?bo_table=toons&stx=${URLEncoder.encode(title, "UTF-8")}&is=$dataId"
                }
                ?: return@mapNotNull null
            SManga.create().apply {
                url = path
                this.title = title
                thumbnail_url = li.thumbnailUrl()
            }
        }.distinctBy { it.url }
        return MangasPage(mangas, hasNextPage(doc, response.request.url) && mangas.isNotEmpty())
    }

    private fun hasNextPage(doc: Document, url: HttpUrl): Boolean {
        val cur = doc.selectFirst(".pg_current")?.ownText()?.trim()?.toIntOrNull()
            ?: url.queryParameter("page")?.toIntOrNull() ?: 1
        return doc.select("a.pg_page[href], a.pg_next[href], a.pg_end[href]").any { a ->
            val next = url.resolve(a.attr("href"))?.queryParameter("page")?.toIntOrNull() ?: return@any false
            next > cur
        }
    }

    private fun Element.thumbnailUrl(): String? {
        val thumb = selectFirst(".homelist-thumb") ?: return selectFirst("img")?.absUrl("src")?.ifEmpty { null }
        return thumb.absUrl("data-mobile-image").ifEmpty { null }
            ?: thumb.attr("style").substringAfter("url(", "").substringBefore(")")
                .trim('\'', '"', ' ').ifEmpty { null }
                ?.let { if (it.startsWith("//")) "https:$it" else it }
    }

    // ---------- 상세 ----------
    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        return SManga.create().apply {
            title = d.selectFirst("h2.title")?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst("img.banner")?.absUrl("src")?.ifEmpty { null }
            d.selectFirst("span:contains(분류) + span")?.let { status = parseStatus(it.text()) }
            d.selectFirst("span:contains(작가) + span")?.let { author = it.text().trim() }
            d.selectFirst("span:contains(소개) + span")?.let { description = it.text().trim() }
            d.selectFirst("span:contains(장르) + span")?.let {
                genre = it.text().split(",").map { s -> s.trim() }.filter { s -> s.isNotEmpty() }.joinToString(", ")
            }
        }
    }

    private fun parseStatus(text: String): Int = when {
        "완결" in text -> SManga.COMPLETED
        "주간" in text || "월간" in text || "연재" in text || "격주" in text -> SManga.ONGOING
        else -> SManga.UNKNOWN
    }

    // ---------- 회차 (여러 쪽이면 이어서 받음) ----------
    private val dateFmt = SimpleDateFormat("yy.MM.dd", Locale.ENGLISH)

    override fun chapterListParse(response: Response): List<SChapter> {
        var doc = response.asDoc()
        val chapters = ArrayList<SChapter>()
        val visited = HashSet<String>()
        var guard = 0
        while (guard++ < 100) {
            chapters += doc.select("#comic-episode-list > li").mapNotNull(::parseChapter)
            val next = doc.selectFirst(".pg_current ~ .pg_page")?.absUrl("href")
            if (next.isNullOrBlank() || !visited.add(next)) break
            doc = client.newCall(GET(next, headers)).execute().use { it.asDoc() }
        }
        return chapters.distinctBy { it.url }
    }

    private fun parseChapter(li: Element): SChapter? {
        val button = li.selectFirst("button") ?: li.selectFirst("[onclick]") ?: return null
        // onclick="location.href='./board.php?bo_table=toons&wr_id=...'"
        val href = Regex("""location\.href\s*=\s*['"]([^'"]+)['"]""").find(button.attr("onclick"))
            ?.groupValues?.get(1) ?: return null
        val chapterUrl = href.removePrefix(".").let { if (it.startsWith("/")) it else "/$it" }
        val name = button.selectFirst(".episode-title")?.text()?.trim().orEmpty()
            .ifEmpty { button.text().trim() }
        if (name.isEmpty()) return null
        return SChapter.create().apply {
            url = chapterUrl
            this.name = name
            date_upload = try {
                li.selectFirst(".free-date")?.text()?.trim()?.let { synchronized(dateFmt) { dateFmt.parse(it)?.time } } ?: 0L
            } catch (e: Exception) {
                0L
            }
        }
    }

    // 회차 주소는 "/board.php?..." 형태 (게시판 폴더 기준 상대 주소)
    override fun pageListRequest(chapter: SChapter): Request {
        val url = if (chapter.url.startsWith("/bbs/") || chapter.url.startsWith("/mb/")) {
            baseUrl + chapter.url
        } else {
            "$baseUrl$prefix/bbs${chapter.url}"
        }
        return GET(url, headers)
    }

    // ---------- 이미지 (스크립트 안 img_list 배열) ----------
    override fun pageListParse(response: Response): List<Page> {
        val html = response.body?.string().orEmpty()
        val list = IMG_LIST.find(html)?.groupValues?.get(1)
            ?: throw IOException("이미지 목록을 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        val arr = JSONArray(list)
        val referer = response.request.url.toString()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
            .mapIndexed { i, img ->
                val url = when {
                    img.startsWith("http") -> img
                    img.startsWith("//") -> "https:$img"
                    else -> response.request.url.resolve(img)?.toString() ?: img
                }
                Page(i, referer, url)
            }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", page.url.ifEmpty { "$baseUrl/" }).build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 필터 (검색어가 없을 때만 적용) ----------
    override fun getFilterList() = FilterList(
        Filter.Header("검색어가 없을 때만 적용"),
        Pick("정렬", "sort", listOf("인기순" to "", "최신순" to "upd")),
        Pick("상태", "is_over", listOf("전체" to "0", "완결" to "1")),
        Pick("장르", "sca", GENRES),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val KEY_PREFIX = "pref_path_prefix"
        private const val DEFAULT = "https://11toon2.com"
        private const val DEFAULT_PREFIX = ""
        private val HOST_REGEX = Regex("^(www\\.)?11toon\\d*\\.com$")
        private val IMG_LIST = Regex("""img_list\s*=\s*(\[.*?])""", RegexOption.DOT_MATCHES_ALL)
        private val GENRES = listOf(
            "전체" to "", "SF" to "SF", "무협" to "무협", "TS" to "TS", "개그" to "개그", "드라마" to "드라마",
            "러브코미디" to "러브코미디", "먹방" to "먹방", "백합" to "백합", "붕탁" to "붕탁", "스릴러" to "스릴러",
            "스포츠" to "스포츠", "시대" to "시대", "액션" to "액션", "순정" to "순정", "일상+치유" to "일상+치유",
            "추리" to "추리", "판타지" to "판타지", "학원" to "학원", "호러" to "호러", "BL" to "BL", "17" to "17",
            "이세계" to "이세계", "전생" to "전생", "라노벨" to "라노벨", "애니화" to "애니화", "TL" to "TL",
        )
    }
}
