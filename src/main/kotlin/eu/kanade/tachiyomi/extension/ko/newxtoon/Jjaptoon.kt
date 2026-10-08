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
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import rx.Observable

/**
 * 짭툰 (www.jjaptoon008.com)
 * 사이트 구조 참고: oneulddu/Korean-Mihon-Extensions-Source ko/jjaptoon (Apache-2.0)
 */
class Jjaptoon : HttpSource(), ConfigurableSource {

    override val name = "Jjaptoon 웹툰"

    // 다른 저장소의 짭툰 확장과 소스 ID가 겹치지 않도록 고유 ID 사용
    override val id: Long = uniqueSourceId("newxtoon.jjaptoon/ko/1")
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

    // 주소 번호가 바뀌면 자동으로 찾아 연결
    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> smartIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, "/comics/"))
        .build()

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
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

        if (res.code == 451) {
            res.close()
            throw java.io.IOException("접근 차단됨 (HTTP 451). 확장 설정에서 도메인 주소를 확인하세요.")
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
        Regex("jjaptoon(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** 공식 안내 사이트(짭툰.net 등)에서 최신 주소 확인, 실패하면 jjaptoon001~040.com 중 열리는 주소 (큰 번호 우선) */
    private fun discoverDomain(currentHost: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val plain = okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val ua = userAgent

        fun fetch(url: String): Pair<String, String>? = try {
            val r = Request.Builder().url(url).header("User-Agent", ua).build()
            plain.newCall(r).execute().use { res ->
                if (res.code != 200) null else res.request.url.host to (res.body?.string() ?: "")
            }
        } catch (e: Exception) {
            null
        }

        // 1) 공식 안내 사이트
        for (guide in GUIDE_URLS) {
            val hit = fetch(guide) ?: continue
            if (HOST_REGEX.matches(hit.first) && hit.first != currentHost) return hit.first
            val json = fetch(guide + "data/domain.json")?.second.orEmpty()
            val found = (LINK_REGEX.findAll(json) + LINK_REGEX.findAll(hit.second))
                .map { it.groupValues[1].lowercase() }
                .filter { it != currentHost }
                .maxByOrNull { hostNumber(it) }
            if (found != null) return found
        }

        // 2) 번호 주소 순회
        val prefix = if (currentHost.startsWith("www.")) "www." else ""
        val pool = java.util.concurrent.Executors.newFixedThreadPool(10)
        try {
            val futures = (1..40).map { String.format("%sjjaptoon%03d.com", prefix, it) }
                .filter { it != currentHost }
                .map { host ->
                    pool.submit<String?> {
                        val hit = fetch("https://$host/") ?: return@submit null
                        if (HOST_REGEX.matches(hit.first) && hit.second.contains("/comics/")) hit.first else null
                    }
                }
            futures.mapNotNull { it.get() }.maxByOrNull { hostNumber(it) }
        } finally {
            pool.shutdown()
        }
    }

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("User-Agent", userAgent)
        .set("Referer", "$baseUrl/")
        .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

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
            summary = "주소 번호가 바뀌어 접속이 안 되면 공식 안내 사이트 / jjaptoon001~040.com 에서 새 주소로 자동 변경"
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
    // 메인(/)은 comicsPage, 목록(/comics)은 page 로 쪽 번호를 넘김
    private fun homeRequest(page: Int, params: Map<String, String>): Request {
        val b = "$baseUrl/".toHttpUrl().newBuilder()
        params.forEach { (k, v) -> b.addQueryParameter(k, v) }
        if (page > 1) b.addQueryParameter("comicsPage", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaRequest(page: Int) = homeRequest(page, mapOf("selectedSort" to "popular"))
    override fun latestUpdatesRequest(page: Int) = homeRequest(page, emptyMap())

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        val params = LinkedHashMap<String, String>()
        var popular = false
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                if (f.param == "selectedSort") popular = v == "popular" else if (v.isNotEmpty()) params[f.param] = v
            }
        }
        // 인기순은 메인 페이지에서만 지원 (검색어/상태 필터와 함께 쓸 수 없음)
        if (popular && query.isBlank() && params["selectedStatus"].isNullOrEmpty()) {
            return homeRequest(page, params + ("selectedSort" to "popular"))
        }
        val b = "$baseUrl/comics".toHttpUrl().newBuilder()
        if (query.isNotBlank()) b.addQueryParameter("search", query.trim())
        params.forEach { (k, v) -> b.addQueryParameter(k, v) }
        if (page > 1) b.addQueryParameter("page", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchMangaParse(response: Response) = parseList(response)

    private fun parseList(response: Response): MangasPage {
        val doc = response.asDoc()
        val seen = HashSet<String>()
        val mangas = doc.select("div.grid a[href*=/comics/]:has(img)").mapNotNull { a ->
            val path = a.absUrl("href").toHttpUrlOrNull()?.encodedPath ?: return@mapNotNull null
            if (!seen.add(path)) return@mapNotNull null
            val title = a.selectFirst("h2")?.text()?.trim()?.ifEmpty { null }
                ?: a.selectFirst("img[alt]")?.attr("alt")?.trim()?.ifEmpty { null }
                ?: return@mapNotNull null
            SManga.create().apply {
                url = path
                this.title = title
                thumbnail_url = a.selectFirst("img")?.imageUrl()
                author = a.selectFirst("p")?.text()?.removePrefix("작가")?.trim()
                status = parseStatus(a.text())
            }
        }
        val hasNext = doc.selectFirst("a[aria-label='Next page'], a[rel=next]") != null ||
            doc.select("button").any { it.attr("wire:click").startsWith("nextPage") && !it.hasAttr("disabled") }
        return MangasPage(mangas, hasNext && mangas.isNotEmpty())
    }

    // ---------- 상세 ----------
    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        val title = d.selectFirst("h1")?.text()?.trim().orEmpty()
        val badges = d.select("section div.flex.flex-wrap.justify-center.gap-2 span").map { it.text().trim() }
        return SManga.create().apply {
            this.title = title
            thumbnail_url = d.select("section img[alt]").firstOrNull { it.attr("alt") == title }?.imageUrl()
                ?: d.selectFirst("section img[alt]")?.imageUrl()
                ?: d.selectFirst("meta[property=og:image]")?.attr("content")
            description = d.selectFirst("section:has(h2:contains(작품 소개)) p")?.text()?.trim()
            author = d.selectFirst("p:contains(작가:) span")?.text()?.trim()
            status = parseStatus(badges.joinToString(" "))
            genre = badges.filter { it.length > 1 && it !in IGNORED_BADGES }
                .joinToString(", ").ifEmpty { null }
        }
    }

    // ---------- 회차 ----------
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서)
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            ChapterOrder.sort(it, manga.title).let { l -> if (ChapterPosition.enabled(sp)) ChapterPosition.label(l, manga.title) else l }
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val seen = HashSet<String>()
        val rows = d.select("a[href*=/chapters/]").let { all ->
            all.filter { it.attr("wire:key").startsWith("comic-") }.ifEmpty { all }
        }
        return rows.mapNotNull { a ->
            val path = a.absUrl("href").toHttpUrlOrNull()?.encodedPath ?: return@mapNotNull null
            if (!seen.add(path)) return@mapNotNull null
            val texts = a.select("p").map { it.text().trim() }
            SChapter.create().apply {
                url = path
                name = texts.firstOrNull()?.ifEmpty { null } ?: a.text().trim()
                date_upload = texts.drop(1).firstNotNullOfOrNull { t ->
                    DATE_REGEX.find(t)?.value?.let {
                        try {
                            dateFmt.parse(it)?.time
                        } catch (e: Exception) {
                            null
                        }
                    }
                } ?: 0L
            }
        }
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter): Request =
        GET(baseUrl + chapter.url, headersBuilder().set("Referer", baseUrl + chapter.url).build())

    override fun pageListParse(response: Response): List<Page> {
        val d = response.asDoc()
        val urls = d.select("[data-reading-image-index] > img")
            .filterNot { it.attr("alt").contains("광고문의") }
            .mapNotNull { it.imageUrl() ?: IMG_SRC_REGEX.find(it.attr(":src"))?.groupValues?.get(1) }
            .distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        val referer = response.request.url.toString()
        return urls.mapIndexed { i, u -> Page(i, referer, u.replace(" ", "%20")) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", page.url.ifEmpty { "$baseUrl/" }).build())

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
        Regex("^/comics/([^/]+)").find(u.encodedPath)?.let { "/comics/${it.groupValues[1]}" }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        return super.fetchSearchManga(page, query, filters)
    }

    override fun getFilterList() = ExtStatus.prepend(
        "jjaptoon",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("인기순은 검색어/상태 필터와 함께 쓸 수 없음"),
                Pick("정렬", "selectedSort", listOf("최신순" to "latest", "인기순" to "popular")),
                Pick("분류", "selectedType", listOf("전체" to "", "일반" to "general", "성인" to "adult", "BL" to "bl")),
                Pick(
                    "상태", "selectedStatus",
                    listOf("전체" to "", "연재" to "ongoing", "완결" to "completed", "휴재" to "paused"),
                ),
                Pick(
                    "요일", "selectedSchedule",
                    listOf(
                        "전체" to "", "월" to "monday", "화" to "tuesday", "수" to "wednesday", "목" to "thursday",
                        "금" to "friday", "토" to "saturday", "일" to "sunday",
                    ),
                ),
                Pick("장르", "selectedCategory", GENRES),
                Pick("플랫폼", "selectedPublisher", PLATS),
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    private fun parseStatus(text: String): Int = when {
        "완결" in text -> SManga.COMPLETED
        "연재" in text -> SManga.ONGOING
        else -> SManga.UNKNOWN
    }

    private fun Element.imageUrl(): String? = when {
        hasAttr("data-original") -> absUrl("data-original")
        hasAttr("data-src") -> absUrl("data-src")
        else -> absUrl("src")
    }.takeIf { it.isNotBlank() }

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val DEFAULT = "https://www.jjaptoon008.com"
        private val HOST_REGEX = Regex("^(www\\.)?jjaptoon\\d{3}\\.com$")
        private val LINK_REGEX = Regex("(?i)((?:www\\.)?jjaptoon\\d{3}\\.com)")
        private val GUIDE_URLS = listOf(
            "https://xn--kd6b44m.net/",
            "https://xn--kd6b44m.live/",
            "https://xn--kd6b44m.cc/",
        )
        private val DATE_REGEX = Regex("\\d{4}-\\d{2}-\\d{2}")
        private val IMG_SRC_REGEX = Regex("loaded\\s*\\?\\s*'([^']+)'")
        private val IGNORED_BADGES = setOf("완결", "연재", "휴재")
        private val GENRES = listOf(
            "전체" to "", "액션" to "1", "일상" to "3", "BL/백합" to "10", "로맨스" to "4",
            "SF/판타지" to "2", "개그" to "5", "학원" to "6", "SF" to "7", "스토리" to "8",
            "판타지" to "9", "개그/코미디" to "11", "연애/순정" to "12", "드라마" to "13",
            "시대극" to "14", "스포츠" to "15", "추리/미스터리" to "16", "공포/스릴러" to "17",
            "성인" to "18", "옴니버스" to "19", "에피소드" to "20", "무협" to "21",
            "소년" to "22", "기타" to "23",
        )
        private val PLATS = listOf(
            "전체" to "", "네이버" to "naver", "다음" to "daum", "카카오" to "kakao", "레진" to "lezhin",
            "투믹스" to "toomics", "만타" to "manta", "탑툰" to "toptoon", "코미카" to "comica",
            "원스토리" to "onestory", "배틀코믹" to "battle-comic", "미스터블루" to "mrblue",
            "태피툰" to "tappytoon", "케이툰" to "ktoon", "리디" to "ridi", "애니툰" to "anytoon",
            "델리툰" to "delitoon", "폭스툰" to "foxtoon", "피너툰" to "peanutoon", "봄툰" to "bomtoon",
            "코미코" to "comico", "무툰" to "mutoon", "기타" to "other",
        )
    }
}
