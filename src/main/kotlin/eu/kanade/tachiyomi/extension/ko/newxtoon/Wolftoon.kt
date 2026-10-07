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
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.net.URLEncoder
import java.nio.charset.Charset
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import rx.Observable

/** 늑대닷컴 (wfwf###.com) - 페이지가 euc-kr 이라 직접 CP949 로 풀고, 검색어·장르도 CP949 로 보냄 */
class Wolftoon(private val comic: Boolean = false) : HttpSource(), ConfigurableSource {

    override val name = if (comic) "늑대닷컴 만화" else "늑대닷컴 웹툰"

    override val id: Long = uniqueSourceId(if (comic) "newxtoon.wolftoon/ko/2" else BASE_KEY)
    override val lang = "ko"
    override val supportsLatest = true

    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }
    private val sp: SharedPreferences by lazy { app.getSharedPreferences("source_${uniqueSourceId(BASE_KEY)}", 0) }

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
        .addInterceptor(SiteRateLimit(HOST_REGEX))
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
        Regex("wfwf(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 현재 번호 주변(-10 ~ +60)의 wfwf###.com 중 늑대닷컴이 열리는 주소를 찾음 (가장 큰 번호 우선) */
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
            val futures = ((cur - 10).coerceAtLeast(1)..(cur + 60)).map { "wfwf$it.com" }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        try {
                            val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                            plain.newCall(r).execute().use { res ->
                                val fh = res.request.url.host
                                if (!HOST_REGEX.matches(fh) || res.code != 200) return@use null
                                val body = res.body?.bytes()?.let { decode(it) }.orEmpty()
                                if (body.contains("t-card") || body.contains("늑대")) fh else null
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
        // 만화 소스는 웹툰 소스와 설정을 같이 씀 (설정 화면은 웹툰 소스에만)
        if (comic) return
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
            summary = "주소 번호가 바뀌어 접속이 안 되면 wfwf###.com 중 열리는 주소로 자동 변경"
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

    // ---------- 문자셋 ----------
    private fun decode(bytes: ByteArray): String = String(bytes, CP949)

    private fun Response.asDoc(): Document =
        use { Jsoup.parse(decode(it.body?.bytes() ?: ByteArray(0)), it.request.url.toString()) }

    private fun enc(v: String): String = URLEncoder.encode(v, CP949.name())

    // ---------- 목록 ----------
    /** 목록 주소: 한글 값(장르 등)은 CP949 로 인코딩해서 붙임 */
    private fun listReq(path: String, page: Int, params: Map<String, String>): Request {
        val q = params.filter { it.value.isNotEmpty() }.map { "${it.key}=${enc(it.value)}" }.toMutableList()
        if (page > 1) q.add("pg=$page")
        val url = baseUrl + path + if (q.isEmpty()) "" else "?" + q.joinToString("&")
        return GET(url, headers)
    }

    private val homePath get() = if (comic) "/cm" else "/ing"

    override fun popularMangaRequest(page: Int) = listReq(homePath, page, mapOf("o" to "f"))
    override fun latestUpdatesRequest(page: Int) = listReq(homePath, page, mapOf("o" to "n"))

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) return listReq("/sh", page, mapOf("q" to query.trim()))
        var path = homePath
        val params = LinkedHashMap<String, String>()
        filters.forEach { f ->
            when (f) {
                is Pick -> {
                    val v = f.pairs[f.state].second
                    if (f.param == "list") path = v else params[f.param] = v
                }
                is Text -> if (f.state.isNotBlank()) params[f.param] = f.state.trim()
                else -> {}
            }
        }
        // 만화책 목록은 분류·요일 값을 쓰지 않음
        if (path == "/cm") {
            params.remove("t1")
            params.remove("t2")
        }
        return listReq(path, page, params)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val seen = HashSet<String>()
        val mangas = doc.select("a.t-card[href]").mapNotNull { a ->
            val path = pathOf(a.attr("href"))
            if (!DETAIL_PATH.containsMatchIn(path) || !seen.add(path)) return@mapNotNull null
            SManga.create().apply {
                url = path
                title = a.selectFirst(".t-title")?.text()?.trim().orEmpty()
                thumbnail_url = a.selectFirst(".t-img img")?.absUrl("src")?.ifEmpty { null }
            }
        }.filter { it.title.isNotEmpty() }
        val cur = PAGE_REGEX.find(doc.location())?.groupValues?.get(1)?.toIntOrNull() ?: 1
        val maxPg = doc.select(".pagi a.pg-btn[href]").mapNotNull {
            PAGE_REGEX.find(it.attr("href"))?.groupValues?.get(1)?.toIntOrNull()
        }.maxOrNull() ?: 0
        return MangasPage(mangas, maxPg > cur)
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        return SManga.create().apply {
            title = d.selectFirst("h1.w-title")?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst(".title-sec .thumb-wrap img")?.absUrl("src")?.ifEmpty { null }
            description = d.selectFirst("#summary")?.text()?.trim()
            genre = d.select(".genre-tags a.gtag").map { it.text().trim().removePrefix("#") }
                .filter { it.isNotEmpty() }.joinToString(", ")
            // 상세 페이지 상단 메뉴에서 현재 칸(연재/완결)이 강조됨
            status = when (d.selectFirst("a.nav-item.active")?.attr("href").orEmpty()) {
                "/ing" -> SManga.ONGOING
                "/end" -> SManga.COMPLETED
                else -> SManga.UNKNOWN
            }
        }
    }

    // ---------- 회차 (한 페이지에 100화씩, 최신순) ----------
    override fun chapterListRequest(manga: SManga): Request = GET(chapterPageUrl(manga.url, 1), headers)

    private fun chapterPageUrl(detailPath: String, page: Int): String {
        val base = baseUrl + detailPath.replace(Regex("&(s|pg)=[^&]*"), "")
        return "$base&s=n&pg=$page"
    }

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    override fun chapterListParse(response: Response): List<SChapter> {
        val first = response.asDoc()
        val detailPath = pathOf(first.location())
        val total = TOTAL_REGEX.find(first.selectFirst(".list-header-title")?.text().orEmpty())
            ?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull() ?: 0
        val linkPages = first.select(".pagi a.pg-btn[href]").mapNotNull {
            PAGE_REGEX.find(it.attr("href"))?.groupValues?.get(1)?.toIntOrNull()
        }.maxOrNull() ?: 1
        val pages = maxOf(linkPages, (total + 99) / 100).coerceIn(1, 100)

        val seen = HashSet<String>()
        val out = ArrayList<SChapter>()
        parseChapters(first, seen, out)
        for (p in 2..pages) {
            val doc = try {
                client.newCall(GET(chapterPageUrl(detailPath, p), headers)).execute().asDoc()
            } catch (e: Exception) {
                break
            }
            val before = out.size
            parseChapters(doc, seen, out)
            if (out.size == before) break
        }
        return out
    }

    private fun parseChapters(d: Document, seen: HashSet<String>, out: MutableList<SChapter>) {
        for (a in d.select("a.ep-item[href]")) {
            val path = pathOf(a.attr("href"))
            if (!seen.add(path)) continue
            out.add(
                SChapter.create().apply {
                    url = path
                    name = a.selectFirst(".ep-title")?.text()?.trim()?.ifEmpty { null } ?: "${a.attr("data-num")}화"
                    chapter_number = a.attr("data-num").toFloatOrNull() ?: -1f
                    date_upload = try {
                        dateFmt.parse(a.selectFirst(".ep-date")?.text()?.trim().orEmpty())?.time ?: 0L
                    } catch (e: Exception) {
                        0L
                    }
                },
            )
        }
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter) = GET(baseUrl + chapter.url, headers)

    override fun pageListParse(response: Response): List<Page> {
        val d = response.asDoc()
        val imgs = d.select("#vimg-area img").ifEmpty { d.select(".vimg-area img") }
        val urls = imgs.mapNotNull { img ->
            val attr = listOf("data-src", "data-original", "src")
                .firstOrNull { img.attr(it).isNotBlank() && !img.attr(it).trim().startsWith("data:") }
                ?: return@mapNotNull null
            img.absUrl(attr).ifEmpty { null }
        }.distinct()
        if (urls.isEmpty()) {
            throw Exception("이미지를 찾을 수 없습니다 (제목: ${d.title().take(40)})")
        }
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 필터 ----------
    // ---------- Popular/Latest 규칙 (필터 조건을 인기/최신 탭에 저장) ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 사이트 주소 → 작품 주소 (모르는 모양이면 null) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        u.queryParameter("toon")?.takeIf { id -> id.all { it.isDigit() } }
            ?.let { id -> if (u.encodedPath == "/cl") "/cl?toon=$id" else "/list?toon=$id" }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    override fun getFilterList() = ExtStatus.prepend(
        "wolftoon",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            if (comic) {
                FilterList(
                    Filter.Header("검색어가 없을 때만 적용"),
                    Pick("정렬", "o", COMIC_SORTS),
                    Pick("장르", "t3", COMIC_GENRES),
                )
            } else {
                FilterList(
                    Filter.Header("검색어가 없을 때만 적용"),
                    Pick("목록", "list", LISTS),
                    Pick("정렬", "o", SORTS),
                    Pick("분류 (웹툰)", "t2", TYPES),
                    Pick("요일 (웹툰)", "t1", DAYS),
                    Pick("장르", "t3", GENRES),
                    Filter.Header("만화책 장르는 아래에 직접 입력 (예: 이세계, 러브코미디)"),
                    Text("장르 직접 입력", "t3"),
                )
            },
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    class Text(name: String, val param: String) : Filter.Text(name)

    private fun pathOf(href: String): String =
        Regex("^https?://[^/]+(/.*)$").find(href)?.groupValues?.get(1) ?: href

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://wfwf510.com"
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^wfwf\\d+\\.com$")
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val DETAIL_PATH = Regex("^/(list|cl)\\?toon=\\d+")
        private val PAGE_REGEX = Regex("[?&]pg=(\\d+)")
        private val TOTAL_REGEX = Regex("총\\s*([\\d,]+)\\s*화")

        /** CP949(euc-kr 확장). 기기에 없으면 EUC-KR */
        private val CP949: Charset = listOf("MS949", "x-windows-949", "windows-949", "EUC-KR")
            .firstNotNullOfOrNull { n ->
                try {
                    Charset.forName(n)
                } catch (e: Exception) {
                    null
                }
            } ?: Charsets.UTF_8

        private val LISTS = listOf("연재" to "/ing", "완결" to "/end", "만화책" to "/cm")
        private const val BASE_KEY = "newxtoon.wolftoon/ko/1"

        /** 만화책(/cm) 목록: 정렬은 최신·인기만, 장르(t3)는 사이트 만화책 분류 그대로 */
        private val COMIC_SORTS = listOf("최신순" to "n", "인기순" to "f")
        private val COMIC_GENRES = listOf(
            "전체" to "", "액션" to "액션", "판타지" to "판타지", "로맨스" to "로맨스", "드라마" to "드라마",
            "이세계" to "이세계", "전생" to "전생", "무협" to "무협", "일상" to "일상", "일상+치유" to "일상 치유",
            "순정" to "순정", "러브코미디" to "러브코미디", "개그" to "개그", "학원" to "학원", "스포츠" to "스포츠",
            "미스터리" to "미스터리", "추리" to "추리", "스릴러" to "스릴러", "공포" to "공포", "호러" to "호러",
            "도박" to "도박", "역사" to "역사", "시대" to "시대", "게임" to "게임", "SF" to "sf", "요리" to "요리",
            "먹방" to "먹방", "음악" to "음악", "라노벨" to "라노벨", "애니화" to "애니화", "BL" to "bl",
            "백합" to "백합", "성인" to "성인", "붕탁" to "붕탁", "TS" to "ts", "여장" to "여장", "17" to "17",
        )

        private val SORTS = listOf("최신순" to "n", "인기순" to "f", "신작순" to "r")
        private val TYPES = listOf("전체" to "", "일반" to "1", "BL" to "2", "성인" to "3")
        private val DAYS = listOf(
            "전체" to "", "월" to "1", "화" to "2", "수" to "3", "목" to "4",
            "금" to "5", "토" to "6", "일" to "7", "10일" to "10",
        )
        private val GENRES = listOf("전체" to "") + listOf(
            "드라마", "판타지", "액션", "로맨스", "일상", "개그", "미스터리", "순정",
            "스포츠", "스릴러", "무협", "학원", "공포", "스토리",
        ).map { it to it }
    }
}
