package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.content.SharedPreferences
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import rx.Observable
import kotlin.math.abs

/**
 * 사이트 주소(번호가 바뀌어도 같은 사이트)로 가는 요청 사이에 최소 간격을 둔다.
 * 한꺼번에 많이 요청하면 사이트가 접속을 막는(403) 것을 줄이기 위함. 그림(이미지) 요청은 제한하지 않아 읽기 속도는 그대로.
 * skipPath: 간격 없이 보내도 되는 요청 경로 (newxtoon 회차 목록 20개씩 묶음: 17개 동시 요청도 모두 200, 1.2초 ↔ 차례로 15초)
 */
internal class SiteRateLimit(
    private val hostRegex: Regex,
    private val minGapMs: Long = 350L,
    private val skipPath: Regex? = null,
) : Interceptor {
    private var last = 0L

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val skip = skipPath?.matches(req.url.encodedPath) == true
        if (!skip && hostRegex.matches(req.url.host) && !IMAGE_PATH.containsMatchIn(req.url.encodedPath)) {
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
 * - 단위가 다르면 다른 묶음 ("원피스 1화" 와 "원피스 1권"), 단 번호가 본편과 안 겹치면 본편 ("12화" 와 "13")
 * - "(ONE PIECE)원피스 775화" 와 "1194화" 처럼 제목만 다른 것은 같은 묶음 (작품 제목·제목 단어를 지우고 비교), "제62화" 의 "제" 도 무시
 * - 앞부분이 다른 앞부분으로 끝나면 같은 묶음 ("스핀오프 - 식극의 상디 3화" 와 "식극의 상디 2-1화")
 * - 회차가 가장 많은 묶음이 본편 → 맨 앞 (번호 그대로: "N화"/"N권"/"N호", "6-1화"는 6.01, "1.5화"는 1.5)
 * - 그다음 번호 없는 특별편(후기 등), 다른 묶음들(처음 올라온 순서), 번외 묶음, 외전 묶음 순. 프롤로그는 맨 앞
 * - 본편 뒤 회차 번호는 본편 마지막 번호 + 0.001씩 (앱의 "회차 번호 기준" 정렬도 이 순서, 추적 사이트 회차 수도 크게 안 튐)
 * "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편. 같은 번호끼리는 사이트 순서 유지. 결과는 최신 → 과거 순.
 * - "시즌2 1화" 처럼 시즌 표시가 있으면 시즌 순서가 먼저: 표시 없는 회차(시즌1) → 시즌2 → 시즌3 …, 본편은 시즌1 안에서 고름
 */
internal object ChapterOrder {
    // "1~5화" 처럼 여러 화를 묶은 회차는 첫 화 번호
    private val UNIT_NUM = Regex("""(\d+)(?:\s*([-.])\s*(\d+))?(?:\s*[~～]\s*\d+)?\s*(화|권|호|부|話)""")
    private val ANY_NUM = Regex("""(\d+)(?:\s*([-.])\s*(\d+))?""")
    private val PROLOGUE = Regex("""프롤로그|prologue""", RegexOption.IGNORE_CASE)
    private val WORD = Regex("""[\p{L}\p{N}]+""")
    private const val PROLOGUE_KEY = "\u0000prologue"
    private val SEASON = Regex("""(?:시즌|season)(\d+)$|(\d+)부$""")

    /** 앞부분 끝의 "시즌N"·"N부" → N (없으면 1) */
    private fun seasonOf(prefix: String): Int =
        SEASON.find(prefix)?.groupValues?.let { it[1].ifEmpty { it[2] } }?.toIntOrNull() ?: 1

    private class Key(var prefix: String, var unit: String, var num: Double, val index: Int) {
        var group = ""
    }

    private fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

    private fun isExtra(prefix: String) = prefix.contains("번외") || prefix.contains("외전")

    private val SPACES = Regex("""\s+""")

    /**
     * 이름이 똑같은 회차(사이트에 같은 화가 여러 번 올라온 것, 11toon 주술회전)는 가장 최근 업로드 하나만 (keep 은 항상 남김).
     * 빈칸과 맨 앞 작품 제목은 빼고 비교 ("검술명가 막내아들135화" 와 다시 올린 "135화" 는 같은 회차, newxtoon).
     * keepOldest: 가장 먼저 올라온 것을 남김 (newxtoon 은 다시 올린 회차 그림이 404 라 원래 회차를 남김)
     */
    private val SEQ_DASH = Regex("""^\s*(\d{2,})\s+-\s+""")
    private val EP_HWA = Regex("""(\d+)\s*화""")

    // 2026-11-12: 1~3화 대신 카운트다운 회차("D-2"·"D-1"·"D-DAY", 툰코 종말에서 살아남기)가 있고 본편이 그 개수만큼 늦게 시작하면
    // 본편 맨 앞 빈 번호에 D-큰 수 → D-DAY 차례로 넣음
    private val COUNTDOWN = Regex("""^D\s*-\s*(\d+|DAY)$""", RegexOption.IGNORE_CASE)

    private fun countdownFirst(list: List<SChapter>, keys: List<Key>, title: String) {
        val t = title.trim()
        val ds = list.mapIndexedNotNull { i, c ->
            var n = c.name.trim().replaceFirst(LEADING_SEQ, "")
            if (t.isNotEmpty() && n.startsWith(t)) n = n.substring(t.length).trim()
            COUNTDOWN.matchEntire(n)?.let { m -> i to (if (m.groupValues[1].equals("DAY", true)) 0 else m.groupValues[1].toInt()) }
        }.sortedByDescending { it.second }
        if (ds.isEmpty() || ds.map { it.second }.toSet().size != ds.size) return
        val first = keys.filter { it.prefix.isEmpty() && it.unit == "화" && it.num >= 1 }.minOfOrNull { it.num } ?: return
        if (first <= ds.size) return
        ds.forEachIndexed { j, (i, _) ->
            keys[i].prefix = ""
            keys[i].unit = "화"
            keys[i].num = first - ds.size + j
        }
    }

    private fun dedupe(list: List<SChapter>, keep: Set<Int>, title: String, keepOldest: Boolean): List<SChapter> {
        fun squash(v: String) = java.text.Normalizer.normalize(v, java.text.Normalizer.Form.NFC).replace(SPACES, "").lowercase()
        val t = squash(title)
        val best = HashMap<String, Int>()
        list.forEachIndexed { i, c ->
            if (i in keep) return@forEachIndexed
            var k = squash(c.name)
            if (t.isNotEmpty() && k.length > t.length && k.startsWith(t)) k = k.substring(t.length).trimStart('-', '–', ':', '·', '.', '_')
            // 2026-11-11: 사이트 순번과 회차 번호가 같으면 이름이 달라도 같은 회차를 다시 올린 것 ("0234 - 취사병 전설이 되다 234화" ↔ "0234 - 234화 ： 외전4화")
            SEQ_DASH.find(c.name)?.let { sq ->
                val nm = EP_HWA.find(c.name.substring(sq.value.length))
                if (nm != null && sq.groupValues[1].toInt() == nm.groupValues[1].toInt()) k = "#${nm.groupValues[1].toInt()}화"
            }
            val j = best[k]
            if (j == null || (if (keepOldest) c.date_upload < list[j].date_upload else c.date_upload > list[j].date_upload)) best[k] = i
        }
        val kept = best.values.toHashSet() + keep
        if (kept.size == list.size) return list
        return list.filterIndexed { i, _ -> i in kept }
    }

    /**
     * 앞뒤 회차와 동떨어진 번호는 사이트가 잘못 적은 것 ("2화" 옆 "56화" 가 실제 1화, 늑대닷컴 무직전생):
     * 앞뒤 번호가 서로 가깝고(2 이하) 이 회차 번호는 둘과 10 넘게 차이 나며, 그 사이(맨 끝이면 바로 옆)에
     * 아무도 쓰지 않은 번호가 있으면 그 번호로 바로잡음. 위치 → 새 번호
     */
    private fun misplaced(keys: List<Key>): Map<Int, Double> {
        // 같은 단위 번호끼리만 봄 ("번외1" 의 1 은 "1화" 와 다름)
        val used = keys.filter { it.num >= 0 }.map { it.unit to it.num }.toHashSet()
        val out = HashMap<Int, Double>()
        val idx = keys.indices.filter { keys[it].num >= 0 && keys[it].prefix != PROLOGUE_KEY }
        idx.forEachIndexed { p, i ->
            val k = keys[i]
            val a = idx.getOrNull(p - 1)?.let { keys[it] }?.takeIf { it.unit == k.unit }
            val b = idx.getOrNull(p + 1)?.let { keys[it] }?.takeIf { it.unit == k.unit }
            if (a == null && b == null) return@forEachIndexed
            if (listOfNotNull(a, b).any { abs(it.num - k.num) <= 10 }) return@forEachIndexed
            val cand = when {
                a != null && b != null -> {
                    if (abs(a.num - b.num) > 2) return@forEachIndexed
                    (minOf(a.num, b.num).toInt() + 1 until maxOf(a.num, b.num).toInt()).map { it.toDouble() }
                }
                // 맨 끝: 목록은 최신 → 과거라서 앞(a)만 있으면 가장 오래된 회차 → 한 번호 작게
                a != null -> listOf(a.num - 1)
                else -> listOf(b!!.num + 1)
            }.firstOrNull { it >= 0 && (k.unit to it) !in used } ?: return@forEachIndexed
            used += k.unit to cand
            out[i] = cand
        }
        return out
    }

    fun sort(input: List<SChapter>, title: String = "", keepOldest: Boolean = false): List<SChapter> {
        if (input.size < 2) return input
        // 작품 제목 단어("원피스", "one", "piece")는 앞부분에서 지우고 비교
        // 제목 전체를 먼저 지움 ("시아버지가 다 따먹음 10화" 의 한 글자 단어 "다" 도 지워지게)
        val titleWords = (listOf(norm(title)) + WORD.findAll(title.lowercase()).map { it.value }.filter { it.length >= 2 })
            .filter { it.isNotEmpty() }.distinct().sortedByDescending { it.length }
        // 잘못 적힌 번호를 먼저 찾아 두고(중복 정리에서 지워지지 않게), 이름이 똑같은 회차를 정리
        val parts = partNumbers(input)
        val fixed = misplaced(input.mapIndexed { i, c -> keyOf(c.name, input.size - 1 - i, titleWords, title, parts) })
        val fixedNum = java.util.IdentityHashMap<SChapter, Double>().apply { fixed.forEach { (i, n) -> put(input[i], n) } }
        val list = dedupe(input, fixed.keys, title, keepOldest)
        if (list.size < 2) return list
        // 사이트 목록은 보통 최신 → 과거라서, 뒤에서부터가 올라온 순서
        val keys = list.mapIndexed { i, c -> keyOf(c.name, list.size - 1 - i, titleWords, title, parts).also { k -> fixedNum[c]?.let { k.num = it } } }
        countdownFirst(list, keys, title)
        mergePrefixes(keys)
        fillUnnumbered(keys)
        fillMislabeledExtras(keys)
        // 묶음 = 앞부분 + 단위 ("원피스 1화" 와 "원피스 1권" 은 다른 묶음). 번외·외전은 단위 상관없이 한 묶음
        keys.forEach { it.group = if (isExtra(it.prefix)) it.prefix else it.prefix + "|" + it.unit }
        var numbered = keys.filter { it.num >= 0 && it.prefix != PROLOGUE_KEY }.groupBy { it.group }
        // 시즌 표시가 있으면 본편은 가장 앞 시즌(보통 표시 없는 시즌1) 묶음 중에서 고름
        val firstSeason = numbered.values.filter { !isExtra(it.first().prefix) }.minOfOrNull { seasonOf(it.first().prefix) } ?: 1
        val main = numbered.entries
            .filter { !isExtra(it.key) && seasonOf(it.value.first().prefix) == firstSeason }
            .maxWithOrNull(compareBy<Map.Entry<String, List<Key>>>({ it.value.size }, { -it.value.minOf { k -> k.index } }))
            ?.key
        // 앞부분이 같고 번호가 본편과 안 겹치면 단위만 빠진 본편 ("12화" 와 "13") → 본편에 합침
        if (main != null) {
            val mainPrefix = numbered.getValue(main).first().prefix
            val mainNums = numbered.getValue(main).map { it.num }.toHashSet()
            val mainMax = mainNums.maxOrNull() ?: 0.0
            val mainSeason = seasonOf(mainPrefix)
            val mainUnit = numbered.getValue(main).first().unit
            numbered.forEach { (g, ks) ->
                // 앞부분이 같고 번호가 안 겹치거나, 번외·외전이 아니면서 번호가 모두 본편의 빈 번호면 본편
                // (앞쪽 몇 화만 "작품명 1화" 처럼 이름이 다르거나, "화화화작품명 21화" 처럼 사이트가 잘못 적은 경우)
                // 단위가 다르면("1부 01권" 과 "66화") 번호가 비어 있어도 다른 묶음
                val sameUnit = ks.first().unit == mainUnit
                // 2026-11-11: 본편 마지막 번호 바로 다음(+2까지)인 그냥 "N화"도(SSS급 자살헌터 "151화") 본편 — 더 크면 다른 묶음
                val before = sameUnit && !isExtra(ks.first().prefix) && ks.all { it.num !in mainNums && (it.num < mainMax || (ks.first().prefix.isEmpty() && it.num <= mainMax + 2)) } &&
                    seasonOf(ks.first().prefix) == seasonOf(mainPrefix)
                // 다음 시즌·부가 본편 번호를 이어 가면 ("64화" 다음 "2부 65화") 본편
                val after = sameUnit && !isExtra(ks.first().prefix) && seasonOf(ks.first().prefix) > mainSeason &&
                    ks.all { it.num > mainMax }
                if (g != main && ((ks.first().prefix == mainPrefix && ks.none { it.num in mainNums }) || before || after)) {
                    ks.forEach { it.group = main }
                }
            }
            numbered = keys.filter { it.num >= 0 && it.prefix != PROLOGUE_KEY }.groupBy { it.group }
        }
        val firstSeen = numbered.mapValues { e -> e.value.minOf { it.index } }
        fun rank(k: Key): Int = when {
            k.prefix == PROLOGUE_KEY -> -1
            k.num < 0 -> 1
            k.group == main -> 0
            k.prefix.contains("번외") -> 3
            k.prefix.contains("외전") -> 4
            else -> 2
        }
        val seasons = keys.any { it.num >= 0 && !isExtra(it.prefix) && seasonOf(it.prefix) > firstSeason }
        // 2026-11-11: 본편 번호의 빈칸 수가 그 사이에 끼어 올라온 다른 회차(외전 등) 수와 거의 같으면 사이트가 그 회차까지 세어 본편 번호를 매긴 것
        // (블랙툰 애늙은이: 128화 뒤 외전 16개 다음 "144화") → 아래 시즌 작품처럼 사이트 순서 그대로 차례 번호
        val interleaved = main != null && run {
            val mk = keys.filter { it.group == main && it.num >= 0 }
            if (mk.size < 10) return@run false
            val nums = mk.map { kotlin.math.floor(it.num).toInt() }.toHashSet()
            val gaps = (nums.min()..nums.max()).count { it !in nums }
            val a = mk.minOf { it.index }
            val b = mk.maxOf { it.index }
            val inside = keys.count { it.group != main && it.prefix != PROLOGUE_KEY && it.index > a && it.index < b }
            gaps >= 3 && inside >= 3 && kotlin.math.abs(gaps - inside) <= maxOf(2, Math.round(gaps * 0.1).toInt())
        }
        if (seasons || interleaved) {
            // 시즌마다 번호가 다시 시작하고, 사이트가 시즌 표시를 빼먹거나 이어 붙인 번호를 쓰기도 함
            // (굿툰 닥터 최태수: 시즌2 중간이 "61화~65화", 시즌5 뒤가 "126화~136화" → 시즌1 뒤에 붙어 순서가 섞이고 앱이 "Missing 93")
            // → 사이트 순서(최신 → 과거) 그대로, 회차 번호는 오래된 것부터 1, 2, 3 … (2026-11-04)
            list.forEachIndexed { i, c -> c.chapter_number = (list.size - i).toFloat() }
            return list
        }

        // 시즌 순서 (프롤로그는 맨 앞, 번외·외전은 모든 시즌 뒤)
        fun season(k: Key): Int = when {
            rank(k) == -1 -> Int.MIN_VALUE
            rank(k) >= 3 -> Int.MAX_VALUE
            !seasons -> 0
            else -> seasonOf(k.prefix)
        }
        val sorted = list.indices.sortedWith(
            compareBy<Int>(
                { season(keys[it]) },
                { rank(keys[it]) },
                { if (rank(keys[it]) in 2..4) firstSeen[keys[it].group] ?: 0 else 0 },
                { keys[it].num },
                { keys[it].index },
            ),
        )
        val base = keys.filter { it.group == main && it.num >= 0 }.maxOfOrNull { it.num } ?: 0.0
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

    /**
     * 번호 없는 회차("0240 - 환골탈태 마지막화")가 앞뒤 회차(올라온 순서) 번호 사이의 빈 번호 하나에 딱 맞으면 그 번호
     * (환골탈태: 239화 · 마지막화 · 241화 → 240화. 전엔 번호 없는 회차라 뒤로 빠져 앱이 "Missing 1", 2026-11-04)
     */
    private fun fillUnnumbered(keys: List<Key>) {
        val used = keys.filter { it.num >= 0 }.map { it.unit to it.num }.toHashSet()
        val byTime = keys.sortedBy { it.index }
        byTime.forEachIndexed { p, k ->
            if (k.num >= 0 || k.prefix == PROLOGUE_KEY) return@forEachIndexed
            val a = byTime.getOrNull(p - 1)?.takeIf { it.num >= 0 && it.prefix != PROLOGUE_KEY } ?: return@forEachIndexed
            val b = byTime.getOrNull(p + 1)
                ?.takeIf { it.num >= 0 && it.prefix != PROLOGUE_KEY && it.prefix == a.prefix && it.unit == a.unit } ?: return@forEachIndexed
            if (a.num % 1.0 != 0.0 || b.num - a.num != 2.0) return@forEachIndexed
            val mid = a.num + 1
            if ((a.unit to mid) in used) return@forEachIndexed
            k.prefix = a.prefix
            k.unit = a.unit
            k.num = mid
            used += a.unit to mid
        }
    }

    /**
     * 본편 사이에 끼어 있는 "외전" 묶음이 그 자리의 빈 번호 수와 딱 맞으면 사이트가 잘못 적은 본편
     * (굿툰 4000년 만에 귀환한 대마도사: 207화 · 외전 8화~11화 · 212화, 외전 1~7화는 없음 → 208~211화, 2026-11-04).
     * 그 외전 묶음에 다른 회차가 없을 때만 (진짜 외전은 그대로 뒤로)
     */
    private fun fillMislabeledExtras(keys: List<Key>) {
        val used = keys.filter { it.num >= 0 }.map { it.prefix to it.num }.toHashSet()
        val byTime = keys.sortedBy { it.index }
        var p = 0
        while (p < byTime.size) {
            val k = byTime[p]
            if (!isExtra(k.prefix)) {
                p++
                continue
            }
            var q = p
            while (q + 1 < byTime.size && byTime[q + 1].prefix == k.prefix) q++
            val run = byTime.subList(p, q + 1)
            val a = byTime.getOrNull(p - 1)
            val b = byTime.getOrNull(q + 1)
            val whole = keys.count { it.prefix == k.prefix } == run.size
            if (whole && a != null && b != null && a.num >= 0 && b.num >= 0 && !isExtra(a.prefix) && a.prefix != PROLOGUE_KEY &&
                a.prefix == b.prefix && a.unit == b.unit && a.num % 1.0 == 0.0 && b.num - a.num - 1 == run.size.toDouble() &&
                (1..run.size).none { (a.prefix to a.num + it) in used }
            ) {
                run.forEachIndexed { j, r ->
                    r.prefix = a.prefix
                    r.unit = a.unit
                    r.num = a.num + 1 + j
                }
            }
            p = q + 1
        }
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

    // 이름 맨 앞 사이트 순번 ("0001 - 별을 품은 소드마스터 1화") 은 비교에서 뺌. 구분 기호 앞이나 뒤에 빈칸이 있어야 순번
    // (빈칸 없는 "259.1화"·"262-2화" 는 회차 번호)
    private val LEADING_SEQ = Regex("""^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*""")
    private val BRACKETS = Regex("""\([^)]*\)|\[[^\]]*]|（[^）]*）""")
    private val LETTER = Regex("""\p{L}""")
    private val UNIT_WORD = Regex("""화|권|호|話""")
    private val DOT_NUM = Regex("""^(\d+)\.\s+(?=\S)""")
    private val DOT_SEQ = Regex("""^\d+\.\s""")
    private val UNIT_ANY = Regex("""\d+\s*(?:화|권|호|話)""")

    /**
     * 사이트 순번을 빼고, "143. 제50장. 객잔의 밤 (3)"·"나노마신 248. 제84장 …" 처럼 맨 앞 "N." 이 회차 번호인 이름
     * (뒤에 화·권·호 번호가 없을 때)은 "N화 …" 로 봄 (굿툰 나노마신: "나노마신 142화" 사이에 섞임)
     */
    private fun dotNumber(rawName: String, title: String): String {
        var name = rawName.trim()
        val seq = LEADING_SEQ.find(name)
        if (seq != null) name = name.substring(seq.value.length)
        val t = title.trim()
        val body = if (t.isNotEmpty() && name.startsWith(t)) name.substring(t.length).trim() else name
        val dot = DOT_NUM.find(body)
        return when {
            dot != null && !UNIT_ANY.containsMatchIn(body.substring(dot.value.length)) ->
                "${dot.groupValues[1]}화 ${body.substring(dot.value.length)}"
            seq != null && DOT_SEQ.containsMatchIn(seq.value) && dot == null && !UNIT_ANY.containsMatchIn(name) &&
                LETTER.containsMatchIn(name) -> "${seq.value.takeWhile { it.isDigit() }.toInt()}화 $name"
            else -> name
        }
    }

    // "LESSON 41. 인간의 왕"·"EP 12"·"Episode 3" 의 번호도 ("Chapter N" 은 영어 원판 번호라 한국판 회차와 셈이 달라 뺌 — 비밀수업 RAW Chapter 74) "N화" 와 같은 묶음으로 (검은머리 기사왕, 망가요미와 같음)
    private val EN_EP = Regex("""(?:^|[\s\-–:])(?:lesson|episode|ep)\.?\s*(\d+(?:[.-]\d+)?)(?:\s*화)?\.?(?=\s|$)""", RegexOption.IGNORE_CASE)

    // 2026-11-11: 맨 앞 "2-15화"·"3-204화" 가 부 표시인 작품(블랙툰 덴마: 1부 "N화" · 2부 "2-N화" · 3부 "3-N화") — 같은 한 자리 앞 숫자로
    // 10개 넘게, 번호가 20 넘게도 있으면 "2부 15화" 로 봄 (나눈 회차 "41-1화"·"5-2화" 는 그대로)
    private val PART_RE = Regex("""^(\d)\s*-\s*(\d+)\s*화""")

    private fun partNumbers(list: List<SChapter>): Set<String> {
        val m = HashMap<String, MutableSet<Int>>()
        list.forEach { c ->
            PART_RE.find(c.name.trim().replaceFirst(LEADING_SEQ, ""))?.let { x ->
                m.getOrPut(x.groupValues[1]) { HashSet() }.add(x.groupValues[2].toInt())
            }
        }
        return m.filter { (_, v) -> v.size >= 10 && v.max() >= 20 }.keys
    }

    private fun keyOf(rawName: String, index: Int, titleWords: List<String>, title: String = "", parts: Set<String> = emptySet()): Key {
        var name = EN_EP.replaceFirst(dotNumber(rawName, title), " $1화 ").trim()
        if (parts.isNotEmpty()) name = PART_RE.replace(name) { x -> if (x.groupValues[1] in parts) "${x.groupValues[1]}부 ${x.groupValues[2]}화" else x.value }
        // "2부 172화" 의 "2부" 는 부 표시 (뒤에 다른 단위 번호가 있으면 그것이 회차)
        val units = UNIT_NUM.findAll(name).toList()
        // 같은 단위 번호가 여러 개면 마지막 것 ("1화 222화" 는 사이트가 잘못 적은 222화, 두 번 사는 랭커).
        // 단 맨 앞 번호 뒤에 제목 글자가 있고 그 뒤에 또 번호면 맨 앞 것 ("78화 우기명의 겨울 방학 1화" 는 78화, 블랙툰 복학왕)
        // 괄호 안 번호는 덧붙인 설명이라 빼고 봄 ("143화 (외전 2화)" 는 143화, 말단 병사에서 군주까지)
        val brackets = BRACKETS.findAll(name).map { it.range }.toList()
        val chapterUnits = units.filter { u -> u.groupValues[4] != "부" && brackets.none { u.range.first in it } }
            .ifEmpty { units.filter { it.groupValues[4] != "부" } }
        val same = chapterUnits.filter { it.groupValues[4] == chapterUnits.first().groupValues[4] }
        val lead = same.size > 1 && !LETTER.containsMatchIn(name.substring(0, same.first().range.first)) &&
            LETTER.containsMatchIn(
                name.substring(same.first().range.last + 1, same.last().range.first).replace(UNIT_WORD, ""),
            )
        val m = (if (lead) same.firstOrNull() else same.lastOrNull())
            ?: units.firstOrNull() ?: ANY_NUM.find(name)
        if (m == null) {
            return if (PROLOGUE.containsMatchIn(name)) Key(PROLOGUE_KEY, "", 0.0, index) else Key("", "", -1.0, index)
        }
        // "2부 예고" 처럼 부 표시 뒤에 번호 없는 말만 있으면 그 부의 번호 없는 회차
        if (m.groupValues.getOrNull(4) == "부" && name.substring(m.range.last + 1).any { it.isLetter() }) {
            var part = norm(name.substring(0, m.range.last + 1))
            titleWords.forEach { part = part.replace(it, "") }
            return Key(part, "", -1.0, index)
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
        // "제62화" 의 "제" 는 번호 앞에 붙는 말 ("62화" 와 같은 묶음)
        prefix = prefix.removeSuffix("제")
        return Key(prefix, m.groupValues.getOrNull(4).orEmpty(), num, index)
    }
}

/** 사이트 주소 번호 다루기 (wfwf512.com → 512, www.goodtoon006.com → 6, 002.bookkor.com → 2) */
internal object DomainGuard {
    private val LAST_NUM = Regex("""(\d+)(?!.*\d)""")

    fun hostNumber(urlOrHost: String): Int {
        val host = urlOrHost.substringAfter("://").substringBefore('/').removePrefix("www.")
        return LAST_NUM.find(host.substringBeforeLast('.'))?.value?.toIntOrNull() ?: 0
    }

    /** 저장된 주소가 확장 업데이트로 바뀐 기본 주소보다 옛 번호면 기본 주소를 씀 */
    fun preferDefault(saved: String, default: String): String =
        if (hostNumber(saved) in 1 until hostNumber(default)) default else saved

    /**
     * 사이트 주소 고르기. 직접 넣은 주소(key)는 바로 씀. 자동으로 찾은 주소(key_auto)가 그보다 번호가 크면
     * (자동 찾기 켜짐일 때) 그 주소로 바꾸고 설정 칸도 고침. 직접 넣은 주소가 없으면 자동으로 찾은 주소
     * (newerDefault 면 확장 업데이트로 바뀐 기본 주소보다 옛 번호일 때 기본 주소).
     * 예전엔 두 주소를 한 칸에 저장했으므로 처음 한 번 그 값을 자동 칸으로 옮김
     */
    fun pick(
        sp: android.content.SharedPreferences?,
        key: String,
        default: String,
        autoOn: Boolean,
        valid: (String) -> Boolean,
        newerDefault: Boolean = true,
    ): String {
        sp ?: return default
        return try {
            split(sp, key)
            val manual = sp.getString(key, "")?.trim()?.trimEnd('/').orEmpty()
            val auto = sp.getString(autoKey(key), "")?.trim()?.trimEnd('/').orEmpty()
            when {
                valid(manual) && autoOn && valid(auto) && auto != manual && hostNumber(auto) > hostNumber(manual) -> {
                    sp.edit().putString(key, auto).apply()
                    auto
                }
                valid(manual) -> manual
                valid(auto) -> if (newerDefault) preferDefault(auto, default) else auto
                else -> default
            }
        } catch (e: Throwable) {
            default
        }
    }

    /** 자동으로 찾은 주소 저장 (직접 넣은 주소 칸은 pick 이 번호를 비교해 고침) */
    fun saveAuto(sp: android.content.SharedPreferences?, key: String, url: String) {
        try {
            sp?.edit()?.putString(autoKey(key), url.trim().trimEnd('/'))?.apply()
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    private fun autoKey(key: String) = "${key}_auto"

    private fun split(sp: android.content.SharedPreferences, key: String) {
        val flag = "${key}_split"
        if (sp.getBoolean(flag, false)) return
        val old = sp.getString(key, "")?.trim()?.trimEnd('/').orEmpty()
        val e = sp.edit()
        if (old.isNotEmpty() && sp.getString(autoKey(key), "").isNullOrEmpty()) e.putString(autoKey(key), old)
        e.remove(key).putBoolean(flag, true).apply()
    }
}

/**
 * 옛 주소가 끊기지 않고 "접속 주소 안내" 페이지(새 주소 링크만 있는 작은 페이지)를 보여 주는 경우,
 * 거기 적힌 더 큰 번호의 같은 사이트 주소가 진짜 사이트(marker 가 보임)면 그 주소로 같은 요청을 다시 보냄.
 * 바깥 가로채기(smartIntercept 등)가 바뀐 최종 주소를 저장하므로 다음부터는 새 주소로 바로 감.
 */
internal class NoticeFollow(private val hostRegex: Regex, private val marker: String) : Interceptor {
    private val plain by lazy {
        okhttp3.OkHttpClient.Builder()
            .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val res = chain.proceed(req)
        val host = req.url.host
        if (req.method != "GET" || res.code != 200 || !hostRegex.matches(host)) return res
        if (IMAGE_PATH.containsMatchIn(req.url.encodedPath)) return res
        // JSON·API 응답은 제외 (HTML 페이지만)
        val type = res.header("Content-Type").orEmpty()
        if (type.isNotEmpty() && !type.contains("html", ignoreCase = true)) return res
        val peek = try {
            String(res.peekBody(MAX_BYTES).bytes(), Charsets.ISO_8859_1)
        } catch (e: Exception) {
            return res
        }
        if (peek.length >= MAX_BYTES || peek.contains(marker)) return res
        if (!Regex("<html|<!doctype", RegexOption.IGNORE_CASE).containsMatchIn(peek.take(3000))) return res
        val cur = DomainGuard.hostNumber(host)
        val family = familyRegex(host) ?: return res
        val targets = family.findAll(peek).map { it.value.lowercase() }
            .filter { hostRegex.matches(it) && DomainGuard.hostNumber(it) > cur }
            .distinct().sortedByDescending { DomainGuard.hostNumber(it) }.toList()
        val ua = req.header("User-Agent")
        for (t in targets) {
            val target = listOf(t, if (host.startsWith("www.") && !t.startsWith("www.")) "www.$t" else null)
                .firstOrNull { it != null && isReal(it, ua) } ?: continue
            res.close()
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(target).build()).build())
        }
        return res
    }

    private fun isReal(host: String, ua: String?): Boolean = try {
        val b = okhttp3.Request.Builder().url("https://$host/")
        if (ua != null) b.header("User-Agent", ua)
        plain.newCall(b.build()).execute().use { r ->
            r.code == 200 && hostRegex.matches(r.request.url.host) &&
                String(r.peekBody(1_000_000).bytes(), Charsets.ISO_8859_1).contains(marker)
        }
    } catch (e: Exception) {
        false
    }

    /** "www.goodtoon006.com" → goodtoon(\d+)\.[a-z]{2,6} 처럼 번호만 바뀌는 같은 사이트 주소 모양 */
    private fun familyRegex(host: String): Regex? {
        val h = host.removePrefix("www.")
        val head = h.substringBeforeLast('.')
        val m = Regex("""(\d+)(?!.*\d)""").find(head) ?: return null
        val pre = Regex.escape(head.substring(0, m.range.first))
        val post = Regex.escape(head.substring(m.range.last + 1))
        return Regex("""(?:www\.)?$pre\d+$post\.[a-z]{2,6}""", RegexOption.IGNORE_CASE)
    }

    private companion object {
        const val MAX_BYTES = 30_000L
        val IMAGE_PATH = Regex("""\.(?:jpe?g|png|webp|gif|avif|bmp)$""", RegexOption.IGNORE_CASE)
    }
}

/**
 * 회차 이름 끝에 남은 화 수를 붙임: "51화 · 남은 102화", 마지막 화는 "51화 · 마지막".
 * 읽는 화면 위쪽 제목에도 보여서 읽는 중에 몇 화 남았는지 알 수 있음. 설정에서 끌 수 있음
 * (다운로드한 회차는 이름으로 찾기 때문에, 새 화가 올라와 전체 수가 바뀌면 다운로드가 안 된 것처럼 보일 수 있음).
 */
/**
 * 회차 이름의 번호가 믿을 수 없는 작품 ("제40장. … (1)·(2)·(3)" 과 "290화" 가 섞인 나노마신 등):
 * 이름 숫자가 사이트 순서(과거 → 최신)대로 자꾸 줄거나 겹치면 사이트 순서를 그대로 쓰고,
 * 사이트처럼 오래된 회차부터 1, 2, 3 … 번호를 매겨 이름 앞에 "107. " 으로 붙임 (두 앱 같은 이름)
 */
internal object SiteIndex {
    private val NUM = Regex("""\d+""")
    private val LEADING_SEQ = Regex("""^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*""")

    /** list: 사이트 순서 (최신 → 과거) */
    fun needed(list: List<SChapter>, title: String): Boolean {
        if (list.size < 10) return false
        val t = title.trim()
        var prev = Double.NEGATIVE_INFINITY
        var breaks = 0
        for (c in list.asReversed()) {
            var n = c.name.trim().replace(LEADING_SEQ, "")
            if (t.isNotEmpty() && n.startsWith(t)) n = n.substring(t.length)
            val v = NUM.find(n)?.value?.toDoubleOrNull() ?: continue
            if (v <= prev) breaks++
            prev = v
        }
        return breaks >= maxOf(3, list.size / 20)
    }

    /** 사이트 순서 그대로 번호를 매김 (최신 → 과거 순서 유지) */
    fun number(list: List<SChapter>): List<SChapter> {
        list.forEachIndexed { i, c -> c.chapter_number = (list.size - i).toFloat() }
        return list
    }

    /** 이름 앞에 사이트 일련번호 ("107. 제40장. …") */
    fun prefix(list: List<SChapter>): List<SChapter> {
        list.forEachIndexed { i, c -> c.name = "${list.size - i}. ${c.name}" }
        return list
    }
}

internal object ChapterPosition {
    const val KEY = "pref_chapter_position"

    fun enabled(sp: SharedPreferences?): Boolean = try {
        sp?.getBoolean(KEY, true) ?: true
    } catch (e: Throwable) {
        true
    }

    private val LEADING_SEQ = Regex("""^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*""")
    private val DOT_SEQ = Regex("""^\d+\.\s""")
    private val UNIT_ANY = Regex("""\d+\s*(?:화|권|호|話)""")

    /** 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목을 뺌 */
    fun shorten(name: String, title: String): String {
        var n = name.trim()
        // 사이트 순번은 빼되, 그 순번이 회차 번호인 이름("230. 제79장. …" 뒤에 화 번호도 숫자로 시작하지도 않음)은 둠
        LEADING_SEQ.find(n)?.let { seq ->
            val rest = n.substring(seq.value.length)
            if (!DOT_SEQ.containsMatchIn(seq.value) || rest.firstOrNull()?.isDigit() == true || UNIT_ANY.containsMatchIn(rest)) {
                n = rest
            }
        }
        // 2026-11-11: 제목 표기가 조금 달라도(끝 마침표·괄호·띄어쓰기) 글자·숫자만 맞춰 맨 앞 작품 제목을 뺌 (망가요미 titleCut 과 같음)
        // 제목이 두 번 붙은 이름("비밀수업 비밀수업 73화")도 있어 최대 3번
        for (k in 0 until 3) {
            val cut = titleCut(n, title)
            if (cut <= 0) break
            val rest = n.substring(cut).trimStart(' ', '-', '–', ':', '·', '.', '?', '!', '~', ',', ')', ']', '）', '】', '」', '』', '>')
            if (rest.isEmpty() || rest == n) break
            n = rest
        }
        return n
    }

    /** 이름 맨 앞이 작품 제목이면(글자·숫자만 비교) 제목이 끝나는 자리, 아니면 0 */
    // 2026-11-11: 사이트 오타로 작품 제목과 한 글자만 다른 이름("나 혼자만 레벌업 124화" ↔ "나 혼자만 레벨업") — 제목 4글자 이상이고 바로 뒤가 회차 번호일 때만 뗌
    private val DIGIT_NEXT = Regex("""^\s*\d""")

    private fun titleCut(name: String, title: String): Int {
        val exact = titleCutExact(name, title)
        if (exact > 0) return exact
        val t = title.filter { it.isLetterOrDigit() }.lowercase()
        if (t.length < 4) return 0
        var j = 0
        var miss = 0
        for (i in name.indices) {
            val ch = name[i]
            if (!ch.isLetterOrDigit()) continue
            if (ch.lowercaseChar() != t[j] && ++miss > 1) return 0
            j++
            if (j == t.length) return if (DIGIT_NEXT.containsMatchIn(name.substring(i + 1))) i + 1 else 0
        }
        return 0
    }

    private fun titleCutExact(name: String, title: String): Int {
        val full = titleCutOne(name, title)
        if (full > 0) return full
        // 제목 끝 덧붙임("일진녀 길들이기[탑툰]")이 회차 이름에 없으면 그 부분을 뺀 제목으로도
        val core = title.replace(Regex("""\s*[\[(【［（][^\])】］）]*[\])】］）]\s*$"""), "")
        if (core.isEmpty() || core == title) return 0
        val cut = titleCutOne(name, core)
        // 괄호 앞 제목만 맞고 바로 괄호가 이어지면("원피스(ONE PI…") 잘린 전체 제목이라 떼지 않음
        return if (cut > 0 && Regex("""^\s*[\[(【［（]""").containsMatchIn(name.substring(cut))) 0 else cut
    }

    private fun titleCutOne(name: String, title: String): Int {
        val t = title.filter { it.isLetterOrDigit() }.lowercase()
        if (t.isEmpty()) return 0
        var j = 0
        for (i in name.indices) {
            val ch = name[i]
            if (!ch.isLetterOrDigit()) continue
            if (ch.lowercaseChar() != t[j]) return 0
            j++
            if (j == t.length) return i + 1
        }
        return 0
    }

    /** list: 최신 → 과거 순서. "112화 · 남은 26화", 마지막 화는 "112화 · 마지막" */
    fun label(list: List<SChapter>, title: String = ""): List<SChapter> {
        // 최신 화부터라서 순서 번호가 곧 그 뒤에 남은 화 수
        val names = list.map { cutEllipsisTitle(shorten(it.name, title), title) }
        val commons = commonPrefixes(names)
        list.forEachIndexed { left, c ->
            var n = names[left]
            val common = commons.firstOrNull { n.startsWith(it) }
            if (common != null) {
                val rest = n.substring(common.length).trimStart(' ', '-', '–', ':', '·', '.')
                if (rest.firstOrNull()?.isDigit() == true) n = rest
            }
            c.name = n + if (left == 0) " · 마지막" else " · 남은 ${left}화"
        }
        return list
    }

    // 띄어쓰기 없이 붙은 제목("종말의 왈큐레13화")도
    private val COMMON_HEAD = Regex("""^([^\d]{2,40}?)\s*\d+(?:[.-]\d+)?\s*화""")
    private val COMMON_SKIP = Regex("""외전|번외|특별|시즌|부$|후기|공지|휴재|에필로그|프롤로그|예고|단편|완결|최종|season|ep\b""", RegexOption.IGNORE_CASE)
    private val HEAD_NUM = Regex("""^(\d+(?:[.-]\d+)?)\s*화""")

    /** 작품 제목이 다른 글자로 붙은 경우("GACHIAKUTA" ↔ "가치액터 47화") 여러 회차(3개 이상) 앞에 똑같이 붙은 글자 — 떼면 다른 회차 번호와 겹치면(애프터스토리 1~33화) null (망가요미와 같음) */
    private fun commonPrefixes(names: List<String>): List<String> {
        val cnt = HashMap<String, Int>()
        for (n in names) COMMON_HEAD.find(n)?.groupValues?.get(1)?.let { cnt[it] = (cnt[it] ?: 0) + 1 }
        // 제목 변형이 여러 가지면("종말의 왈큐레(Re…arok)"·"종말의 왈큐레") 조건에 맞는 것을 모두, 긴 것부터
        return cnt.filter { it.value >= 3 && !COMMON_SKIP.containsMatchIn(it.key) }.keys.filter { p ->
            val mine = HashSet<String>()
            val other = HashSet<String>()
            for (n in names) {
                if (n.startsWith(p)) {
                    HEAD_NUM.find(n.substring(p.length).trimStart(' ', '-', '–', ':', '·', '.'))?.let { mine.add(it.groupValues[1]) }
                } else {
                    HEAD_NUM.find(n)?.let { other.add(it.groupValues[1]) }
                }
            }
            mine.none { it in other }
        }.sortedByDescending { it.length }
    }

    /** 사이트가 긴 제목을 가운데 "…" 로 줄인 이름("샹그릴라 프론티어 …하려하다~ 13화") — 앞뒤 조각이 모두 작품 제목의 일부면 뺌 */
    private fun cutEllipsisTitle(name: String, title: String): String {
        val el = name.indexOf('…')
        val pt = title.filter { it.isLetterOrDigit() }.lowercase()
        if (el <= 0 || pt.length < 2) return name
        val before = name.substring(0, el).filter { it.isLetterOrDigit() }.lowercase()
        val m = Regex("""^([^\d]*?)\s*(?=\d)""").find(name.substring(el + 1)) ?: return name
        val after = m.groupValues[1].filter { it.isLetterOrDigit() }.lowercase()
        return if (before.length >= 2 && pt.startsWith(before) && pt.contains(after)) name.substring(el + 1 + m.value.length) else name
    }

    fun addPref(screen: PreferenceScreen, onChange: ((Boolean) -> Unit)? = null) {
        SwitchPreferenceCompat(screen.context).apply {
            key = KEY
            title = "회차 이름에 남은 화 표시"
            summary = "예: 51화 · 남은 102화 (사이트 순번·작품 제목은 빼고 짧게). 끄면 원래 이름만 표시 (새 화가 올라오면 이름이 바뀌어, 다운로드한 회차가 안 받은 것처럼 보일 수 있음)"
            setDefaultValue(true)
            if (onChange != null) {
                setOnPreferenceChangeListener { _, v ->
                    onChange(v as Boolean)
                    true
                }
            }
        }.also(screen::addPreference)
    }
}

/**
 * 그림이 한 장씩 실패해 빈칸으로 남는 것을 줄임: 그림 요청이 끊기거나(오류) 4xx·5xx·웹페이지로 오면
 * 잠깐 쉬고 한 번 더 받음 (404 는 그림이 정말 없는 것이라 다시 받지 않음)
 */
internal object ImageRetry : Interceptor {
    private val IMAGE_PATH = Regex("""\.(?:jpe?g|png|webp|gif|avif|bmp)$""", RegexOption.IGNORE_CASE)

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val isImage = req.method == "GET" &&
            (IMAGE_PATH.containsMatchIn(req.url.encodedPath) || req.header("Accept").orEmpty().startsWith("image"))
        if (!isImage) return chain.proceed(req)
        val first = try {
            chain.proceed(req)
        } catch (e: java.io.IOException) {
            Thread.sleep(800)
            return chain.proceed(req)
        }
        val bad = (first.code >= 400 && first.code != 404) ||
            (first.isSuccessful && first.header("Content-Type").orEmpty().contains("html", ignoreCase = true))
        if (!bad) return first
        first.close()
        Thread.sleep(800)
        return chain.proceed(req)
    }
}

/**
 * 오류를 쉬운 말로: 연결·시간 초과·주소 오류와 HTTP 403·429·5xx 를 무엇을 하면 되는지 알려 주는 한국어 문장으로 바꿈.
 * 맨 바깥에 끼워야 함 (client 만들 때 interceptors().add(0, FriendlyErrors)).
 * Cloudflare 확인은 앱이 "Resolve Cloudflare challenge" 버튼을 띄우므로 그대로 둠.
 */
internal object FriendlyErrors : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val res = try {
            chain.proceed(chain.request())
        } catch (e: java.io.IOException) {
            throw friendly(e)
        }
        val msg = when (res.code) {
            403 -> "사이트가 접속을 막았어요 (HTTP 403). 오른쪽 위 웹뷰로 한 번 열어 본 뒤 다시 시도해 주세요."
            429 -> "요청이 너무 많아 사이트가 잠시 막았어요 (HTTP 429). 1~2분 뒤 다시 시도해 주세요."
            in 500..599 -> "사이트가 지금 응답하지 않아요 (HTTP ${res.code}). 잠시 뒤 다시 시도해 주세요."
            else -> return res
        }
        res.close()
        throw java.io.IOException(msg)
    }

    private fun friendly(e: java.io.IOException): java.io.IOException {
        val m = e.message.orEmpty()
        if (m.contains("Cloudflare", ignoreCase = true)) return e
        val text = when (e) {
            is java.net.UnknownHostException ->
                "사이트 주소를 찾지 못했어요. ① 잠시 뒤 다시 ② 앱을 완전히 껐다 켜기 ③ 유니콘 등 DNS 앱을 쓰면 DNS 를 Google 로 ④ 주소가 바뀌었으면 검색창에 새 주소 붙여 넣기"
            is java.net.SocketTimeoutException, is java.io.InterruptedIOException ->
                "사이트 응답이 너무 늦어요 (시간 초과). 잠시 뒤 다시 시도해 주세요."
            is java.net.ConnectException, is javax.net.ssl.SSLException ->
                "사이트에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 뒤 다시 시도해 주세요."
            else -> return e
        }
        return java.io.IOException(text, e)
    }
}

/**
 * 회차가 아주 많은 작품(여러 쪽으로 나뉜 회차 목록)을 다시 열 때 빠르게: 지난번 전체 목록을 폰에 저장해 두고,
 * 첫 쪽만 받아서 예전 목록과 이어지면(첫 쪽의 가장 오래된 회차가 예전 목록에 있고, 합친 개수가 사이트의 총 화수와 같으면)
 * 나머지 쪽은 받지 않음. 안 맞으면 예전처럼 전부 받음.
 */
internal object ChapterListCache {
    // 안드로이드에서 java.io.tmpdir 는 앱의 캐시 폴더 (앱 정보에서 캐시 지우기로 함께 지워짐)
    private fun file(key: String): java.io.File {
        val hash = java.security.MessageDigest.getInstance("MD5").digest(key.toByteArray())
            .joinToString("") { "%02x".format(it) }
        val dir = java.io.File(System.getProperty("java.io.tmpdir") ?: "/tmp", "chapter_list_cache")
        dir.mkdirs()
        return java.io.File(dir, "$hash.json")
    }

    fun load(key: String): List<SChapter>? = try {
        val arr = org.json.JSONArray(file(key).readText())
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SChapter.create().apply {
                url = o.getString("u")
                name = o.getString("n")
                chapter_number = o.optDouble("c", -1.0).toFloat()
                date_upload = o.optLong("d", 0L)
            }
        }
    } catch (e: Exception) {
        null
    }

    fun save(key: String, list: List<SChapter>) {
        try {
            val arr = org.json.JSONArray()
            list.forEach { c ->
                arr.put(
                    org.json.JSONObject().put("u", c.url).put("n", c.name)
                        .put("c", c.chapter_number.toDouble()).put("d", c.date_upload),
                )
            }
            file(key).writeText(arr.toString())
        } catch (e: Exception) {
            // 저장 실패는 무시 (다음에 전부 받으면 됨)
        }
    }

    /** firstPage: 사이트 첫 쪽(최신 → 과거), total: 사이트가 알려 준 총 화수 → 이어 붙일 수 있으면 전체 목록 */
    fun merge(cached: List<SChapter>?, firstPage: List<SChapter>, total: Int): List<SChapter>? {
        if (cached == null || total <= 0 || firstPage.isEmpty()) return null
        val oldestOnPage = firstPage.last().url
        val at = cached.indexOfFirst { it.url == oldestOnPage }
        if (at < 0) return null
        val seen = firstPage.map { it.url }.toHashSet()
        val merged = firstPage + cached.drop(at + 1).filter { seen.add(it.url) }
        return merged.takeIf { it.size == total }
    }
}

/**
 * 설명 맨 위에 빠진 회차 번호 (2026-11-04): 앱은 "N화 누락" 개수만 보여 줌 → 앱이 세는 것과 같은 회차 번호(chapter_number)로
 * 가장 작은 번호 ~ 가장 큰 번호 사이 빈 번호를 찾아 "⚠️ 빠진 회차: 57화, 128화" (10개까지 + 외 N개, 절반 넘게 비면 안 씀).
 * 시즌 작품은 ChapterOrder 가 1, 2, 3 … 으로 매겨 빈 번호가 없음
 */
internal object MissingNote {
    private val RANGE = Regex("""(\d{1,5})\s*[~～]\s*(\d{1,5})\s*화""")

    fun text(chapters: List<SChapter>): String {
        val nums = chapters.map { it.chapter_number }.filter { it >= 1f && it < 20_000f }.map { it.toInt() }.toHashSet()
        // 여러 화를 묶은 회차("14~18화")는 그 범위를 모두 있는 것으로 (2026-11-11, 나 혼자 소설 속 망나니)
        chapters.forEach { c ->
            RANGE.find(c.name)?.let { r ->
                val a = r.groupValues[1].toInt()
                val b = r.groupValues[2].toInt()
                if (a == c.chapter_number.toInt() && b > a && b - a <= 50) nums.addAll(a..b)
            }
        }
        if (nums.size < 2) return ""
        val min = nums.minOrNull() ?: return ""
        val max = nums.maxOrNull() ?: return ""
        val miss = (min..max).filter { it !in nums }
        if (miss.isEmpty() || miss.size > (max - min + 1) / 2) return ""
        val shown = miss.take(10).joinToString(", ") { "${it}화" }
        return "⚠️ 빠진 회차: $shown" + (if (miss.size > 10) " 외 ${miss.size - 10}개" else "") + " (사이트에 없거나 확장이 못 받아 온 회차)"
    }

    /** 작품 정보에 빠진 회차 줄을 붙임. 회차 목록을 못 받으면 그대로 */
    fun apply(details: SManga, chapters: () -> List<SChapter>): SManga {
        val note = try {
            text(chapters())
        } catch (e: Throwable) {
            ""
        }
        if (note.isNotEmpty()) {
            val d = details.description.orEmpty()
            if (!d.startsWith("⚠️ 빠진 회차")) details.description = if (d.isBlank()) note else "$note\n\n$d"
        }
        return details
    }
}
