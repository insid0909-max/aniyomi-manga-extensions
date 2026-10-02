package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.source.ConfigurableSource
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
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class NewXtoon : HttpSource(), ConfigurableSource {

    override val name = "뉴엑스툰"
    override val lang = "ko"
    override val supportsLatest = true

    // ---------- 설정 (도메인) ----------
    private val sp: SharedPreferences by lazy {
        val app = Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication").invoke(null) as Application
        app.getSharedPreferences("source_$id", 0)
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
    }

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .add("Referer", "$baseUrl/")

    // ---------- 목록 ----------
    private fun listRequest(page: Int, sort: String, category: String = "", status: String = ""): Request {
        val b = "$baseUrl/comics".toHttpUrl().newBuilder()
        if (sort.isNotEmpty()) b.addQueryParameter("sort", sort)
        if (category.isNotEmpty()) b.addQueryParameter("category", category)
        if (status.isNotEmpty()) b.addQueryParameter("status", status)
        if (page > 1) b.addQueryParameter("page", page.toString())
        return GET(b.build(), headers)
    }

    override fun popularMangaRequest(page: Int): Request = listRequest(page, "popular")

    override fun latestUpdatesRequest(page: Int): Request = listRequest(page, "latest")

    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        if (query.isNotBlank()) {
            val b = "$baseUrl/search".toHttpUrl().newBuilder()
                .addQueryParameter("q", query.trim())
            if (page > 1) b.addQueryParameter("page", page.toString())
            return GET(b.build(), headers)
        }
        var sort = "popular"
        var category = ""
        var status = ""
        filters.forEach { f ->
            when (f) {
                is SortFilter -> sort = f.value()
                is CategoryFilter -> category = f.value()
                is StatusFilter -> status = f.value()
                else -> {}
            }
        }
        return listRequest(page, sort, category, status)
    }

    override fun popularMangaParse(response: Response): MangasPage = parseList(response)
    override fun latestUpdatesParse(response: Response): MangasPage = parseList(response)
    override fun searchMangaParse(response: Response): MangasPage = parseList(response)

    private fun doc(response: Response): Document =
        Jsoup.parse(response.body.string(), response.request.url.toString())

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

        // 2) 나머지는 JSON 더보기 API (/comics/{id}/chapters?page=N)
        var page = document.selectFirst("[data-chapter-next-page]")
            ?.attr("data-chapter-next-page")?.toIntOrNull()
            ?: if (result.isEmpty()) 1 else 2
        var guard = 0
        while (guard++ < 300) {
            val json = fetchChapterPage(comicId, page) ?: break
            val arr = json.optJSONArray("chapters")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val id = o.optString("id")
                    if (id.isBlank() || result.containsKey(id)) continue
                    result[id] = chapter(comicId, id, o.optString("title"), o.optString("date"))
                }
            }
            if (!json.optBoolean("has_more", false)) break
            val next = json.optInt("next_page", -1)
            page = if (next > page) next else page + 1
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
                if (!it.isSuccessful) null else JSONObject(it.body.string())
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
        SortFilter(),
        CategoryFilter(),
        StatusFilter(),
    )

    private class SortFilter : PairSelect(
        "정렬",
        arrayOf("인기순" to "popular", "최신순" to "latest"),
    )

    private class CategoryFilter : PairSelect(
        "카테고리",
        arrayOf("전체" to "", "일반만화" to "일반만화", "BL·GL" to "BL·GL", "성인" to "성인"),
    )

    private class StatusFilter : PairSelect(
        "상태",
        arrayOf("전체" to "", "완결" to "완결"),
    )

    private open class PairSelect(name: String, private val pairs: Array<Pair<String, String>>) :
        Filter.Select<String>(name, pairs.map { it.first }.toTypedArray()) {
        fun value(): String = pairs[state].second
    }

    companion object {
        private const val DEFAULT_BASE_URL = "https://newxtoon1.com"
        private const val KEY_DOMAIN = "pref_domain_key"
        private val DOMAIN_REGEX = Regex("^https?://[^\\s/]+$")
        private val COMIC_PATH = Regex("^/comics/\\d+$")
        private val DATE_REGEX = Regex("\\d{4}\\.\\d{2}\\.\\d{2}")
        private val NUMBER_REGEX = Regex("\\d+(?:\\.\\d+)?")
    }
}
