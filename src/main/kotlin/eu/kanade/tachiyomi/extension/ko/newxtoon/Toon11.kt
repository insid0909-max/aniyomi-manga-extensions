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
 * 11toon (일일툰, 11toon148.com 등) 게시판 구조 (2026.10 사이트 개편 뒤)
 * - 목록: /bbs/board.php?bo_table=toon_c&tablename=인기만화 (type=upd 최신, is_over=1 완결, sca=장르, page=N)
 * - 작품: /bbs/board.php?bo_table=toons&is={작품id}&page=N (회차 100개씩), 회차: bo_table=toons&wr_id={회차id}
 * - 회차 이미지: 회차 페이지의 img_list (예비 서버 img_list_2), 검색: /bbs/ajax.search.php?search_key= (JSON)
 * - 앱 안의 작품·회차 주소는 예전 모양(/mb/content/info/{id}, /mb/content/image/{id}) 그대로 두어 서재·읽은 기록이 이어짐
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

    // 직접 넣은 주소는 바로, 더 새 주소가 확인되면 자동으로 바뀜 (DomainGuard.pick)
    override val baseUrl: String
        get() = DomainGuard.pick(runCatching { sp }.getOrNull(), KEY_DOMAIN, DEFAULT, autoDomain(), { Regex("^https?://[^\\s/]+$").matches(it) }, newerDefault = false)

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

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("User-Agent", userAgent)
        .set("Referer", "$baseUrl/")

    override val client: okhttp3.OkHttpClient = network.client.newBuilder()
        // 맨 바깥: 오류를 쉬운 말로, 그다음: 실패한 그림 한 번 더 받기
        .apply { interceptors().add(0, FriendlyErrors) }
        .apply { interceptors().add(1, ImageRetry) }
        .addInterceptor(SiteRateLimit(HOST_REGEX))
        .addInterceptor { chain -> smartIntercept(chain) }
        .addInterceptor(NoticeFollow(HOST_REGEX, MARKER))
        .build()

    private fun smartIntercept(chain: okhttp3.Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        val auto = baseHost != null && req.url.host == baseHost && autoDomain() && HOST_REGEX.matches(baseHost)

        val res = try {
            chain.proceed(req)
        } catch (e: IOException) {
            val found = if (auto) discoverDomain(baseUrl) else null
            if (found == null) throw e
            saveDomain(found)
            val f = found.toHttpUrl()
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().scheme(f.scheme).host(f.host).port(f.port).build()).build())
        }

        if (res.code == 451) {
            res.close()
            throw IOException("접근 차단됨 (HTTP 451). 확장 설정에서 도메인 주소를 확인하세요.")
        }
        val finalHost = res.request.url.host
        if (auto && finalHost != baseHost && HOST_REGEX.matches(finalHost) && hostNumber(finalHost) > 1) {
            saveDomain("${res.request.url.scheme}://$finalHost" + res.request.url.port.let { if (it == 80 || it == 443) "" else ":$it" })
        }
        return res
    }

    private val discoverLock = Any()

    @Volatile
    private var lastDiscover = 0L

    private fun hostNumber(host: String): Int =
        Regex("(?:11toon|spotv)(\\d+)").find(host)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    private val plain by lazy {
        okhttp3.OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    /** 일일툰 페이지가 실제로 열리는 주소인지 (base: "https://호스트" 또는 "http://IP:포트") */
    private fun works(base: String): Boolean = try {
        val r = Request.Builder().url("$base/").header("User-Agent", userAgent).build()
        plain.newCall(r).execute().use { res ->
            res.code == 200 && HOST_REGEX.matches(res.request.url.host) && (res.body?.string() ?: "").contains(MARKER)
        }
    } catch (e: Exception) {
        false
    }

    /**
     * 새 주소 찾기 (찾은 주소를 "https://호스트" 모양으로 돌려줌):
     * 1) 국내에서 열리는 예비 주소 2) 주소 안내 사이트(11toon1.com)에 적힌 "일일툰현재주소" 3) 지금 번호 다음 10개 (11toon149 …)
     */
    private fun discoverDomain(current: String): String? = synchronized(discoverLock) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now

        val announced = try {
            val r = Request.Builder().url(GUIDE).header("User-Agent", userAgent).build()
            plain.newCall(r).execute().use { res -> res.body?.string().orEmpty() }
                .let { body -> Regex("(?:www\\.)?(?:11toon|spotv)\\d+\\.com", RegexOption.IGNORE_CASE).findAll(body).map { it.value.lowercase() }.toList() }
                .filter { hostNumber(it) > 1 }.distinct().sortedByDescending { hostNumber(it) }
        } catch (e: Exception) {
            emptyList()
        }
        (ALTERNATES + announced.map { "https://$it" }).filter { it != current }.firstOrNull { works(it) }?.let { return it }

        val currentHost = current.toHttpUrlOrNull()?.host ?: return null
        val cur = hostNumber(currentHost)
        if (cur <= 1 || !currentHost.contains("11toon")) return null
        val www = if (currentHost.startsWith("www.")) "www." else ""
        val pool = java.util.concurrent.Executors.newFixedThreadPool(5)
        try {
            (cur + 1..cur + 10).map { "https://${www}11toon$it.com" }
                .map { base -> pool.submit<String?> { if (works(base)) base else null } }
                .mapNotNull { it.get() }.maxByOrNull { hostNumber(it) }
        } finally {
            pool.shutdown()
        }
    }

    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        ChapterPosition.addPref(screen)
        EditTextPreference(screen.context).apply {
            key = KEY_DOMAIN
            title = "도메인 주소"
            summary = "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 주소가 확인되면 자동으로 바뀜 (기본: $DEFAULT, 예비: http://91.192.107.81:6600)"
            dialogTitle = "도메인 주소"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, v ->
                Regex("^https?://[^\\s/]+$").matches((v as String).trim().trimEnd('/'))
            }
        }.also(screen::addPreference)

        SwitchPreferenceCompat(screen.context).apply {
            key = KEY_AUTO
            title = "도메인 자동 찾기"
            summary = "접속이 안 되면 예비 주소(update.spotv24.com · 91.192.107.81:6600)와 주소 안내(11toon1.com)에 적힌 주소 중 열리는 곳으로 자동 변경"
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

    private fun absolute(u: String): String = when {
        u.startsWith("http") -> u
        u.startsWith("//") -> "https:$u"
        else -> "$baseUrl/${u.removePrefix("/")}"
    }

    // 앱 안 주소는 예전 모양 그대로 (서재·읽은 기록 유지)
    private fun mangaUrl(id: String) = "/mb/content/info/$id?page=toon"

    private fun mangaId(url: String): String? =
        Regex("/content/info/(\\d+)").find(url)?.groupValues?.get(1)
            ?: Regex("[?&]is=(\\d+)").find(url)?.groupValues?.get(1)

    private fun chapterId(url: String): String? =
        Regex("/content/image/(\\d+)").find(url)?.groupValues?.get(1)
            ?: Regex("[?&]wr_id=(\\d+)").find(url)?.groupValues?.get(1)

    /** 사이트 작품 페이지 (회차 목록 page 쪽) */
    private fun sitePage(id: String, page: Int = 1) = "$baseUrl/bbs/board.php?bo_table=toons&is=$id" + if (page > 1) "&page=$page" else ""

    private fun siteViewer(cid: String) = "$baseUrl/bbs/board.php?bo_table=toons&wr_id=$cid"

    // ---------- 목록 ----------
    private val tabRules by lazy { TabRules(id) }

    override fun fetchPopularManga(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.POPULAR, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { listPage(LISTS[0].second, "", page) }

    override fun fetchLatestUpdates(page: Int): Observable<MangasPage> =
        tabRules.saved(TabRules.LATEST, getFilterList())?.let { fetchSearchManga(page, "", it) }
            ?: Observable.fromCallable { listPage(LISTS[1].second, "", page) }

    /** query: 목록 종류(tablename 등), genre: 사이트 sca 값 */
    private fun listPage(query: String, genre: String, page: Int): MangasPage {
        val url = "$baseUrl/bbs/board.php?bo_table=toon_c&$query".toHttpUrl().newBuilder()
            .apply { if (genre.isNotEmpty()) addQueryParameter("sca", genre) }
            .apply { if (page > 1) addQueryParameter("page", page.toString()) }
            .build()
        val doc = client.newCall(GET(url, headers)).execute().use { it.asDoc() }
        val mangas = parseCards(doc)
        // 다음 쪽 링크가 있을 때만 더 있음
        val hasNext = mangas.isNotEmpty() && doc.select("a[href*=page=]").any {
            Regex("[?&]page=(\\d+)").find(it.attr("href"))?.groupValues?.get(1)?.toIntOrNull()?.let { n -> n > page } == true
        }
        return MangasPage(mangas, hasNext)
    }

    /** 목록·검색 화면의 작품 카드 (li > a[href*=is=] / li[data-id][data-title]) */
    private fun parseCards(doc: Document): List<SManga> {
        val seen = HashSet<String>()
        return doc.select("li:has(.homelist-title)").mapNotNull { li ->
            val a = li.selectFirst("a[href*=is=]")
            val id = a?.let { Regex("[?&]is=(\\d+)").find(it.attr("href"))?.groupValues?.get(1) }
                ?: li.attr("data-id").takeIf { li.hasAttr("data-title") && it.all(Char::isDigit) && it.isNotEmpty() }
                ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            val title = li.selectFirst(".homelist-title span")?.let { it.attr("title").ifEmpty { it.text() } }?.trim()
                ?: li.attr("data-title").trim()
            if (title.isEmpty()) return@mapNotNull null
            val thumb = li.selectFirst(".homelist-thumb")?.let { t ->
                t.attr("data-mobile-image").ifEmpty { Regex("url\\(['\"]?([^'\")]+)").find(t.attr("style"))?.groupValues?.get(1).orEmpty() }
            }.orEmpty()
            SManga.create().apply {
                url = mangaUrl(id)
                this.title = title
                thumbnail_url = thumb.takeIf { it.isNotEmpty() }?.let { absolute(it) }?.also { rememberCover(it) } ?: coverFor(id)
            }
        }
    }

    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()

    /** 붙여 넣은 사이트 주소 → 작품 주소 (모르는 모양이면 null) */
    private fun urlToManga(u: okhttp3.HttpUrl): String? = mangaId(u.toString())?.let { mangaUrl(it) }

    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> {
        tabRules.apply(filters)
        // 작품 주소를 붙여 넣으면 그 작품을 바로 보여 줌
        UrlOpen.open(query, HOST_REGEX, ::urlToManga, ::fetchMangaDetails)?.let { return it }
        // 검색어가 없으면 필터(목록 종류·장르) 목록
        if (query.isBlank()) {
            val list = filters.filterIsInstance<ListFilter>().firstOrNull()?.state ?: 0
            val genre = filters.filterIsInstance<GenreFilter>().firstOrNull()?.state ?: 0
            return Observable.fromCallable {
                listPage(LISTS.getOrElse(list) { LISTS[0] }.second, if (genre > 0) GENRES[genre] else "", page)
            }
        }
        if (page > 1) return Observable.just(MangasPage(emptyList(), false))
        // 사이트 검색창과 같은 자동완성 검색 (JSON: list[wr_id, wr_subject, ca_name, wr_6=작가], counts=만화 개수)
        return Observable.fromCallable {
            val url = "$baseUrl/bbs/ajax.search.php".toHttpUrl().newBuilder()
                .addQueryParameter("search_key", query.trim()).build()
            val body = client.newCall(GET(url, headers)).execute().use { it.body?.string().orEmpty() }
            val json = body.indexOf('{').takeIf { it >= 0 }?.let { JSONObject(body.substring(it)) } ?: JSONObject()
            val arr = json.optJSONArray("list") ?: JSONArray()
            val comics = json.optInt("counts", arr.length())
            val mangas = (0 until minOf(arr.length(), comics)).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("wr_id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                SManga.create().apply {
                    this.url = mangaUrl(id)
                    title = o.optString("wr_subject").trim()
                    author = o.optString("wr_6").trim().ifEmpty { null }
                    genre = o.optString("ca_name").trim().ifEmpty { null }
                    thumbnail_url = coverFor(id)
                }
            }.filter { it.title.isNotEmpty() }
            MangasPage(mangas, false)
        }
    }

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request =
        throw UnsupportedOperationException()

    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    // 표지 서버 (예: //11toon8.com/data/toon_category/{id}.webp) - 목록에서 본 주소를 기억
    @Volatile
    private var coverBase = "https://11toon8.com/data/toon_category/"

    private fun coverFor(id: String) = "$coverBase$id.webp"

    private fun rememberCover(url: String?) {
        val u = url ?: return
        val i = u.indexOf("/data/toon_category/")
        if (i > 0) coverBase = u.substring(0, i) + "/data/toon_category/"
    }

    // ---------- 상세 + 회차 (작품 페이지, 회차는 100개씩 여러 쪽) ----------
    override fun mangaDetailsRequest(manga: SManga): Request =
        GET(sitePage(mangaId(manga.url) ?: throw IOException("잘못된 작품 주소")), headers)

    override fun getMangaUrl(manga: SManga): String = mangaId(manga.url)?.let { sitePage(it) } ?: (baseUrl + manga.url)

    override fun getChapterUrl(chapter: SChapter): String = chapterId(chapter.url)?.let { siteViewer(it) } ?: (baseUrl + chapter.url)

    /** "장르 : …", "분류 : 완결", "작가 : …", "소개 : …" 줄 */
    private fun infoLine(doc: Document, label: String): String? =
        doc.select(".genre-subtitle").firstOrNull { it.text().contains(label) }
            ?.nextElementSibling()?.text()?.trim()?.ifEmpty { null }

    override fun mangaDetailsParse(response: Response): SManga {
        val doc = response.asDoc()
        val id = mangaId(response.request.url.toString())
        return SManga.create().apply {
            title = doc.selectFirst(".cover-info h2.title, h2.title")?.text()?.trim().orEmpty()
            thumbnail_url = doc.selectFirst("img.banner")?.attr("src")?.takeIf { it.contains("toon_category") }?.let { absolute(it) }
                ?: id?.let { coverFor(it) }
            author = infoLine(doc, "작가")
            genre = infoLine(doc, "장르")?.split(",", "/")?.map { it.trim() }?.filter { it.isNotEmpty() }?.joinToString(", ")
            description = infoLine(doc, "소개")
            val state = infoLine(doc, "분류").orEmpty()
            status = when {
                state.contains("완결") -> SManga.COMPLETED
                state.contains("연재") -> SManga.ONGOING
                else -> SManga.UNKNOWN
            }
        }
    }

    override fun chapterListRequest(manga: SManga): Request = mangaDetailsRequest(manga)

    // 회차 순서: 본편 → 번외 → 외전 (앱의 회차 번호 정렬도 이 순서)
    override fun fetchChapterList(manga: SManga): Observable<List<SChapter>> =
        super.fetchChapterList(manga).map {
            ChapterOrder.sort(it, manga.title).let { l -> if (ChapterPosition.enabled(sp)) ChapterPosition.label(l, manga.title) else l }
        }

    private fun nfc(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFC)

    private fun parseEpisodes(doc: Document, id: String, title: String, seen: HashSet<String>): List<SChapter> =
        doc.select("#comic-episode-list button[onclick*=wr_id], .episode-list button[onclick*=wr_id]").mapNotNull { b ->
            val cid = Regex("wr_id=(\\d+)").find(b.attr("onclick"))?.groupValues?.get(1) ?: return@mapNotNull null
            if (!seen.add(cid)) return@mapNotNull null
            // 사이트가 한글을 자모로 풀어 적은 회차("열혈강호 729")도 있어 보통 한글로 모음
            val full = nfc(b.selectFirst(".episode-title")?.text()?.trim().orEmpty())
            // 사이트와 같이 회차 제목에서 작품 제목을 뺌 ("Re: 열혈강호 14권" → "Re: 14권")
            val t = nfc(title)
            val name = (if (t.isNotEmpty()) full.replace(t, "") else full)
                .replace(Regex("\\s+"), " ").trim().ifEmpty { full.ifEmpty { cid } }
            chapter(cid, id, name).apply {
                date_upload = Regex("(\\d{2})\\.(\\d{2})\\.(\\d{2})").find(b.selectFirst(".free-date")?.ownText().orEmpty())?.let { m ->
                    try {
                        synchronized(dateFmt) { dateFmt.parse("20${m.groupValues[1]}-${m.groupValues[2]}-${m.groupValues[3]}")?.time } ?: 0L
                    } catch (e: Exception) {
                        0L
                    }
                } ?: 0L
            }
        }

    override fun chapterListParse(response: Response): List<SChapter> {
        val doc = response.asDoc()
        val id = mangaId(response.request.url.toString()) ?: throw IOException("잘못된 작품 주소")
        val title = doc.selectFirst(".cover-info h2.title, h2.title")?.text()?.trim().orEmpty()
        val seen = HashSet<String>()
        val list = ArrayList(parseEpisodes(doc, id, title, seen))
        // 다음 쪽: 한 쪽에 100개씩이라 앞 쪽들이 꽉 찼을 때만, 새 회차가 나오는 동안 계속 (최대 200쪽)
        var page = 2
        while (page <= 200 && list.size >= (page - 1) * 100) {
            val more = client.newCall(GET(sitePage(id, page), headers)).execute().use { parseEpisodes(it.asDoc(), id, title, seen) }
            if (more.isEmpty()) break
            list += more
            page++
        }
        if (list.isEmpty()) throw IOException("11toon 회차 목록을 불러오지 못했습니다")
        // 사이트는 최신화가 위 (앱도 최신 → 과거)
        return list
    }

    private val dateFmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).apply {
        timeZone = java.util.TimeZone.getTimeZone("Asia/Seoul")
    }

    private fun chapter(cid: String, parent: String, name: String) = SChapter.create().apply {
        url = "/mb/content/image/$cid?page=toon&parent_id=$parent"
        this.name = name.replace(' ', ' ')
        chapter_number = Regex("(\\d+(?:\\.\\d+)?)\\s*화").find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
    }

    // ---------- 이미지: 회차 페이지의 img_list (안 되면 예비 서버 img_list_2) ----------
    override fun fetchPageList(chapter: SChapter): Observable<List<Page>> = Observable.fromCallable {
        val cid = chapterId(chapter.url) ?: throw IOException("잘못된 회차 주소")
        val referer = siteViewer(cid)
        val html = client.newCall(GET(referer, headers)).execute().use { it.body?.string().orEmpty() }
        fun list(name: String): List<String> {
            val m = Regex("var\\s+$name\\s*=\\s*(\\[[^\\]]*\\])").find(html) ?: return emptyList()
            return try {
                val arr = JSONArray(m.groupValues[1])
                (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }.map { absolute(it) }
            } catch (e: Exception) {
                emptyList()
            }
        }
        val urls = list("img_list").ifEmpty { list("img_list_2") }
        if (urls.isEmpty()) throw IOException("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)")
        urls.distinct().mapIndexed { i, u -> Page(i, referer, u) }
    }

    override fun pageListRequest(chapter: SChapter): Request = GET(getChapterUrl(chapter), headers)
    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()

    override fun imageRequest(page: Page): Request =
        GET(page.imageUrl!!, headersBuilder().set("Referer", page.url.ifEmpty { "$baseUrl/" }).build())

    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()

    // ---------- 필터 (사이트 메뉴·장르 탭과 같음, 검색어가 없을 때 사용) ----------
    private class ListFilter : Filter.Select<String>("목록", LISTS.map { it.first }.toTypedArray())
    private class GenreFilter : Filter.Select<String>("장르", GENRES)

    override fun getFilterList() = ExtStatus.prepend(
        "toon11",
        baseUrl,
        autoDomain(),
        tabRules.attach(
            FilterList(
                Filter.Header("검색어를 입력하면 필터는 무시됩니다"),
                ListFilter(),
                GenreFilter(),
            ),
        ),
    )

    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()

    private fun Response.asDoc(): Document = Jsoup.parse(body?.string().orEmpty(), request.url.toString())

    companion object {
        // 2026.10 개편 때 키를 바꿈 (옛 11toon2 · 11toon148 저장값을 쓰지 않게)
        private const val KEY_DOMAIN = "pref_domain_v2"
        private const val KEY_AUTO = "pref_auto_domain"
        private const val KEY_UA = "pref_user_agent"

        // 안내 사이트의 "현재주소"(11toon148.com 등)는 국내에서 막히는 일이 있어, 국내에서 열리는 주소를 기본·예비로 씀
        private const val DEFAULT = "https://update.spotv24.com"
        private val ALTERNATES = listOf("https://update.spotv24.com", "http://91.192.107.81:6600")
        private const val GUIDE = "https://11toon1.com/"

        // 진짜 일일툰 페이지에 있는 글자 (주소 안내 페이지와 구별)
        private const val MARKER = "bo_table=toon"
        private val HOST_REGEX = Regex("^(www\\.)?((11toon|spotv)\\d*\\.com|[a-z0-9-]+\\.spotv24\\.com|\\d{1,3}(\\.\\d{1,3}){3})$")

        /** 목록 종류 (사이트 메뉴) */
        private val LISTS = listOf(
            "인기만화" to "tablename=%EC%9D%B8%EA%B8%B0%EB%A7%8C%ED%99%94",
            "최신만화" to "type=upd&tablename=%EC%B5%9C%EC%8B%A0%EB%A7%8C%ED%99%94",
            "완결만화" to "is_over=1&tablename=%EC%99%84%EA%B2%B0%EB%A7%8C%ED%99%94",
            "매일 추천 100" to "type=today&tablename=%EB%A7%A4%EC%9D%BC%20%EC%B6%94%EC%B2%9C%20100",
        )

        /** 장르 (사이트 장르 탭의 sca 값, 0 = 전체) */
        private val GENRES = arrayOf(
            "전체", "BL", "러브코미디", "17", "판타지", "순정", "드라마", "학원", "게임", "SF", "스릴러", "먹방", "TS",
            "스포츠", "이세계", "추리", "일상", "라노벨", "백합", "시대", "애니화", "전생", "붕탁", "무협", "호러", "공포",
        )
    }
}
