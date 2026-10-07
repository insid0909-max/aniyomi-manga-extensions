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
 * 회차 순서 정리: 이름에서 숫자 앞부분(작품 제목은 빼고)이 같은 것끼리 묶어서 번호순으로 놓음.
 * - "(ONE PIECE)원피스 775화" 와 "1194화" 처럼 제목만 다른 것은 같은 묶음 (작품 제목 단어를 지우고 비교)
 * - 앞부분이 다른 앞부분으로 끝나면 같은 묶음 ("스핀오프 - 식극의 상디 3화" 와 "식극의 상디 2-1화")
 * - 회차가 가장 많은 묶음이 본편 → 맨 앞 (번호 그대로: "N화"/"N권"/"N호", "6-1화"는 6.01, "1.5화"는 1.5)
 * - 그다음 번호 없는 특별편(후기 등), 다른 묶음들(처음 올라온 순서), 번외 묶음, 외전 묶음 순. 프롤로그는 맨 앞
 * - 본편 뒤 회차 번호는 본편 마지막 번호 + 0.001씩 (앱의 "회차 번호 기준" 정렬도 이 순서, 추적 사이트 회차 수도 크게 안 튐)
 * "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편. 같은 번호끼리는 사이트 순서 유지. 결과는 최신 → 과거 순.
 */
internal object ChapterOrder {
    private val UNIT_NUM = Regex("""(\d+)(?:\s*([-.])\s*(\d+))?\s*(화|권|호|부|話)""")
    private val ANY_NUM = Regex("""(\d+)(?:\s*([-.])\s*(\d+))?""")
    private val PROLOGUE = Regex("""프롤로그|prologue""", RegexOption.IGNORE_CASE)
    private val WORD = Regex("""[\p{L}\p{N}]+""")
    private const val PROLOGUE_KEY = "\u0000prologue"

    private class Key(var prefix: String, val num: Double, val index: Int)

    private fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

    private fun isExtra(prefix: String) = prefix.contains("번외") || prefix.contains("외전")

    fun sort(list: List<SChapter>, title: String = ""): List<SChapter> {
        if (list.size < 2) return list
        // 작품 제목 단어("원피스", "one", "piece")는 앞부분에서 지우고 비교
        val titleWords = WORD.findAll(title.lowercase()).map { it.value }.filter { it.length >= 2 }
            .sortedByDescending { it.length }.toList()
        // 사이트 목록은 보통 최신 → 과거라서, 뒤에서부터가 올라온 순서
        val keys = list.mapIndexed { i, c -> keyOf(c.name, list.size - 1 - i, titleWords) }
        mergePrefixes(keys)
        val numbered = keys.filter { it.num >= 0 && it.prefix != PROLOGUE_KEY }.groupBy { it.prefix }
        val main = numbered.entries
            .filter { !isExtra(it.key) }
            .maxWithOrNull(compareBy<Map.Entry<String, List<Key>>>({ it.value.size }, { -it.value.minOf { k -> k.index } }))
            ?.key
        val firstSeen = numbered.mapValues { e -> e.value.minOf { it.index } }
        fun rank(k: Key): Int = when {
            k.prefix == PROLOGUE_KEY -> -1
            k.num < 0 -> 1
            k.prefix == main -> 0
            k.prefix.contains("번외") -> 3
            k.prefix.contains("외전") -> 4
            else -> 2
        }
        val sorted = list.indices.sortedWith(
            compareBy<Int>(
                { rank(keys[it]) },
                { if (rank(keys[it]) in 2..4) firstSeen[keys[it].prefix] ?: 0 else 0 },
                { keys[it].num },
                { keys[it].index },
            ),
        )
        val base = keys.filter { it.prefix == main && it.num >= 0 }.maxOfOrNull { it.num } ?: 0.0
        var extra = 0
        sorted.forEach { i ->
            val k = keys[i]
            list[i].chapter_number = when (rank(k)) {
                -1 -> 0.0
                0 -> k.num
                else -> base + (++extra) * 0.001
            }.toFloat()
        }
        return sorted.reversed().map { list[it] }
    }

    /** 앞부분이 다른 앞부분으로 끝나면 같은 시리즈 ("스핀오프식극의상디" = "식극의상디"). 번외·외전끼리만 따로 */
    private fun mergePrefixes(keys: List<Key>) {
        val prefixes = keys.map { it.prefix }.filter { it.length >= 2 && it != PROLOGUE_KEY }
            .distinct().sortedBy { it.length }
        val canon = HashMap<String, String>()
        for ((i, p) in prefixes.withIndex()) {
            val shorter = prefixes.subList(0, i).firstOrNull { q ->
                q.length < p.length && p.endsWith(q) && isExtra(p) == isExtra(q)
            }
            canon[p] = shorter?.let { canon[it] ?: it } ?: p
        }
        keys.forEach { k -> canon[k.prefix]?.let { k.prefix = it } }
    }

    private fun keyOf(rawName: String, index: Int, titleWords: List<String>): Key {
        val name = rawName.trim()
        val m = UNIT_NUM.find(name) ?: ANY_NUM.find(name)
        if (m == null) {
            return if (PROLOGUE.containsMatchIn(name)) Key(PROLOGUE_KEY, 0.0, index) else Key("", -1.0, index)
        }
        val whole = m.groupValues[1].toDouble()
        val sub = m.groupValues[3]
        // "1.5화" 는 소수, "6-1화" 는 6화의 1편 → 6.01
        val num = when {
            sub.isEmpty() -> whole
            m.groupValues[2] == "." -> "${m.groupValues[1]}.$sub".toDouble()
            else -> whole + sub.toInt().coerceAtMost(99) / 100.0
        }
        var prefix = norm(name.substring(0, m.range.first))
        titleWords.forEach { prefix = prefix.replace(it, "") }
        return Key(prefix, num, index)
    }
}
