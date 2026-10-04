package eu.kanade.tachiyomi.extension.ko.newxtoon

import android.app.Application
import android.content.SharedPreferences
import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList
import java.net.URLDecoder
import java.net.URLEncoder

/** 필터 맨 아래의 "Popular/Latest 규칙" 선택 */
internal class TabRuleFilter : Filter.Select<String>(TabRules.RULE_NAME, TabRules.OPTIONS)

/**
 * 필터에서 고른 조건을 인기(Popular)/최신(Latest) 탭에 저장해 두고, 탭을 열 때 그 조건으로 목록을 보여줌.
 * 저장 내용은 필터 순서대로의 상태값이라, 소스의 필터 목록 끝에만 규칙 항목을 덧붙인다.
 */
internal class TabRules(private val sourceId: Long) {

    private val sp: SharedPreferences? by lazy {
        try {
            val app = Class.forName("android.app.ActivityThread")
                .getMethod("currentApplication").invoke(null) as Application
            app.getSharedPreferences("source_$sourceId", 0)
        } catch (e: Throwable) {
            null
        }
    }

    /** 소스 필터 목록 끝에 설명과 규칙 선택을 붙임 */
    fun attach(base: FilterList): FilterList {
        val extra = listOf(
            Filter.Separator(),
            Filter.Header("조건을 고른 뒤 Filter를 누르면 저장됩니다."),
            Filter.Header("현재 Popular: ${describe(POPULAR, base, "기본값 (사이트 인기 목록)")}"),
            Filter.Header("현재 Latest: ${describe(LATEST, base, "기본값 (사이트 최신 목록)")}"),
            TabRuleFilter(),
        )
        return FilterList(base.list + extra)
    }

    /** 검색(필터 적용) 때 규칙 선택값에 따라 저장/복원 */
    fun apply(filters: FilterList) {
        val rule = filters.filterIsInstance<TabRuleFilter>().firstOrNull() ?: return
        when (rule.state) {
            1 -> save(POPULAR, filters.withoutStatus())
            2 -> save(LATEST, filters.withoutStatus())
            3 -> remove(POPULAR)
            4 -> remove(LATEST)
            5 -> {
                remove(POPULAR)
                remove(LATEST)
            }
        }
    }

    /** 저장된 조건이 있으면 그 상태를 채운 필터 목록, 없으면 null */
    fun saved(key: String, fresh: FilterList): FilterList? {
        val states = load(key) ?: return null
        fresh.withoutStatus().forEachIndexed { i, f ->
            val s = states.getOrNull(i) ?: return@forEachIndexed
            try {
                when {
                    f is TabRuleFilter -> f.state = 0
                    f is Filter.Select<*> && s.startsWith("s") ->
                        s.substring(1).toIntOrNull()?.takeIf { it in f.values.indices }?.let { f.state = it }
                    f is Filter.Text && s.startsWith("t") -> f.state = URLDecoder.decode(s.substring(1), "UTF-8")
                    f is Filter.CheckBox && s.startsWith("c") -> f.state = s == "c1"
                    f is Filter.TriState && s.startsWith("r") -> s.substring(1).toIntOrNull()?.let { f.state = it }
                }
            } catch (e: Exception) {
                // 필터 구성이 바뀐 경우 해당 항목은 기본값 유지
            }
        }
        return fresh
    }

    private fun describe(key: String, base: FilterList, fallback: String): String {
        val states = load(key) ?: return fallback
        val parts = base.withoutStatus().mapIndexedNotNull { i, f ->
            val s = states.getOrNull(i) ?: return@mapIndexedNotNull null
            when {
                f is TabRuleFilter -> null
                f is Filter.Select<*> && s.startsWith("s") ->
                    s.substring(1).toIntOrNull()?.let { f.values.getOrNull(it)?.toString() }?.let { v ->
                        val label = f.name.replace(Regex("\\s*\\(.*?\\)\\s*"), "").trim()
                        if (label == "목록" || label == "정렬") v else "$label $v"
                    }
                f is Filter.Text && s.startsWith("t") ->
                    URLDecoder.decode(s.substring(1), "UTF-8").takeIf { it.isNotBlank() }?.let { "${f.name}: $it" }
                f is Filter.CheckBox && s == "c1" -> f.name
                else -> null
            }
        }
        return parts.joinToString(" / ").ifEmpty { fallback }
    }

    private fun List<Filter<*>>.withoutStatus(): List<Filter<*>> = filterNot { it is StatusItem }

    private fun save(key: String, filters: List<Filter<*>>) {
        val encoded = filters.joinToString(",") { f ->
            when (f) {
                is TabRuleFilter -> "s0"
                is Filter.Select<*> -> "s${f.state}"
                is Filter.Text -> "t" + URLEncoder.encode(f.state, "UTF-8")
                is Filter.CheckBox -> if (f.state) "c1" else "c0"
                is Filter.TriState -> "r${f.state}"
                else -> "-"
            }
        }
        try {
            sp?.edit()?.putString(key, encoded)?.apply()
        } catch (e: Throwable) {
            // 저장 실패는 무시
        }
    }

    private fun remove(key: String) {
        try {
            sp?.edit()?.remove(key)?.apply()
        } catch (e: Throwable) {
            // 무시
        }
    }

    private fun load(key: String): List<String>? = try {
        sp?.getString(key, null)?.takeIf { it.isNotEmpty() }?.split(",")
    } catch (e: Throwable) {
        null
    }

    companion object {
        const val POPULAR = "tab_rule_popular"
        const val LATEST = "tab_rule_latest"
        const val RULE_NAME = "Popular/Latest 규칙"
        val OPTIONS = arrayOf(
            "저장하지 않음 (필터 결과만 보기)",
            "현재 조건을 Popular 탭에 저장",
            "현재 조건을 Latest 탭에 저장",
            "Popular 탭을 기본값으로 복원",
            "Latest 탭을 기본값으로 복원",
            "두 탭 모두 기본값으로 복원",
        )
    }
}
