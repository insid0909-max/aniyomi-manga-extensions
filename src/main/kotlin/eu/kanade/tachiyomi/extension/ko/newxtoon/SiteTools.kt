package eu.kanade.tachiyomi.extension.ko.newxtoon

import eu.kanade.tachiyomi.source.model.MangasPage
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
