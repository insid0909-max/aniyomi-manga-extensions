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
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

/**
 * 코믹툰툰 (comictt7.com, 2026-11-06) — 망가요미 comictt.js 와 같은 구조를 애니요미용으로 옮김.
 * 목록: /mlist.php?sl=(빈 값 연재|2 완결)&type1=장르&type2=요일&type3=초성&odtype=(빈 값 최신|ctime 신작|hits 인기) — 한 화면에 전부(300개쯤) → 30개씩 나눠 보여 줌(5분 기억)
 * 카드: .manga-card(onclick mview1.php?id=N) img data-original + h3.manga-title, 검색: /search.php?keyword=
 * 작품: /mview1.php?id=N (.episode-title·.episode-genre "#BL"·.episode-synopsis·.episode-thumbnail img, 회차 .episode-item a /mview2.php?id=N + .episode-number0(올라온 순번)·.episode-number·.episode-date)
 * 회차: /mview2.php?id=N (img[alt="… N화_n"] data-original)
 */
class Comictt : HttpSource(), ConfigurableSource {

    override val name = "코믹툰툰 웹툰"
    override val id: Long = uniqueSourceId("newxtoon.comictt/ko/1")
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
        get() = DomainGuard.pick(runCatching { sp }.getOrNull(), KEY_DOMAIN, DEFAULT, autoDomain(), { Regex("^https?://[^\\s/]+$").matches(it) })

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
        if (ours && res.code >= 500) {
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
        Regex("comictt(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    private fun probe(plain: okhttp3.OkHttpClient, url: String, ua: String): String? = try {
        val r = Request.Builder().url(url).header("User-Agent", ua).build()
        plain.newCall(r).execute().use { res ->
            val fh = res.request.url.host
            val body = if (res.code == 200) res.body?.string().orEmpty() else ""
            if (HOST_REGEX.matches(fh) && body.contains(MARK) && body.contains("mview1.php")) fh else null
        }
    } catch (e: Exception) {
        null
    }

    /** 새 주소 찾기: ① 저장소 주소 목록(domains.json) ② comicttN.com (지금 번호 -3 ~ +20) 중 열리는 가장 큰 번호 */
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
        DomainList.host("comictt")?.takeIf { it != currentHost }?.let { probe(plain, "https://$it/mlist.php", ua) }?.takeIf { it != currentHost }?.let { return it }
        val cur = hostNumber(currentHost).takeIf { it > 0 } ?: hostNumber(DEFAULT)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        try {
            ((cur - 3).coerceAtLeast(1)..(cur + 20)).map { "comictt$it.com" }.filter { it != currentHost }
                .map { host -> pool.submit<String?> { probe(plain, "https://$host/mlist.php", ua) } }
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
            summary = "접속이 안 되면 코믹툰툰 번호 주소(comicttN.com) 중 열리는 주소로 자동 변경"
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

    // ---------- 목록 (한 화면에 전부 → 30개씩, 5분 기억) ----------
    private class Cached(val at: Long, val list: List<SManga>)

    private val listCache = ConcurrentHashMap<String, Cached>()

    private fun listUrl(sl: String = "", type1: String = "", type2: String = "", type3: String = "", odtype: String = ""): String {
        val b = "$baseUrl/mlist.php".toHttpUrl().newBuilder()
        b.addQueryParameter("sl", sl).addQueryParameter("type1", type1).addQueryParameter("type2", type2)
            .addQueryParameter("type3", type3).addQueryParameter("odtype", odtype)
        return b.build().toString()
    }

    private fun searchUrl(q: String): String =
        "$baseUrl/search.php".toHttpUrl().newBuilder().addQueryParameter("keyword", q).build().toString()

    private fun listPage(url: String, page: Int, sl: String? = null): Observable<MangasPage> = Observable.fromCallable {
        val c = listCache[url]
        val all = if (c != null && System.currentTimeMillis() - c.at < 300_000) {
            c.list
        } else {
            client.newCall(GET(url, headers)).execute().use { parseCards(it.asDoc()) }.also { listCache[url] = Cached(System.currentTimeMillis(), it) }
        }
        // 연재/완결 목록에서 본 작품만 기억 (검색 결과는 섞여 있어 모름)
        if (sl != null) all.forEach { m -> if (sl == "2" || !FIN.containsKey(m.url)) FIN[m.url] = sl == "2" }
        val from = (page.coerceAtLeast(1) - 1) * PAGE_SIZE
        MangasPage(all.drop(from).take(PAGE_SIZE), from + PAGE_SIZE < all.size)
    }

    private fun parseCards(d: Document): List<SManga> {
        val seen = HashSet<String>()
        return d.select("div.manga-card").mapNotNull { card ->
            val id = Regex("mview1\\.php\\?id=(\\d+)").find(card.attr("onclick"))?.groupValues?.get(1)
                ?: Regex("mview1\\.php\\?id=(\\d+)").find(card.html())?.groupValues?.get(1) ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            val img = card.selectFirst("img")
            val title = card.selectFirst("h3.manga-title")?.clone()?.apply { select(".up-icon").remove() }?.text()?.trim()
                ?.ifEmpty { null } ?: img?.attr("alt")?.trim().orEmpty()
            if (title.isEmpty()) return@mapNotNull null
            SManga.create().apply {
                url = "/mview1.php?id=$id"
                this.title = title
                thumbnail_url = (img?.absUrl("data-original")?.ifEmpty { null } ?: img?.absUrl("src"))?.takeIf { it.isNotEmpty() && !it.contains("sprite") }
            }
        }
    }

    override fun popularMangaRequest(page: Int) = GET(listUrl(odtype = "hits"), headers)
    override fun latestUpdatesRequest(page: Int) = GET(listUrl(), headers)
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList) = GET(searchUrl(query), headers)
    override fun popularMangaParse(response: Response) = MangasPage(parseCards(response.asDoc()), false)
    override fun latestUpdatesParse(response: Response) = MangasPage(parseCards(response.asDoc()), false)
    override fun searchMangaParse(response: Response) = MangasPage(parseCards(response.asDoc()), false)

    // ---------- 인기/최신 탭 규칙 ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: listPage(listUrl(odtype = "hits"), page, "")

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: listPage(listUrl(), page, "")

    private fun urlToManga(u: okhttp3.HttpUrl): String? =
        u.queryParameter("id")?.takeIf { u.encodedPath.endsWith("mview1.php") && it.all(Char::isDigit) }?.let { "/mview1.php?id=$it" }

    // 검색 띄어쓰기: 결과가 없으면 띄어쓰기 뺀 검색어 등으로 다시 찾음(SearchSpacing)
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> =
        SearchSpacing.wrap(page, query) { q, p -> fetchSearchMangaInner(p, q, filters) }

    private fun fetchSearchMangaInner(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        if (query.isNotBlank()) return listPage(searchUrl(query.trim()), page)
        val v = HashMap<String, String>()
        filters.forEach { f -> if (f is Pick) v[f.param] = f.pairs[f.state].second }
        return listPage(listUrl(v["sl"].orEmpty(), v["type1"].orEmpty(), v["type2"].orEmpty(), v["type3"].orEmpty(), v["odtype"].orEmpty()), page, v["sl"].orEmpty())
    }

    override fun getFilterList() = ExtStatus.prepend(
        "comictt",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어가 있으면 아래 조건은 무시 · 한 가지씩 고르는 것을 권장"),
                Pick("목록", "sl", STATES),
                Pick("장르", "type1", GENRES),
                Pick("요일", "type2", DAYS),
                Pick("초성", "type3", INITIALS),
                Pick("정렬", "odtype", SORTS),
            ),
        ),
    )

    class Pick(name: String, val param: String, val pairs: List<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray())

    // ---------- 상세 ----------
    override fun mangaDetailsRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    override fun mangaDetailsParse(response: Response): SManga {
        val d = response.asDoc()
        val path = Regex("mview1\\.php\\?id=\\d+").find(response.request.url.toString())?.value?.let { "/$it" }.orEmpty()
        return SManga.create().apply {
            title = d.selectFirst(".episode-title")?.text()?.trim()?.ifEmpty { null } ?: d.selectFirst("h1")?.text()?.trim().orEmpty()
            thumbnail_url = d.selectFirst(".episode-thumbnail img")?.let { it.absUrl("src").ifEmpty { it.absUrl("data-original") } }?.ifEmpty { null }
            description = d.selectFirst(".episode-synopsis")?.text()?.trim()
            genre = d.selectFirst(".episode-genre")?.text()?.split("/", ",", "#")?.map { it.trim() }?.filter { it.isNotEmpty() }?.joinToString(", ")
            status = when (FIN[path]) {
                true -> SManga.COMPLETED
                false -> SManga.ONGOING
                null -> SManga.UNKNOWN
            }
        }
    }

    // ---------- 회차 (작품 화면에 전부) ----------
    override fun chapterListRequest(manga: SManga) = GET(baseUrl + manga.url, headers)

    @Suppress("DEPRECATION")
    override fun fetchMangaDetails(manga: SManga): Observable<SManga> =
        super.fetchMangaDetails(manga).map { MissingNote.apply(it) { fetchChapterList(manga).toBlocking().first() } }

    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map { if (ChapterPosition.enabled(sp)) ChapterPosition.label(it, manga.title) else it }

    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }

    private class Raw(val url: String, var name: String, val date: Long, val seq: Int)

    /**
     * 사이트가 회차마다 올라온 순번(.episode-number0)을 줌 → 그 순서 그대로 (최신 → 과거).
     * 같은 회차를 다시 올린 것(이름이 같음)은 순번 큰 것 하나만 — 번호가 겹치면 앱이 하나로 합침.
     * 번호 없는 회차("시즌1 후기" 등)는 바로 앞(과거) 회차 번호 + 0.5, 0.6 … ("35.5 · 시즌1 후기"), 번외·외전 번호는 본편 기준으로 안 씀.
     */
    override fun chapterListParse(response: Response): List<SChapter> {
        val d = response.asDoc()
        val title = d.selectFirst(".episode-title")?.text()?.trim().orEmpty()
        val tKey = title.replace(Regex("\\s+"), "").lowercase()
        fun squash(v: String): String {
            var k = java.text.Normalizer.normalize(v, java.text.Normalizer.Form.NFC).replace(Regex("\\s+"), "").lowercase()
            if (tKey.isNotEmpty() && k.length > tKey.length && k.startsWith(tKey)) k = k.substring(tKey.length)
            return k
        }
        val seen = HashSet<String>()
        val raw = d.select(".episode-list li, li.episode-item").mapNotNull { li ->
            val a = li.selectFirst("a[href*=mview2.php]") ?: return@mapNotNull null
            val cid = Regex("mview2\\.php\\?id=(\\d+)").find(a.attr("href"))?.groupValues?.get(1) ?: return@mapNotNull null
            if (!seen.add(cid)) return@mapNotNull null
            val name = (li.selectFirst(".episode-number")?.text() ?: a.text()).replace(Regex("\\s+"), " ").trim()
            val date = Regex("(\\d{4}-\\d{2}-\\d{2})").find(li.selectFirst(".episode-date")?.text().orEmpty())?.groupValues?.get(1)
                ?.let { runCatching { dayFmt.parse(it)?.time }.getOrNull() } ?: 0L
            Raw("/mview2.php?id=$cid", name, date, li.selectFirst(".episode-number0")?.text()?.trim()?.toIntOrNull() ?: -1)
        }
        val useSeq = raw.size >= 2 && raw.all { it.seq >= 0 }
        val list = if (useSeq) {
            val best = HashMap<String, Raw>()
            raw.forEach { c -> val k = squash(c.name); if ((best[k]?.seq ?: -1) < c.seq) best[k] = c }
            raw.filter { best[squash(it.name)] === it }.sortedByDescending { it.seq }
        } else {
            raw
        }
        val out = ArrayList<SChapter>(list.size)
        var last = 0f
        var step = 0
        val usedNums = HashSet<Float>()
        for (c in list.asReversed()) {
            var n = c.name
            if (title.isNotEmpty() && n.startsWith(title)) n = n.substring(title.length).trim().ifEmpty { n }
            val m = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:화|話)").find(n) ?: Regex("^(\\d+(?:\\.\\d+)?)(?=\\s|$)").find(n)
            var num: Float
            if (m != null && !Regex("번외|외전").containsMatchIn(n)) {
                num = m.groupValues[1].toFloat()
                last = num
                step = 0
            } else if (m != null) {
                num = m.groupValues[1].toFloat()
            } else {
                step = (step + 1).coerceAtMost(9)
                num = Math.round((last + 0.5f + (step - 1) / 10f) * 10f) / 10f
                n = "${num.toString().removeSuffix(".0")} · $n"
            }
            // 번외·외전 번호가 본편과 겹치면 앞 번호 + 0.5 로
            if (!usedNums.add(num)) {
                step = (step + 1).coerceAtMost(9)
                num = Math.round((last + 0.5f + (step - 1) / 10f) * 10f) / 10f
                usedNums.add(num)
            }
            out.add(
                SChapter.create().apply {
                    url = c.url
                    name = n
                    chapter_number = num
                    date_upload = c.date
                },
            )
        }
        return out.asReversed()
    }

    // ---------- 이미지 ----------
    override fun pageListRequest(chapter: SChapter) = GET(baseUrl + chapter.url, headers)

    override fun pageListParse(response: Response): List<Page> {
        val d = response.asDoc()
        var urls = d.select("img[data-original]").filter { Regex("_\\d+$").containsMatchIn(it.attr("alt")) }
            .map { it.absUrl("data-original") }.filter { it.isNotEmpty() }.distinct()
        if (urls.isEmpty()) {
            urls = d.select("img[data-original]").map { it.absUrl("data-original") }.filter { it.contains("/attachment/comic/") }.distinct()
        }
        if (urls.isEmpty()) throw Exception("이미지를 찾을 수 없어요 (제목: ${d.title().take(40)})")
        return urls.mapIndexed { i, u -> Page(i, "", u) }
    }

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", "$baseUrl/").build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        private const val KEY_DOMAIN = "pref_domain_key"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"
        private const val PAGE_SIZE = 30
        private const val MARK = "fmans_"
        private const val DEFAULT = "https://comictt7.com"
        private const val FALLBACK_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        private val HOST_REGEX = Regex("^(www\\.)?comictt\\d+\\.com$")

        /** 목록에서 본 작품의 완결 여부 (작품 화면에 없어서) */
        private val FIN = ConcurrentHashMap<String, Boolean>()

        private val STATES = listOf("연재" to "", "완결" to "2")
        private val GENRES = listOf(
            "전체" to "", "성인" to "6", "드라마" to "7", "판타지" to "8", "액션" to "9", "로맨스" to "10", "일상" to "11",
            "개그" to "12", "미스터리" to "13", "순정" to "14", "스포츠" to "15", "BL" to "16", "스릴러" to "17",
            "무협" to "18", "학원" to "19", "공포" to "20", "스토리" to "21",
        )
        private val DAYS = listOf(
            "전체" to "", "월" to "54", "화" to "55", "수" to "56", "목" to "57", "금" to "58", "토·일" to "5960", "10일" to "61",
        )
        private val INITIALS = listOf(
            "전체" to "", "ㄱ" to "1", "ㄴ" to "2", "ㄷ" to "3", "ㄹ" to "4", "ㅁ" to "5", "ㅂ" to "6", "ㅅ" to "7", "ㅇ" to "8",
            "ㅈ" to "9", "ㅊ" to "10", "ㅋ" to "11", "ㅌ" to "12", "ㅍ" to "13", "ㅎ" to "14", "A-Z" to "15", "0-9" to "16",
        )
        private val SORTS = listOf("최신순" to "", "신작순" to "ctime", "인기순" to "hits")
    }
}
