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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

/**
 * 머니툰 (mtoon165.asia, 2026-11-06) — 망가요미 mtoon.js 와 같은 구조를 애니요미용으로 옮김.
 * 목록·검색: "더보기" 자료 more.php?wt_fin=(연재중|완결)&w=(8 UP·1~6 월~토·0 일·7 열흘)&c=시작 / &cate=장르 / ?search= → JSON 배열 30개씩
 * 작품: list.php?i=N (h1.list_page_title, .list_page_head img·p, 회차 li.mb-2 .l_d_t a[detail.php?wi=N] + .l_d_d 날짜, 최신이 위)
 * 회차: detail.php?wi=N 의 img 중 /data/file/ 그림 (광고 /ban/ 제외)
 * 사이트는 User-Agent 없는 요청을 Cloudflare 확인 화면(403)으로 막음 → 항상 휴대폰 UA 를 넣음
 */
class Mtoon : HttpSource(), ConfigurableSource {

    override val name = "머니툰 웹툰"
    override val id: Long = uniqueSourceId("newxtoon.mtoon/ko/1")
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

    override val baseUrl: String
        get() = DomainGuard.pick(runCatching { sp }.getOrNull(), KEY_DOMAIN, DEFAULT, autoDomain(), { Regex("^https?://[^\\s/]+$").matches(it) }).also { cur ->
            // 6시간마다 저장소 주소 목록(감시 작업이 매일 고침)에 더 큰 번호가 있고 진짜 사이트면 그 주소로 (뒤에서)
            DomainList.followLater("mtoon", runCatching { sp }.getOrNull(), KEY_DOMAIN, cur, autoDomain()) { h -> HOST_REGEX.matches(h) && DomainList.realSite(h, userAgent, MARK, "list.php?i=") }
        }

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

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        .apply { interceptors().add(0, FriendlyErrors) }
        .apply { interceptors().add(1, ImageRetry) }
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> domainIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, MARK))
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
        if (res.code == 403 && HOST_REGEX.matches(req.url.host)) {
            val peek = try {
                res.peekBody(4000).string()
            } catch (e: Exception) {
                ""
            }
            if (CF_PAGE.containsMatchIn(peek)) {
                res.close()
                throw java.io.IOException("사이트 보안 확인(Cloudflare)이 떴어요. 오른쪽 위 웹뷰로 사이트를 한 번 열어 통과한 뒤 다시 불러와 주세요.")
            }
        }
        // 5xx·접근 차단(451)이면 새 주소 찾기 (2026-11-07)
        if (ours && (res.code >= 500 || res.code == 451)) {
            val found = discoverDomain(baseHost!!)
            if (found != null) {
                res.close()
                saveDomain("https://$found")
                return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
            }
        }
        val finalHost = res.request.url.host
        if (ours && res.code == 200 && finalHost != baseHost && HOST_REGEX.matches(finalHost)) {
            saveDomain("https://$finalHost")
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("mtoon(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    private fun probe(plain: okhttp3.OkHttpClient, url: String, ua: String): String? = try {
        val r = Request.Builder().url(url).header("User-Agent", ua).build()
        plain.newCall(r).execute().use { res ->
            val fh = res.request.url.host
            val body = if (res.code == 200) res.body?.string().orEmpty() else ""
            if (HOST_REGEX.matches(fh) && body.contains(MARK) && body.contains("list.php?i=")) fh else null
        }
    } catch (e: Exception) {
        null
    }

    /** 새 주소 찾기: ① 저장소 주소 목록(domains.json) ② mtoonN.asia (지금 번호 -3 ~ +20) 중 열리는 가장 큰 번호 */
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
        DomainList.host("mtoon")?.takeIf { it != currentHost }?.let { probe(plain, "https://$it/", ua) }?.takeIf { it != currentHost }?.let { return it }
        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        try {
            ((cur - 3).coerceAtLeast(1)..(cur + 20)).map { "mtoon$it.asia" }.filter { it != currentHost }
                .map { host -> pool.submit<String?> { probe(plain, "https://$host/", ua) } }
                .mapNotNull { it.get() }.filter { it != currentHost }.maxByOrNull { hostNumber(it) }
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
            summary = "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 주소가 확인되면 자동으로 바뀜 (기본: $DEFAULT)"
            dialogTitle = "도메인 주소"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                Regex("^https?://[^\\s/]+$").matches((v as String).trim().trimEnd('/'))
            }
        }.also(screen::addPreference)

        androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "접속이 안 되면 머니툰 번호 주소(mtoonN.asia) 중 열리는 주소로 자동 변경"
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

    // ---------- 목록 (more.php JSON, 30개씩) ----------
    private fun today(): String =
        (Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).get(Calendar.DAY_OF_WEEK) - 1).toString()

    private fun moreReq(page: Int, fin: String = "연재중", w: String = "", cate: String = "", search: String = ""): Request {
        val b = "$baseUrl/more.php".toHttpUrl().newBuilder()
        if (search.isNotEmpty()) {
            b.addQueryParameter("search", search)
            if (fin == "완결") b.addQueryParameter("wt_fin", fin)
        } else {
            b.addQueryParameter("wt_fin", fin.ifEmpty { "연재중" })
            if (cate.isNotEmpty()) b.addQueryParameter("cate", cate) else b.addQueryParameter("w", if (w.isEmpty() || w == "today") today() else w)
        }
        b.addQueryParameter("c", ((page.coerceAtLeast(1) - 1) * PAGE_SIZE).toString())
        return GET(b.build(), headersBuilder().set("X-Requested-With", "XMLHttpRequest").build())
    }

    override fun popularMangaRequest(page: Int) = moreReq(page, w = "today")
    override fun latestUpdatesRequest(page: Int) = moreReq(page, w = "8")

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) return moreReq(page, search = query.trim())
        var fin = "연재중"
        var w = "today"
        var cate = ""
        filters.forEach { f ->
            if (f is Pick) {
                val v = f.pairs[f.state].second
                when (f.param) {
                    "wt_fin" -> fin = v
                    "w" -> w = v
                    "cate" -> cate = v
                }
            }
        }
        return moreReq(page, fin, w, cate)
    }

    override fun popularMangaParse(response: Response) = parseMore(response)
    override fun latestUpdatesParse(response: Response) = parseMore(response)
    override fun searchMangaParse(response: Response) = parseMore(response)

    private fun parseMore(response: Response): MangasPage {
        val body = response.body?.string().orEmpty().trim()
        val arr = try {
            if (body.startsWith("{")) JSONObject(body).let { o -> JSONArray().apply { o.keys().forEach { put(o.get(it)) } } } else JSONArray(body.ifEmpty { "[]" })
        } catch (e: Exception) {
            throw Exception("목록을 읽지 못했어요 [${body.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").take(60)}]")
        }
        val list = ArrayList<SManga>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val idx = o.optString("wt_idx")
            if (idx.isEmpty()) continue
            META[idx] = o
            val title = Jsoup.parse(o.optString("wt_title")).text().trim()
            if (title.isEmpty()) continue
            list.add(
                SManga.create().apply {
                    url = "/list.php?i=$idx"
                    this.title = title
                    thumbnail_url = thumb(o.optString("wt_thumb"))
                },
            )
        }
        return MangasPage(list, arr.length() >= PAGE_SIZE)
    }

    private fun thumb(t: String): String? {
        val v = t.trim()
        if (v.isEmpty() || v == "null") return null
        if (v.startsWith("http")) return v
        return "$baseUrl/img/data/webtoon/" + v.removePrefix("./").removePrefix("/").removePrefix("img/data/webtoon/")
    }

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        val head = d.selectFirst(".list_page_head")
        val title = d.selectFirst("h1.list_page_title")?.text()?.trim().orEmpty()
        val idx = Regex("[?&]i=(\\d+)").find(response.request.url.toString())?.groupValues?.get(1).orEmpty()
        val meta = META[idx] ?: findMeta(idx, title)
        return SManga.create().apply {
            this.title = title
            thumbnail_url = head?.selectFirst("img")?.absUrl("src")?.ifEmpty { null } ?: meta?.let { thumb(it.optString("wt_thumb")) }
            val intro = head?.selectFirst("p")?.text()?.trim().orEmpty().ifEmpty { meta?.optString("wt_intro").orEmpty().trim() }
            val info = listOfNotNull(
                meta?.optString("wt_company")?.takeIf { it.isNotBlank() && it != "null" }?.let { "연재처: $it" },
                meta?.optString("wt_sca")?.takeIf { it.isNotBlank() && it != "null" && meta?.optString("wt_fin") != "완결" }?.let { "연재 요일: $it" },
            ).joinToString(" · ")
            description = listOf(intro, info).filter { it.isNotEmpty() }.joinToString("\n\n")
            author = meta?.optString("wt_author")?.takeIf { it.isNotBlank() && it != "null" }
            genre = meta?.optString("wt_genre")?.split(",", "/")?.map { it.trim() }?.filter { it.isNotEmpty() && it != "null" }?.distinct()?.joinToString(", ")
            status = when (meta?.optString("wt_fin")) {
                "완결" -> SManga.COMPLETED
                "연재중" -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    /** 작품 화면에 없는 작가·장르·상태: 제목으로 검색해 찾음 */
    private fun findMeta(idx: String, title: String): JSONObject? {
        if (idx.isEmpty() || title.isEmpty()) return null
        return try {
            searchBoth(1, title)
            META[idx]
        } catch (e: Exception) {
            null
        }
    }

    // ---------- 회차 (작품 화면에 전부, 최신이 위) ----------
    override fun chapterListRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    @Suppress("DEPRECATION")
    override fun fetchMangaDetails(manga: SManga): Observable<SManga> =
        super.fetchMangaDetails(manga).map { MissingNote.apply(it) { fetchChapterList(manga).toBlocking().first() } }

    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map { ChapterOrder.bundleSequence(it) }
            .map { if (ChapterPosition.enabled(sp)) ChapterPosition.label(it, manga.title) else it }

    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }

    private fun siteDate(t: String): Long {
        val dayMs = 86_400_000L
        val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val midnight = cal.timeInMillis
        Regex("(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})").find(t)?.let { m ->
            return try {
                dayFmt.parse("${m.groupValues[1]}-${m.groupValues[2].padStart(2, '0')}-${m.groupValues[3].padStart(2, '0')}")?.time ?: 0L
            } catch (e: Exception) {
                0L
            }
        }
        return when {
            t.startsWith("오늘") || Regex("\\d+\\s*(시간|분|초)\\s*전").containsMatchIn(t) -> midnight
            t.startsWith("어제") -> midnight - dayMs
            else -> Regex("(\\d+)\\s*일\\s*전").find(t)?.groupValues?.get(1)?.toLongOrNull()?.let { midnight - it * dayMs } ?: 0L
        }
    }

    /** "A.I. 닥터 249화"·"257화 ： 부제" 처럼 섞인 이름 → "N화 : 부제" (외전·번외는 그대로) */
    private fun chapterName(raw: String, title: String): String {
        val n = raw.replace(Regex("\\s+"), " ").trim()
        if (EXTRA.containsMatchIn(n)) return n
        val m = Regex("(\\d+(?:\\.\\d+)?)\\s*화\\s*[:：\\-–.]?\\s*(.*)$").find(n) ?: return n
        val sub = m.groupValues[2].trim()
        val same = sub.replace(" ", "") == title.replace(" ", "")
        return "${m.groupValues[1]}화" + if (sub.isNotEmpty() && !same) " : $sub" else ""
    }

    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val title = d.selectFirst("h1.list_page_title")?.text()?.trim().orEmpty()
        val seen = HashSet<String>()
        // 사이트 순서(최신 → 과거)
        val raw = d.select("li.mb-2").mapNotNull { li ->
            val a = li.selectFirst(".l_d_t a[href*=detail.php]") ?: return@mapNotNull null
            val wi = Regex("wi=(\\d+)").find(a.attr("href"))?.groupValues?.get(1) ?: return@mapNotNull null
            if (!seen.add(wi)) return@mapNotNull null
            Triple("/detail.php?wi=$wi", a.text().replace(Regex("\\s+"), " ").trim(), siteDate(li.selectFirst(".l_d_d")?.text()?.trim().orEmpty()))
        }
        messyOrder(raw, title)?.let { return it }
        fun numOf(name: String): Float? =
            if (EXTRA.containsMatchIn(name)) null else Regex("^(\\d+(?:\\.\\d+)?)화").find(name)?.groupValues?.get(1)?.toFloatOrNull()
        // 같은 번호가 또 올라왔으면 최근 것(위쪽) 하나만 — 번호가 겹치면 앱이 하나로 합침
        val kept = HashSet<Float>()
        val list = raw.map { (u, name, date) -> Triple(u, chapterName(name, title), date) }
            .filter { (_, name, _) -> numOf(name)?.let { kept.add(it) } ?: true }
        // 번호 없는 회차(외전·후기 등)는 바로 앞(과거) 회차 번호 + 0.5, 0.6 …
        val out = ArrayList<SChapter>(list.size)
        var last = 0f
        var step = 0
        for ((url, name, date) in list.asReversed()) {
            val n = numOf(name)
            val num: Float
            val shown: String
            if (n != null) {
                last = n
                step = 0
                num = n
                shown = name
            } else {
                step = (step + 1).coerceAtMost(9)
                num = Math.round((last + 0.5f + (step - 1) / 10f) * 10f) / 10f
                shown = if (name.firstOrNull()?.isDigit() == true && !EXTRA.containsMatchIn(name)) name else "${num.toString().removeSuffix(".0")} · $name"
            }
            out.add(
                SChapter.create().apply {
                    this.url = url
                    this.name = shown
                    chapter_number = num
                    date_upload = date
                },
            )
        }
        return out.asReversed()
    }

    /**
     * 회차 이름이 뒤죽박죽인 작품 (2026-11-06, 망가요미 mtoon.js 0.1.13 orderChapters 와 같은 규칙).
     * 선을 넘는 짐승들: 1부 "N화" → 2부 "빈집털이 2"·"은밀한 왁싱 케어 7" 처럼 '화' 없이 에피소드 이름+숫자, 같은 번호 다시 올림.
     * '화' 없는 회차(외전·후기 등 제외)가 3개 이상이거나 번호가 거꾸로 가면 → 같은 이름 다시 올린 것은 최근 것만,
     * 올라온 순서대로 차례 번호 ("45화 : 빈집털이 2"). 아니면 null (예전 방식)
     */
    private fun messyOrder(raw: List<Triple<String, String, Long>>, title: String): List<SChapter>? {
        val t = title.replace(Regex("\\s+"), " ").trim()
        fun strip(v: String): String {
            val x = v.replace(Regex("\\s+"), " ").trim()
            if (t.isNotEmpty() && x.startsWith(t)) return x.substring(t.length).replace(Regex("^[\\s\\-–:·.]+"), "").trim().ifEmpty { x }
            return x
        }
        val extra = Regex("외전|번외|특별|후기|에필로그|프롤로그|공지|휴재")
        fun numIn(v: String): Float? =
            if (extra.containsMatchIn(v)) null else Regex("(\\d+(?:\\.\\d+)?)\\s*화").find(v)?.groupValues?.get(1)?.toFloatOrNull()
        var unnumbered = 0
        var backwards = false
        var maxSeen = -1f
        for ((_, name, _) in raw.asReversed()) {
            val v = numIn(strip(name))
            if (v == null) {
                if (!extra.containsMatchIn(name)) unnumbered++
                continue
            }
            if (v < maxSeen) backwards = true
            maxSeen = maxOf(maxSeen, v)
        }
        if (unnumbered < 3 && !backwards) return null
        val seenKey = HashSet<String>()
        val kept = raw.filter { (_, name, _) -> seenKey.add(strip(name).replace(Regex("\\s+"), "").lowercase()) }
        val total = kept.size
        return kept.mapIndexed { i, (u, name, date) ->
            val no = total - i
            var rest = strip(name)
            val lead = Regex("^$no\\s*화\\s*[:：\\-–.]?\\s*")
            while (lead.containsMatchIn(rest)) rest = rest.replaceFirst(lead, "")
            SChapter.create().apply {
                url = u
                this.name = if (rest.isEmpty()) "${no}화" else "${no}화 : $rest"
                chapter_number = no.toFloat()
                date_upload = date
            }
        }
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter) = GET(baseUrl + chapter.url, headers)

    override fun pageListParse(response: Response): List<Page> {
        val d = response.asDoc()
        val urls = d.select("img").map { img ->
            listOf("data-src", "data-original", "src").firstNotNullOfOrNull { k -> img.absUrl(k).takeIf { it.isNotEmpty() } }.orEmpty()
        }.filter { it.contains("/data/file/") && !it.contains("/ban/") && !it.contains("/assets/") }.distinct()
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없어요 — 막 올라온 회차면 사이트가 그림을 아직 안 올렸을 수 있어요")
        warm(urls)
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    /**
     * 그림 미리 준비 (2026-11-06): 그림 서버(Cloudflare)는 처음 요청된 그림을 원래 서버에서 가져오느라 한 장에 1.5~2초,
     * 저장된 그림은 0.2초. 애니요미는 그림을 한 장씩 차례로 받아 느림(망가요미는 여러 장 동시라 괜찮음)
     * → 회차를 열 때 모든 그림에 HEAD(내용 없이 머리만) 를 6장씩 동시에 뒤에서 보내 서버가 미리 가져다 두게 함
     */
    private val warmClient by lazy {
        okhttp3.OkHttpClient.Builder()
            .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }

    private val warmPool by lazy {
        java.util.concurrent.Executors.newFixedThreadPool(6) { r -> Thread(r, "mtoon-warm").apply { isDaemon = true } }
    }

    private fun warm(urls: List<String>) {
        val h = try {
            headersBuilder().set("Referer", "$baseUrl/").build()
        } catch (e: Throwable) {
            return
        }
        urls.forEach { u ->
            try {
                warmPool.execute {
                    try {
                        warmClient.newCall(Request.Builder().url(u).headers(h).head().build()).execute().close()
                    } catch (e: Exception) {
                        // 미리 준비 실패는 무시 (읽을 때 그냥 받음)
                    }
                }
            } catch (e: Throwable) {
                return
            }
        }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 인기/최신 탭 규칙 ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchPopularManga(page)

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: super.fetchLatestUpdates(page)

    /** 붙여 넣은 사이트 주소 → 작품 주소 */
    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        u.queryParameter("i")?.takeIf { u.encodedPath.endsWith("list.php") && it.all(Char::isDigit) }?.let { "/list.php?i=$it" }

    // 검색 띄어쓰기: 결과가 없으면 띄어쓰기 뺀 검색어 등으로 다시 찾음(SearchSpacing)
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> =
        SearchSpacing.wrap(page, query) { q, p -> fetchSearchMangaInner(p, q, filters) }

    private fun fetchSearchMangaInner(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        if (query.isNotBlank()) return Observable.fromCallable { searchBoth(page, query.trim()) }
        return super.fetchSearchManga(page, query, filters)
    }

    /**
     * 사이트 검색은 기본으로 연재 중 작품만 찾음(완결작 "키메이커 작업의신" 0개, 2026-11-06 검색 검사)
     * → 연재·완결을 같이 찾아 합침 (완결 쪽이 실패하면 연재 결과만)
     */
    private fun searchBoth(page: Int, kw: String): MangasPage {
        val ing = client.newCall(moreReq(page, search = kw)).execute().use { parseMore(it) }
        val fin = runCatching { client.newCall(moreReq(page, fin = "완결", search = kw)).execute().use { parseMore(it) } }.getOrNull()
        val seen = HashSet<String>()
        val list = (ing.mangas + fin?.mangas.orEmpty()).filter { seen.add(it.url) }
        return MangasPage(list, ing.hasNextPage || fin?.hasNextPage == true)
    }

    override fun getFilterList() = ExtStatus.prepend(
        "mtoon",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어가 있으면 아래 조건은 무시 · 장르를 고르면 요일은 무시 (사이트와 같음)"),
                Pick("목록", "wt_fin", STATES),
                Pick("요일", "w", DAYS),
                Pick("장르", "cate", GENRES),
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val PAGE_SIZE = 30
        private const val MARK = "money_toon.png"
        private const val DEFAULT = "https://mtoon168.asia"
        private const val FALLBACK_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^(www\\.)?mtoon\\d+\\.asia$")
        private val CF_PAGE = Regex("Just a moment|cf-chl|challenge-platform|cf_chl_opt", RegexOption.IGNORE_CASE)
        private val EXTRA = Regex("외전|번외|특별")

        /** 목록에서 받은 작가·장르·상태 (작품 화면에 없어서) */
        private val META = ConcurrentHashMap<String, JSONObject>()

        private val STATES = listOf("연재" to "연재중", "완결" to "완결")
        private val DAYS = listOf(
            "오늘 요일" to "today", "UP (최근 업데이트)" to "8", "월" to "1", "화" to "2", "수" to "3",
            "목" to "4", "금" to "5", "토" to "6", "일" to "0", "열흘" to "7",
        )
        private val GENRES = listOf(
            "전체 (요일로 보기)" to "", "판타지" to "판타지", "액션" to "액션", "개그" to "개그", "미스터리" to "미스터리",
            "로맨스" to "로맨스", "드라마" to "드라마", "무협" to "무협", "스포츠" to "스포츠", "일상" to "일상",
            "학원" to "학원", "성인" to "성인", "BL" to "BL", "SF" to "SF", "시대극" to "시대극", "기타" to "기타",
        )
    }
}
