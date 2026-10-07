package eu.kanade.tachiyomi.extension.ko.newxtoon

import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import rx.Observable

/**
 * 사이트 주소(번호가 바뀌어도 같은 사이트)로 가는 요청 사이에 최소 간격을 둔다.
 * 한꺼번에 많이 요청하면 사이트가 접속을 막는(403) 것을 줄이기 위함. 그림(이미지) 요청은 제한하지 않아 읽기 속도는 그대로.
 */
internal class SiteRateLimit(private val hostRegex: Regex, private val minGapMs: Long = 350L) : Interceptor {
    private var last = 0L

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        if (hostRegex.matches(req.url.host) && !IMAGE_PATH.containsMatchIn(req.url.encodedPath)) {
            synchronized(this) {
                val wait = last + minGapMs - System.currentTimeMillis()
                if (wait > 0) Thread.sleep(wait)
                last = System.currentTimeMillis()
            }
        }
        return chain.proceed(req)
    }

    private companion object {
        val IMAGE_PATH = Regex("""\.(?:jpe?g|png|webp|gif|avif|bmp)$""", RegexOption.IGNORE_CASE)
    }
}

/**
 * 검색창에 사이트 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌. 주소 번호가 달라도 됨.
 * toMangaUrl: 붙여 넣은 주소 → 확장이 쓰는 작품 주소 (모르는 모양이면 null → 보통 검색)
 */
internal object UrlOpen {
    fun open(
        query: String,
        hostRegex: Regex,
        toMangaUrl: (HttpUrl) -> String?,
        details: (SManga) -> Observable<SManga>,
    ): Observable<MangasPage>? {
        val q = query.trim()
        if (!q.startsWith("http")) return null
        val url = q.toHttpUrlOrNull()?.takeIf { hostRegex.matches(it.host) } ?: return null
        val mangaUrl = toMangaUrl(url) ?: return null
        val manga = SManga.create().apply { this.url = mangaUrl }
        return details(manga).map { d ->
            d.url = mangaUrl
            val title = runCatching { d.title }.getOrNull()
            MangasPage(if (title.isNullOrEmpty()) emptyList() else listOf(d), false)
        }
    }
}

/**
 * 회차 순서 정리: 본편(1화 ~ 끝) → 번외(1 ~ 끝) → 외전(1 ~ 끝).
 * 사이트 순번 대신 회차 이름으로 번호를 매겨서 앱의 "회차 번호 기준" 정렬과 "소스 기준" 순서가 모두 이 순서가 되게 함.
 * - 본편: 이름의 "N화" (없으면 첫 숫자) → N
 * - 번호 없는 특별편(공지·후기 등): 본편 끝 바로 뒤, 프롤로그는 0
 * - 번외 k: 본편 끝 + 0.1 + k/1000, 외전 k: 본편 끝 + 0.5 + k/1000 (추적 사이트의 회차 수가 크게 튀지 않게 소수로)
 * 이름이 "153화 외전 …" 처럼 화 번호로 시작하면 본편으로 봄. 같은 번호끼리는 사이트 순서 유지. 결과는 최신 → 과거 순.
 */
internal object ChapterOrder {
    private val EP_NUM = Regex("""(\d+(?:\.\d+)?)\s*화""")
    private val ANY_NUM = Regex("""\d+(?:\.\d+)?""")
    private val EXTRA = Regex("""(번외|외전)\s*(?:편)?\s*(\d+)?""")
    private val PROLOGUE = Regex("""프롤로그|prologue""", RegexOption.IGNORE_CASE)

    private class Key(val group: Int, val num: Double, val index: Int)

    fun sort(list: List<SChapter>): List<SChapter> {
        if (list.size < 2) return list
        // 사이트 목록은 보통 최신 → 과거라서, 뒤에서부터가 올라온 순서
        val keys = list.mapIndexed { i, c -> keyOf(c.name, list.size - 1 - i) }
        val mainMax = keys.filter { it.group == 0 }.maxOfOrNull { it.num } ?: 0.0
        val base = kotlin.math.floor(mainMax)
        val sorted = list.indices.sortedWith(
            compareBy<Int>({ keys[it].group }, { keys[it].num }, { keys[it].index }),
        )
        var etc = 0
        sorted.forEach { i ->
            val k = keys[i]
            list[i].chapter_number = when (k.group) {
                0 -> k.num
                1 -> base + (++etc) * 0.001
                2 -> base + 0.1 + k.num * 0.001
                else -> base + 0.5 + k.num * 0.001
            }.toFloat()
        }
        return sorted.reversed().map { list[it] }
    }

    private fun keyOf(rawName: String, index: Int): Key {
        val name = rawName.trim()
        val ep = EP_NUM.find(name)
        val extra = EXTRA.find(name)
        if (extra != null && (ep == null || extra.range.first < ep.range.first)) {
            val group = if (extra.groupValues[1] == "번외") 2 else 3
            val n = extra.groupValues[2].toDoubleOrNull()
                ?: ANY_NUM.find(name, extra.range.last + 1)?.value?.toDoubleOrNull()
                ?: index.toDouble()
            return Key(group, n, index)
        }
        val n = ep?.groupValues?.get(1)?.toDoubleOrNull() ?: ANY_NUM.find(name)?.value?.toDoubleOrNull()
        if (n != null) return Key(0, n, index)
        if (PROLOGUE.containsMatchIn(name)) return Key(0, 0.0, index)
        return Key(1, index.toDouble(), index)
    }
}
