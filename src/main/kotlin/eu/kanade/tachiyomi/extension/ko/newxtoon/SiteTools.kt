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
 * - 단위가 다르면 다른 묶음 ("원피스 1화" 와 "원피스 1권"), 단 번호가 본편과 안 겹치면 본편 ("12화" 와 "13")
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

    private class Key(var prefix: String, val unit: String, val num: Double, val index: Int) {
        var group = ""
    }

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
        // 묶음 = 앞부분 + 단위 ("원피스 1화" 와 "원피스 1권" 은 다른 묶음). 번외·외전은 단위 상관없이 한 묶음
        keys.forEach { it.group = if (isExtra(it.prefix)) it.prefix else it.prefix + "|" + it.unit }
        var numbered = keys.filter { it.num >= 0 && it.prefix != PROLOGUE_KEY }.groupBy { it.group }
        val main = numbered.entries
            .filter { !isExtra(it.key) }
            .maxWithOrNull(compareBy<Map.Entry<String, List<Key>>>({ it.value.size }, { -it.value.minOf { k -> k.index } }))
            ?.key
        // 앞부분이 같고 번호가 본편과 안 겹치면 단위만 빠진 본편 ("12화" 와 "13") → 본편에 합침
        if (main != null) {
            val mainPrefix = numbered.getValue(main).first().prefix
            val mainNums = numbered.getValue(main).map { it.num }.toHashSet()
            val mainMin = mainNums.minOrNull() ?: 0.0
            numbered.forEach { (g, ks) ->
                // 앞부분이 같고 번호가 안 겹치거나, 번외·외전이 아니면서 번호가 모두 본편 첫 화보다 앞이면
                // (앞쪽 몇 화만 "작품명 1화" 처럼 이름이 다른 경우) 본편
                val before = !isExtra(ks.first().prefix) && ks.all { it.num < mainMin }
                if (g != main && ((ks.first().prefix == mainPrefix && ks.none { it.num in mainNums }) || before)) {
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
        val sorted = list.indices.sortedWith(
            compareBy<Int>(
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

    // 이름 맨 앞 사이트 순번 ("0001 - 별을 품은 소드마스터 1화") 은 비교에서 뺌
    private val LEADING_SEQ = Regex("""^\d{2,}\s*[-–.:)\]]\s*""")

    private fun keyOf(rawName: String, index: Int, titleWords: List<String>): Key {
        val name = rawName.trim().replace(LEADING_SEQ, "")
        val m = UNIT_NUM.find(name) ?: ANY_NUM.find(name)
        if (m == null) {
            return if (PROLOGUE.containsMatchIn(name)) Key(PROLOGUE_KEY, "", 0.0, index) else Key("", "", -1.0, index)
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
 * 회차 이름 끝에 남은 화 수를 붙임: "51화 · 남은 102", 마지막 화는 "51화 · 마지막".
 * 읽는 화면 위쪽 제목에도 보여서 읽는 중에 몇 화 남았는지 알 수 있음. 설정에서 끌 수 있음
 * (다운로드한 회차는 이름으로 찾기 때문에, 새 화가 올라와 전체 수가 바뀌면 다운로드가 안 된 것처럼 보일 수 있음).
 */
internal object ChapterPosition {
    const val KEY = "pref_chapter_position"

    fun enabled(sp: SharedPreferences?): Boolean = try {
        sp?.getBoolean(KEY, true) ?: true
    } catch (e: Throwable) {
        true
    }

    private val LEADING_SEQ = Regex("""^\d{2,}\s*[-–.:)\]]\s*""")

    /** 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목을 뺌 */
    fun shorten(name: String, title: String): String {
        var n = name.trim().replace(LEADING_SEQ, "")
        val t = title.trim()
        if (t.isNotEmpty() && n.startsWith(t)) {
            val rest = n.substring(t.length).trimStart(' ', '-', '–', ':', '·', '.')
            if (rest.isNotEmpty()) n = rest
        }
        return n
    }

    /** list: 최신 → 과거 순서. "112화 · 남은 26", 마지막 화는 "112화 · 마지막" */
    fun label(list: List<SChapter>, title: String = ""): List<SChapter> {
        // 최신 화부터라서 순서 번호가 곧 그 뒤에 남은 화 수
        list.forEachIndexed { left, c ->
            c.name = shorten(c.name, title) + if (left == 0) " · 마지막" else " · 남은 $left"
        }
        return list
    }

    fun addPref(screen: PreferenceScreen, onChange: ((Boolean) -> Unit)? = null) {
        SwitchPreferenceCompat(screen.context).apply {
            key = KEY
            title = "회차 이름에 남은 화 표시"
            summary = "예: 51화 · 남은 102 (사이트 순번·작품 제목은 빼고 짧게). 끄면 원래 이름만 표시 (새 화가 올라오면 이름이 바뀌어, 다운로드한 회차가 안 받은 것처럼 보일 수 있음)"
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
