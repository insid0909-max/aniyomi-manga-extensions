package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.Filter
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
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class NewXtoon(
    sourceName: String = "newxtoon 웹툰",
    /** 비우면 전체, 값이 있으면 해당 분류(예: "성인", "BL·GL", "일반만화")만 기본으로 보여줌 */
    private val fixedCategory: String = "",
) : HttpSource(), ConfigurableSource {

    override val name = sourceName
    override val lang = "ko"
    override val supportsLatest = true

    // ---------- 설정 (도메인) ----------
    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
    }

    private val sp: SharedPreferences by lazy {
        app.getSharedPreferences("source_$id", 0)
    }

    // 폰 WebView와 같은 모바일 Chrome UA (비우면 자동). Cloudflare 확인 통과용
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
                    .replace("; wv", "")
                    .replace("Version/4.0 ", "")
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
            return if (DOMAIN_REGEX.matches(v)) v else DEFAULT_BASE_URL
        }

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소"
            summary = "사이트 주소가 바뀌면 여기서 변경 (기본: $DEFAULT_BASE_URL)"
            dialogTitle = "도메인 주소"
            setDefaultValue(DEFAULT_BASE_URL)
            setOnPreferenceChangeListener { _, newValue ->
                DOMAIN_REGEX.matches((newValue as String).trim().trimEnd('/'))
            }
        }.also(screen::addPreference)

        SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "주소 번호가 바뀌어 접속이 안 되면 newxtoon1~40.com 중 열리는 주소로 자동 변경"
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

    // 접속 차단(451) 안내 + 주소 번호 변경 시 자동 연결
    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .addInterceptor { chain -> smartIntercept(chain) }
        .build()

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

    // ---------- 다음 쪽 미리 받기 (목록 넘길 때 속도 개선) ----------
    private val pageCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, ByteArray>>()
    private val prefetching = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    private fun cachedResponse(req: Request): Response? {
        if (req.method != "GET") return null
        val key = req.url.toString()
        val hit = pageCache.remove(key) ?: return null
        if (System.currentTimeMillis() - hit.first > 120_000) return null
        return Response.Builder()
            .request(req)
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body(hit.second.toResponseBody("text/html; charset=utf-8".toMediaType()))
            .build()
    }

    private fun prefetch(url: okhttp3.HttpUrl) {
        val key = url.toString()
        if (pageCache.containsKey(key) || !prefetching.add(key)) return
        Thread {
            try {
                client.newCall(GET(url, headers)).execute().use { res ->
                    if (res.isSuccessful) {
                        val bytes = res.body?.bytes()
                        if (bytes != null) {
                            if (pageCache.size > 6) pageCache.clear()
                            pageCache[key] = System.currentTimeMillis() to bytes
                        }
                    }
                }
            } catch (e: Exception) {
                // 미리 받기 실패는 무시 (실제 요청 때 다시 시도)
            } finally {
                prefetching.remove(key)
            }
        }.start()
    }

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        cachedResponse(req)?.let { return it }
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val ours = autoDomain() && baseHost != null && req.url.host == baseHost && HOST_REGEX.matches(baseHost)

        val response = try {
            chain.proceed(req)
        } catch (e: IOException) {
            // 현재 주소에 접속 불가 -> 살아있는 주소 찾아서 재시도
            val found = if (ours) discoverDomain(baseHost!!) else null
            if (found == null) throw e
            saveDomain("https://$found")
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }

        if (response.code == 451) {
            response.close()
            throw IOException(
                "접근 차단됨 (HTTP 451: 법적 사유로 이용 불가). " +
                    "확장 설정에서 도메인 주소를 확인하세요.",
            )
        }

        // 옛 주소 -> 새 주소로 넘어간 경우 새 주소를 저장
        val finalHost = response.request.url.host
        if (ours && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }

        // 인증 통과 기록(쿠키)을 바로 저장해서 앱을 껐다 켜도 유지되게 함
        if (response.isSuccessful) flushCookies()
        return response
    }

    @Volatile
    private var lastFlush = 0L

    private fun flushCookies() {
        val now = System.currentTimeMillis()
        if (now - lastFlush < 10_000) return
        lastFlush = now
        try {
            android.webkit.CookieManager.getInstance().flush()
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    /** newxtoon{1..40}.com 중 응답하는 주소를 찾는다. 확인된 주소 > 인증창이 뜨는 주소, 번호가 큰 쪽 우선 */
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
        val pool = Executors.newFixedThreadPool(10)
        try {
            val futures = (1..40).map { "newxtoon$it.com" }.filter { it != currentHost }.map { host ->
                pool.submit<Pair<String, Boolean>?> {
                    try {
                        val r = Request.Builder().url("https://$host/").header("User-Agent", ua).build()
                        plain.newCall(r).execute().use { res ->
                            val fh = res.request.url.host
                            if (!HOST_REGEX.matches(fh)) return@use null
                            when {
                                res.code == 200 &&
                                    (res.body?.string() ?: "").contains("뉴엑스툰") -> fh to true
                                (res.code == 403 || res.code == 503) &&
                                    res.header("cf-mitigated") != null -> fh to false
                                else -> null
                            }
                        }
                    } catch (e: Exception) {
                        null
                    }
                }
            }
            val hits = futures.mapNotNull { it.get() }
            val pick = hits.filter { it.second }.maxByOrNull { hostNumber(it.first) }
                ?: hits.maxByOrNull { hostNumber(it.first) }
            pick?.first
        } finally {
            pool.shutdown()
        }
    }

    private fun hostNumber(host: String): Int =
        Regex("\\d+").find(host)?.value?.toIntOrNull() ?: 0

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("User-Agent", userAgent)

    // ---------- 목록 ----------
    private fun listRequest(page: Int, params: Map<String, String>): Request {
        val b = "$baseUrl/comics".toHttpUrl().newBuilder()
        val all = LinkedHashMap(params)
        if (fixedCategory.isNotEmpty() && all["category"].isNullOrEmpty()) all["category"] = fixedCategory
        all.forEach { (k, v) -> if (v.isNotEmpty()) b.addQueryParameter(k, v) }
        if (page > 1) b.addQueryParameter("page", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaRequest(page: Int): Request = listRequest(page, mapOf("sort" to "popular"))

    override fun latestUpdatesRequest(page: Int): Request = listRequest(page, mapOf("sort" to "latest"))

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) {
            val b = "$baseUrl/search".toHttpUrl().newBuilder()
                .addQueryParameter("q", query.trim())
            if (page > 1) b.addQueryParameter("page", page.toString())
            return GET(b.build(), headers)
        }
        val params = LinkedHashMap<String, String>()
        filters.forEach { f ->
            if (f is PairSelect) params[f.param] = f.value()
        }
        return listRequest(page, params)
    }

    override fun popularMangaParse(response: Response): MangasPage = parseList(response)
    override fun latestUpdatesParse(response: Response): MangasPage = parseList(response)
    override fun searchMangaParse(response: Response): MangasPage = parseList(response)

    private fun doc(response: Response): Document =
        Jsoup.parse((response.body?.string() ?: ""), response.request.url.toString())

    private fun parseList(response: Response): MangasPage {
        val document = doc(response)
        val seen = HashSet<String>()
        val mangas = ArrayList<SManga>()

        for (a in document.select("a[href]")) {
            val path = a.absUrl("href").toHttpUrlOrNull()?.encodedPath ?: continue
            if (!COMIC_PATH.matches(path)) continue
            if (a.closest("[data-reader-banner]") != null) continue
            if (!seen.add(path)) continue

            val img = a.select("img").firstOrNull {
                val s = it.attr("src")
                s.isNotBlank() && !s.contains("/platforms/logos/") && !s.endsWith(".svg")
            }
            val title = img?.attr("alt")?.removeSuffix(" 표지")?.trim()?.takeIf { it.isNotEmpty() }
                ?: a.attr("aria-label").substringBeforeLast(", ").takeIf { it.isNotBlank() }
                ?: a.text().trim()
            if (title.isEmpty()) continue

            mangas.add(
                SManga.create().apply {
                    url = path
                    this.title = title
                    thumbnail_url = img?.let { it.absUrl("src").ifEmpty { it.absUrl("data-src") } }
                },
            )
        }

        val cur = response.request.url.queryParameter("page")?.toIntOrNull() ?: 1
        val maxPage = document.select("a[href*=page=]").mapNotNull {
            it.absUrl("href").toHttpUrlOrNull()?.queryParameter("page")?.toIntOrNull()
        }.maxOrNull() ?: 0
        val hasNext = document.selectFirst("a[rel=next]") != null || maxPage > cur

        if (hasNext && mangas.isNotEmpty()) {
            prefetch(response.request.url.newBuilder().setQueryParameter("page", (cur + 1).toString()).build())
        }
        return MangasPage(mangas, hasNext && mangas.isNotEmpty())
    }

    // ---------- 상세 ----------
    override fun mangaDetailsParse(response: Response): SManga {
        val document = doc(response)
        val h1 = document.selectFirst("h1#comic-title") ?: document.selectFirst("h1")
        val box = h1?.parent()
        return SManga.create().apply {
            title = h1?.text()?.trim().orEmpty()
            author = box?.selectFirst("a[href*=/search?q=]")?.text()?.trim()
            description = document.selectFirst("[data-comic-description]")?.text()?.trim()
            genre = box?.select("a[href*=category=]")?.map { it.text().trim() }
                ?.filter { it.isNotEmpty() }?.distinct()?.joinToString(", ")
            val states = document.select("strong").map { it.text().trim() }
            status = when {
                states.any { it == "완결" } -> SManga.COMPLETED
                states.any { it.startsWith("연재") } -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
            thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content")
        }
    }

    // ---------- 회차 ----------
    private val dateFormat by lazy {
        SimpleDateFormat("yyyy.MM.dd", Locale.KOREA).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }
    }

    private fun chapter(comicId: String, id: String, title: String, date: String): SChapter =
        SChapter.create().apply {
            url = "/comics/$comicId/chapters/$id"
            name = title
            date_upload = try {
                dateFormat.parse(date)?.time ?: 0L
            } catch (e: Exception) {
                0L
            }
            chapter_number = NUMBER_REGEX.find(title)?.value?.toFloatOrNull() ?: -1f
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val document = doc(response)
        val comicId = response.request.url.pathSegments.getOrNull(1) ?: return emptyList()
        val result = LinkedHashMap<String, SChapter>()

        // 1) 상세 페이지에 들어있는 첫 묶음 (모바일/PC 목록이 겹쳐 있어 id로 중복 제거)
        for (row in document.select("a.chapter-item[data-chapter-id]")) {
            val id = row.attr("data-chapter-id")
            if (id.isBlank() || result.containsKey(id)) continue
            val title = row.selectFirst("span.truncate")?.text()?.trim().orEmpty()
            val date = DATE_REGEX.find(row.text())?.value.orEmpty()
            result[id] = chapter(comicId, id, title, date)
        }

        // 2) 나머지는 JSON 더보기 API (/comics/{id}/chapters?page=N) - 가능하면 동시에 요청
        fun addJson(json: JSONObject) {
            val arr = json.optJSONArray("chapters") ?: return
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val id = o.optString("id")
                if (id.isBlank() || result.containsKey(id)) continue
                result[id] = chapter(comicId, id, o.optString("title"), o.optString("date"))
            }
        }

        var page = document.selectFirst("[data-chapter-next-page]")
            ?.attr("data-chapter-next-page")?.toIntOrNull()
            ?: if (result.isEmpty()) 1 else 2
        val size = document.selectFirst("[data-chapter-page-size]")
            ?.attr("data-chapter-page-size")?.toIntOrNull()?.takeIf { it > 0 } ?: 20
        val total = TOTAL_REGEX.find(document.text())
            ?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull()

        if (total != null && total > result.size) {
            val last = (total + size - 1) / size
            if (last >= page) {
                val pool = java.util.concurrent.Executors.newFixedThreadPool(6)
                try {
                    val futures = (page..last).map { p ->
                        pool.submit<JSONObject?> { fetchChapterPage(comicId, p) }
                    }
                    futures.forEach { f -> f.get()?.let { addJson(it) } }
                } finally {
                    pool.shutdown()
                }
                page = last + 1
            }
        }

        // 총 개수를 못 읽었거나 덜 가져온 경우: 순서대로 이어서 요청
        if (total == null || result.size < total) {
            var guard = 0
            while (guard++ < 300) {
                val json = fetchChapterPage(comicId, page) ?: break
                addJson(json)
                if (!json.optBoolean("has_more", false)) break
                val next = json.optInt("next_page", -1)
                page = if (next > page) next else page + 1
            }
        }

        return result.values.toList() // 사이트 순서(최신 → 과거) 그대로
    }

    private fun fetchChapterPage(comicId: String, page: Int): JSONObject? {
        val url = "$baseUrl/comics/$comicId/chapters".toHttpUrl().newBuilder()
            .addQueryParameter("page", page.toString()).build()
        val h = headers.newBuilder()
            .set("Accept", "application/json, text/plain, */*")
            .set("X-Requested-With", "XMLHttpRequest")
            .set("Referer", "$baseUrl/comics/$comicId")
            .build()
        return try {
            client.newCall(GET(url, h)).execute().use {
                if (!it.isSuccessful) null else JSONObject(it.body?.string() ?: "{}")
            }
        } catch (e: Exception) {
            null
        }
    }

    // ---------- 이미지 ----------
    override fun pageListParse(response: Response): List<Page> {
        val document = doc(response)
        val urls = document.select("[data-reader-page] img.reader-page, [data-reader-page] img[data-reader-image]")
            .map { it.absUrl("src").ifEmpty { it.absUrl("data-src") } }
            .filter { it.isNotEmpty() }
            .distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request {
        val h = headers.newBuilder().set("Referer", "$baseUrl/").build()
        return GET(page.imageUrl!!, h)
    }

    override fun imageUrlParse(response: Response): String =
        throw UnsupportedOperationException()

    // ---------- 필터 (검색어 없을 때 사용) ----------
    override fun getFilterList() = FilterList(
        Filter.Header("검색어를 입력하면 필터는 무시됩니다"),
        *(
            if (fixedCategory.isEmpty()) {
                arrayOf<Filter<*>>(
                    PairSelect(
                        "분류", "category",
                        arrayOf("전체" to "", "일반만화" to "일반만화", "BL·GL" to "BL·GL", "성인만화" to "성인"),
                    ),
                )
            } else {
                emptyArray<Filter<*>>()
            }
            ),
        PairSelect(
            "요일", "weekday",
            arrayOf(
                "전체" to "", "월" to "월", "화" to "화", "수" to "수", "목" to "목",
                "금" to "금", "토" to "토", "일" to "일",
            ),
        ),
        PairSelect(
            "장르", "genre",
            arrayOf(
                "전체" to "", "로맨스" to "1", "드라마" to "4", "판타지" to "2",
                "로맨스판타지" to "2739", "성장물" to "2753", "액션" to "3", "능력녀" to "2902",
                "소설원작" to "2774", "왕족/귀족" to "2777", "다정남" to "2904", "먼치킨" to "2772",
                "로맨틱코미디" to "2903", "능력남" to "2905", "완결로맨스" to "3266", "달달물" to "2771",
                "개그/코미디" to "6", "성장" to "2874", "복수" to "2754", "무협/사극" to "2743",
                "빙의" to "2757", "성인" to "2782", "현대물" to "2751", "고수위" to "2783",
                "첫사랑" to "2763", "짝사랑" to "2764", "학원/캠퍼스" to "2745", "오피스" to "2752",
                "하렘/역하렘" to "2786", "하렘" to "2813", "은밀한 관계" to "2832", "회사원" to "2849",
                "일탈" to "2880", "BL" to "2788", "한국BL" to "3201", "현대극" to "3202",
                "다정공" to "2791", "집착공" to "2792", "미남공" to "3067", "미인수" to "2797",
                "미인공" to "2796", "능글공" to "2802", "상처수" to "2799", "순정공" to "2803",
                "다정수" to "2800", "대형견공" to "2804", "재회" to "2765", "강공" to "2793",
                "삼각관계" to "2768",
            ),
        ),
        PairSelect(
            "연재 상태", "status",
            arrayOf("전체" to "", "연재중" to "연재중", "완결" to "완결"),
        ),
        PairSelect(
            "플랫폼", "platform",
            arrayOf(
                "전체" to "", "카카오페이지" to "kakao-page", "네이버" to "naver", "레진코믹스" to "lezhin",
                "리디" to "ridi", "탑툰" to "toptoon", "봄툰" to "bomtoon", "미스터블루" to "mrblue",
                "투믹스" to "toomics", "피너툰" to "peanutoon", "코미코" to "comico",
            ),
        ),
        PairSelect(
            "정렬", "sort",
            arrayOf("최신순" to "latest", "인기순" to "popular"),
        ),
    )

    private class PairSelect(
        name: String,
        val param: String,
        private val pairs: Array<Pair<String, String>>,
    ) : Filter.Select<String>(name, pairs.map { it.first }.toTypedArray()) {
        fun value(): String = pairs[state].second
    }

    companion object {
        private const val DEFAULT_BASE_URL = "https://newxtoon1.com"
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_UA = "pref_user_agent"
        private const val KEY_AUTO = "pref_auto_domain"
        private val HOST_REGEX = Regex("^(www\\.)?newxtoon\\d*\\.com$")
        private const val FALLBACK_UA =
            "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val COMIC_PATH = Regex("^/comics/\\d+$")
        private val DATE_REGEX = Regex("\\d{4}\\.\\d{2}\\.\\d{2}")
        private val TOTAL_REGEX = Regex("총\\s*([\\d,]+)\\s*화")
        private val NUMBER_REGEX = Regex("\\d+(?:\\.\\d+)?")
    }
}

/**
 * 확장앱 하나에 여러 소스를 담는 구조 (DC Manga 방식).
 * 소스를 늘리려면 아래 목록에 한 줄 추가하면 됩니다. 앱의 확장 정보 화면에서 소스별로 켜고 끌 수 있습니다.
 */
class NewXtoonFactory : SourceFactory {
    override fun createSources(): List<Source> {
        val list = mutableListOf<Source>()
        try {
            list.add(NewXtoon()) // 전체 (newxtoon 웹툰)
        } catch (e: Throwable) {
            list.add(ErrorSource("newxtoon 오류", e))
        }
        try {
            list.add(Goodtoon())
        } catch (e: Throwable) {
            list.add(ErrorSource("Goodtoon 오류", e))
        }
        try {
            list.add(Jjaptoon())
        } catch (e: Throwable) {
            list.add(ErrorSource("Jjaptoon 오류", e))
        }
        try {
            list.add(Blacktoon())
        } catch (e: Throwable) {
            list.add(ErrorSource("Blacktoon 오류", e))
        }
        try {
            list.add(Toon11())
        } catch (e: Throwable) {
            list.add(ErrorSource("11toon 오류", e))
        }
        return list
    }
}

/** 이름이 같은 다른 저장소 소스와 ID가 겹치지 않도록, 고정 키로 소스 ID 생성 (앱의 ID 생성 방식과 동일) */
internal fun uniqueSourceId(key: String): Long {
    val bytes = java.security.MessageDigest.getInstance("MD5").digest(key.toByteArray())
    return (0..7).map { bytes[it].toLong() and 0xffL shl 8 * (7 - it) }
        .reduce(Long::or) and Long.MAX_VALUE
}

/** 소스 생성이 실패해도 확장 전체가 사라지지 않고, 오류 내용을 소스 이름에 보여줌 */
class ErrorSource(label: String, err: Throwable) : HttpSource() {
    override val name = "$label: ${err.javaClass.simpleName} ${err.message ?: ""}".take(120)
    override val lang = "ko"
    override val baseUrl = "https://example.invalid"
    override val supportsLatest = false
    private fun fail(): Nothing = throw UnsupportedOperationException(name)
    override fun popularMangaRequest(page: Int): Request = fail()
    override fun popularMangaParse(response: Response): MangasPage = fail()
    override fun latestUpdatesRequest(page: Int): Request = fail()
    override fun latestUpdatesParse(response: Response): MangasPage = fail()
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request = fail()
    override fun searchMangaParse(response: Response): MangasPage = fail()
    override fun mangaDetailsParse(response: Response): SManga = fail()
    override fun chapterListParse(response: Response): List<SChapter> = fail()
    override fun pageListParse(response: Response): List<Page> = fail()
    override fun imageUrlParse(response: Response): String = fail()
}
