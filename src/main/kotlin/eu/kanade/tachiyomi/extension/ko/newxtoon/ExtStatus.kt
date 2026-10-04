package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** 상태 표시용 필터 항목 표시 (Popular/Latest 규칙 저장 위치 계산에서는 빠짐) */
internal interface StatusItem

internal class StatusHeader(text: String) : Filter.Header(text), StatusItem

internal class StatusSeparator : Filter.Separator(), StatusItem

/**
 * 필터 화면 맨 위의 현재 상태: 주소 · 자동 찾기 · 감시 점검 결과.
 * 점검 결과는 저장소 감시 작업이 올리는 status.json 을 백그라운드에서 받아 두었다가 보여 준다
 * (필터 화면을 여는 순간 네트워크를 기다리지 않음).
 */
internal object ExtStatus {
    private const val URL =
        "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/monitor-state/status.json"
    private const val PREF_JSON = "status_json"
    private const val REFRESH_MS = 20 * 60 * 1000L

    @Volatile
    private var json: JSONObject? = null

    @Volatile
    private var lastFetch = 0L

    private val sp: SharedPreferences? by lazy {
        try {
            val app = Class.forName("android.app.ActivityThread")
                .getMethod("currentApplication").invoke(null) as Application
            app.getSharedPreferences("insid_ext_status", 0)
        } catch (e: Throwable) {
            null
        }
    }

    /** 20분에 한 번만 백그라운드로 새로 받음 */
    fun refresh() {
        val now = System.currentTimeMillis()
        if (now - lastFetch < REFRESH_MS) return
        lastFetch = now
        Thread {
            try {
                val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
                client.newCall(Request.Builder().url(URL).build()).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    if (res.isSuccessful && text.trim().startsWith("{")) {
                        json = JSONObject(text)
                        sp?.edit()?.putString(PREF_JSON, text)?.apply()
                    }
                }
            } catch (e: Throwable) {
                // 다음 기회에 다시 받음
            }
        }.start()
    }

    private fun data(): JSONObject? = json ?: try {
        sp?.getString(PREF_JSON, null)?.let { JSONObject(it) }?.also { json = it }
    } catch (e: Throwable) {
        null
    }

    private fun kst(iso: String): String = try {
        val inFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val outFmt = SimpleDateFormat("MM/dd HH:mm", Locale.KOREA).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }
        outFmt.format(inFmt.parse(iso.substring(0, 19))!!)
    } catch (e: Throwable) {
        ""
    }

    fun lines(key: String, baseUrl: String, autoDomain: Boolean): List<String> {
        refresh()
        val host = baseUrl.substringAfter("://").trimEnd('/')
        val out = mutableListOf("📡 주소: $host · 자동 찾기 ${if (autoDomain) "켜짐" else "꺼짐"}")
        val item = data()?.optJSONObject("items")?.optJSONObject(key)
        if (item == null || !item.has("ok")) {
            out.add("🩺 점검: 정보 없음 (잠시 후 필터를 다시 열면 표시)")
        } else {
            val time = kst(item.optString("checkedAt"))
            out.add(
                if (item.optBoolean("ok")) {
                    "🩺 점검: 정상 · $time"
                } else {
                    "❌ 점검: 문제 · $time · ${item.optString("msg").take(40)}"
                },
            )
        }
        out.add("🛡 Cloudflare에 막히면: 메뉴 → WebView에서 열기로 한 번 통과")
        return out
    }

    /** 상태 줄을 필터 목록 맨 앞에 붙임 */
    fun prepend(key: String, baseUrl: String, autoDomain: Boolean, base: FilterList): FilterList =
        FilterList(lines(key, baseUrl, autoDomain).map { StatusHeader(it) } + StatusSeparator() + base.list)
}
