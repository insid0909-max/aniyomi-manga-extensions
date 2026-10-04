const mangayomiSources = [{
    "id": 870214007,
    "name": "토끼 소설",
    "lang": "ko",
    "baseUrl": "https://sbxh9.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 2,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "toki.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^sbxh\d+\.com$/;
const AUTO_NUM = /sbxh(\d+)/;
const NOVEL_PATH = /^\/novel\/(\d+)\/?$/;

const LISTS = [
    ["소설 (아래 정렬·장르·플랫폼 적용)", "/novel"],
    ["완결소설", "/novel-end"],
    ["소설 업데이트", "/novel/updates"],
    ["랭킹 일간", "rank:day"],
    ["랭킹 주간", "rank:week"],
    ["랭킹 월간", "rank:month"]
];
const SORTS = [["업데이트순", "new"], ["신작순", "fresh"], ["인기순", "hot"], ["조회순", "views"], ["평점순", "rating"], ["회차 많은 순", "episodes"]];
const GENRES = [["전체", ""], ["판타지", "fantasy"], ["무협", "wuxia"], ["현대", "modern"], ["로맨스", "romance"], ["로맨스 판타지", "romance_fantasy"], ["BL", "bl"], ["라노벨", "light_novel"], ["19금", "adult19"], ["기타", "etc"]];
const PLATFORMS = [["전체", ""], ["문피아", "munpia"], ["노벨피아", "novelpia"], ["카카오페이지", "kakaopage"], ["네이버 시리즈", "series"], ["리디", "ridi"], ["조아라", "joara"], ["북토끼", "booktoki"], ["직접 업로드", "user"], ["기타", "etc"]];

// 뉴토끼 소설 (sbxh##.com) - 목록·검색·작품 정보·회차 목록을 가져옴.
// 본문은 사이트가 광고 확인·캡차·암호화로 보호하므로 앱 안에서 읽지 않고, 회차를 WebView(사이트 뷰어)로 열어 읽는다.
// ---------- Popular/Latest 규칙 ----------
const TAB_RULE_NAME = "Popular/Latest 규칙";
const TAB_KEY_POPULAR = "tab_rule_popular";
const TAB_KEY_LATEST = "tab_rule_latest";
const TAB_RULE_OPTIONS = [
    "저장하지 않음 (필터 결과만 보기)",
    "현재 조건을 Popular 탭에 저장",
    "현재 조건을 Latest 탭에 저장",
    "Popular 탭을 기본값으로 복원",
    "Latest 탭을 기본값으로 복원",
    "두 탭 모두 기본값으로 복원"
];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
    }

    // ---------- 도메인: 수동 주소 > 자동으로 찾은 주소 > 기본 주소 ----------
    cleanUrl(v) {
        v = String(v || "").trim().replace(/\/+$/, "");
        return /^https?:\/\/[^\s/]+$/.test(v) ? v : "";
    }

    get base() {
        try {
            const prefs = new SharedPreferences();
            const manual = this.cleanUrl(prefs.get("domain"));
            if (manual && manual !== this.source.baseUrl) return manual;
            return this.cleanUrl(prefs.getString("auto_domain", "")) || this.source.baseUrl;
        } catch (e) {
            return this.source.baseUrl;
        }
    }

    autoOn() {
        try {
            const v = new SharedPreferences().get("auto_on");
            return v !== false && v !== "false";
        } catch (e) {
            return true;
        }
    }

    /** 요청 실패(접속 불가 / 5xx / 사이트가 아닌 곳으로 넘어감) 시 새 주소를 찾아 저장하고 같은 요청을 다시 보냄 */
    async req(url, headers) {
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        try {
            const res = await this.client.get(url, headers || {});
            const moved = res.statusCode === 200 && /t\.me\/|telegram/i.test(String(res.body || "").substring(0, 4000)) && !String(res.body || "").includes("ntk-fonts");
            if (!ours || !(res.statusCode >= 500 || moved)) return res;
            failed = res;
        } catch (e) {
            if (!ours) throw e;
            error = e;
        }
        const found = await this.discover(base);
        if (!found) {
            if (error) throw error;
            return failed;
        }
        const h = {};
        for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(found);
        return await this.client.get(found + url.substring(base.length), h);
    }

    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));

        const num = (u) => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const cur = num(current) || num(this.source.baseUrl);
        const cands = [];
        for (let i = Math.max(1, cur - 3); i <= cur + 40; i++) {
            const c = `https://sbxh${i}.com`;
            if (c !== current) cands.push(c);
        }
        const hits = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes("ntk-fonts") ? c : null;
            } catch (e) {
                return null;
            }
        }));
        const ok = hits.filter((x) => x);
        ok.sort((a, b) => num(b) - num(a));
        const found = ok[0] || null;
        if (found) prefs.setString("auto_domain", found);
        return found;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/" };
    }

    hdr() {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/" };
    }

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "").replace(/&amp;/g, "&");
    }

    async get(url) {
        const res = await this.req(url, this.hdr());
        return fixUtf8(res.body);
    }

    // ---------- 목록 ----------
    listUrl(list, page, params) {
        if (list.startsWith("rank:")) return `${this.base}/rank?kind=novel&period=${list.substring(5)}`;
        const parts = [];
        for (const k in params || {}) if (params[k]) parts.push(`${k}=${encodeURIComponent(params[k])}`);
        if (page > 1) parts.push(`page=${page}`);
        return this.base + list + (parts.length ? "?" + parts.join("&") : "");
    }

    /** 목록·랭킹·완결 페이지 공통: /novel/{번호} 로 가는 카드를 모두 모음 */
    parseList(html, paged) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a[href]")) {
            const link = this.path(a.attr("href")).replace(/[?#].*$/, "");
            if (!NOVEL_PATH.test(link) || seen[link]) continue;
            const img = a.selectFirst("img");
            const name = (a.selectFirst(".nv-title")?.text || (img ? img.attr("alt") : "") || a.selectFirst("h2")?.text || a.selectFirst("strong")?.text || "").trim();
            if (!name) continue;
            seen[link] = true;
            list.push({ name, imageUrl: img ? this.abs(img.attr("src")) : "", link });
        }
        return { list, hasNextPage: paged && list.length >= 40 };
    }

    async basePopular(page) {
        return this.parseList(await this.get(`${this.base}/rank?kind=novel`), false);
    }

    async baseLatest(page) {
        return this.parseList(await this.get(this.listUrl("/novel", page, {})), true);
    }

    async baseSearch(query, page, filters) {
        let list = "/novel";
        const params = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) {
                const v = f.values[f.state].value;
                if (f.param === "list") list = v; else params[f.param] = v;
            }
        }
        if (query && query.trim()) {
            list = "/novel";
            params.q = query.trim();
        }
        if (list !== "/novel") {
            delete params.g;
            delete params.p;
        }
        if (params.sort === "new") delete params.sort;
        return this.parseList(await this.get(this.listUrl(list, page, params)), !list.startsWith("rank:"));
    }

    // ---------- 상세 + 회차 ----------
    /** "26. 10. 03." / "10/03" / "3시간 전" → 밀리초 문자열 */
    parseDate(s) {
        s = String(s || "").trim();
        let m = s.match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
        if (m) {
            const y = m[1].length === 2 ? 2000 + parseInt(m[1], 10) : parseInt(m[1], 10);
            return String(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[3], 10)) - 9 * 3600000);
        }
        m = s.match(/(\d+)\s*(분|시간|일)\s*전/);
        if (m) return String(Date.now() - parseInt(m[1], 10) * { "분": 60000, "시간": 3600000, "일": 86400000 }[m[2]]);
        return null;
    }

    async getDetail(url) {
        const detailPath = this.path(url).replace(/[?#].*$/, "");
        const nid = (detailPath.match(NOVEL_PATH) || [0, ""])[1];
        const doc = new Document(await this.get(this.abs(detailPath)));

        const chapters = [];
        const seen = {};
        let oldest = null;
        for (const li of doc.select("li.novel-ep-row")) {
            const id = li.attr("data-episode-id");
            const a = li.selectFirst("a.novel-ep-link");
            const link = a ? this.path(a.attr("href")) : (id ? `/novel/${nid}/${id}` : "");
            if (!link || seen[link]) continue;
            seen[link] = true;
            const num = li.attr("data-ep");
            const label = (li.selectFirst(".ne-num")?.text || (num ? `${num}화` : "")).trim();
            const title = (li.selectFirst(".ne-title")?.text || "").trim();
            chapters.push({ name: title ? `${label} ${title}` : label, url: link, dateUpload: this.parseDate(li.selectFirst(".ne-date")?.text) });
            if (num && id) oldest = `${num}:${id}`;
        }

        // 페이지에는 최신 회차 일부만 있고, 나머지는 사이트의 "이전 회차 더 보기"와 같은 주소로 이어서 받음
        for (let i = 0; oldest && nid && i < 80; i++) {
            let data;
            try {
                const res = await this.req(`${this.base}/api/novel/${nid}/episodes/window?direction=older&cursor=${encodeURIComponent(oldest)}`, Object.assign({ "Accept": "application/json" }, this.hdr()));
                data = JSON.parse(fixUtf8(res.body));
            } catch (e) {
                break;
            }
            if (!data || !data.ok || !Array.isArray(data.items) || !data.items.length) break;
            let added = 0;
            for (const it of data.items) {
                const link = `/novel/${nid}/${it.id}`;
                if (seen[link]) continue;
                seen[link] = true;
                added++;
                const label = it.episodeLabel || `${it.number}화`;
                chapters.push({ name: it.title ? `${label} ${it.title}` : label, url: link, dateUpload: this.parseDate(it.publishedAtLabel), _n: it.number });
            }
            const last = data.items.slice().sort((x, y) => x.number - y.number)[0];
            oldest = data.hasOlder && last ? `${last.number}:${last.id}` : null;
            if (!added) break;
        }
        chapters.forEach((c) => delete c._n);

        const img = doc.selectFirst(".nd-thumb img");
        const genre = doc.select(".hero-v2-tags a.hero-v2-tag").map((e) => e.text.trim()).filter((s) => s);
        const platform = (doc.selectFirst(".nd-platform")?.text || "").trim();
        if (platform) genre.push(platform);
        return {
            name: (doc.selectFirst(".nd-info h1")?.text || doc.selectFirst("h1")?.text || "").trim(),
            imageUrl: img ? this.abs(img.attr("src")) : "",
            author: (doc.selectFirst(".nd-meta a")?.text || "").trim(),
            description: (doc.selectFirst("p.nd-desc")?.text || "").trim(),
            genre,
            status: 5,
            link: this.abs(detailPath),
            chapters
        };
    }

    // ---------- 본문: 앱에서 읽지 않고 안내만 표시 ----------
    async getHtmlContent(name, url) {
        const link = this.abs(this.path(url));
        return `<h3>${name || ""}</h3>` +
            "<p>이 사이트는 본문을 광고 확인·캡차·암호화로 보호하고 있어서 앱 안에서는 읽을 수 없습니다.</p>" +
            "<p>읽는 방법: 작품 화면 오른쪽 위의 🌐 WebView 버튼으로 사이트를 열고 회차를 누르세요. (리더 메뉴에 WebView 버튼이 있으면 그걸 눌러도 이 회차가 바로 열립니다)</p>" +
            `<p>회차 주소: ${link}</p>`;
    }

    async cleanHtmlContent(html) {
        return html;
    }

    async getPageList(url) {
        return [];
    }

    // ---------- 필터 ----------
    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어를 넣으면 소설 전체에서 제목 검색" },
            sel("목록", "list", LISTS),
            sel("정렬", "sort", SORTS),
            sel("장르", "g", GENRES),
            sel("플랫폼", "p", PLATFORMS)
        ];
    }

    tabLoad(key) {
        try {
            const v = JSON.parse(new SharedPreferences().getString(key, "") || "null");
            return Array.isArray(v) ? v : null;
        } catch (e) {
            return null;
        }
    }

    tabStore(key, value) {
        try {
            new SharedPreferences().setString(key, value === null ? "" : JSON.stringify(value));
        } catch (e) {
            // 저장 실패는 무시
        }
    }

    /** 저장된 상태값을 새 필터 목록에 채움 (필터 구성이 바뀐 항목은 기본값 유지) */
    tabRestore(states) {
        const list = this.tabFilterList();
        list.forEach((f, i) => {
            const s = states[i];
            if (s === null || s === undefined || !f || f.name === TAB_RULE_NAME) return;
            if (f.type_name === "SelectFilter" && typeof s === "number" && s >= 0 && s < f.values.length) f.state = s;
            else if (f.type_name === "TextFilter" && typeof s === "string") f.state = s;
            else if (f.type_name === "CheckBox" && typeof s === "boolean") f.state = s;
        });
        return list;
    }

    tabDescribe(key, base, fallback) {
        const states = this.tabLoad(key);
        if (!states) return fallback;
        const parts = [];
        base.forEach((f, i) => {
            const s = states[i];
            if (!f || f.name === TAB_RULE_NAME || s === null || s === undefined) return;
            if (f.type_name === "SelectFilter" && f.values[s]) {
                const label = String(f.name || "").replace(/\s*\(.*?\)\s*/g, "").trim();
                parts.push(label === "목록" || label === "정렬" ? f.values[s].name : `${label} ${f.values[s].name}`);
            }
            else if (f.type_name === "TextFilter" && String(s).trim()) parts.push(`${f.name}: ${s}`);
            else if (f.type_name === "CheckBox" && s === true) parts.push(f.name);
        });
        return parts.join(" / ") || fallback;
    }

    async getPopular(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_POPULAR);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.basePopular(page);
    }

    async getLatestUpdates(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_LATEST);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.baseLatest(page);
    }

    async search(query, page, filters) {
        await statusRefresh(this.client);
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const list = (filters || []).filter((f) => !(f && f._status));
        const rule = list.find((f) => f && f.name === TAB_RULE_NAME);
        const r = rule ? Number(rule.state) || 0 : 0;
        if (r === 1 || r === 2) {
            const states = list.map((f) => (!f || f.name === TAB_RULE_NAME || f.state === undefined || typeof f.state === "object") ? null : f.state);
            this.tabStore(r === 1 ? TAB_KEY_POPULAR : TAB_KEY_LATEST, states);
        }
        if (r === 3 || r === 5) this.tabStore(TAB_KEY_POPULAR, null);
        if (r === 4 || r === 5) this.tabStore(TAB_KEY_LATEST, null);
        return this.baseSearch(query, page, list);
    }

    tabFilterList() {
        const base = this.baseFilterList();
        return base.concat([
            { type_name: "HeaderFilter", name: "조건을 고른 뒤 Filter를 누르면 저장됩니다." },
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (소설 랭킹)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (소설 업데이트순)")}` },
            {
                type_name: "SelectFilter", name: TAB_RULE_NAME, state: 0,
                values: TAB_RULE_OPTIONS.map((n, i) => ({ type_name: "SelectOption", name: n, value: String(i) }))
            }
        ]);
    }

    // ---------- 상태 표시 ----------
    statusBase() {
        try {
            const b = typeof this.getBaseUrl === "function" ? this.getBaseUrl() : this.base;
            // getBaseUrl 이 비동기(Promise)인 확장은 마지막 정상 주소를 씀
            if (b && typeof b.then === "function") return (this.lastGood && this.lastGood()) || this.source.baseUrl;
            return b;
        } catch (e) {
            return this.source.baseUrl;
        }
    }

    statusAuto() {
        try {
            return typeof this.autoOn === "function" ? this.autoOn() : null;
        } catch (e) {
            return null;
        }
    }

    getFilterList() {
        return statusFilters("toki", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://sbxh10.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 sbxh##.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

/** 응답에 charset 이 없으면 망가요미가 Latin-1 로 넘기므로, UTF-8 바이트로 보고 다시 풀어 줌 (이미 한글이면 그대로) */
function fixUtf8(s) {
    s = String(s || "");
    if (/[^\u0000-\u00ff]/.test(s) || !/[\u0080-\u00ff]/.test(s)) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        let n = 0;
        let cp = 0;
        if (c >= 0xc2 && c <= 0xdf) { n = 1; cp = c & 0x1f; }
        else if (c >= 0xe0 && c <= 0xef) { n = 2; cp = c & 0x0f; }
        else if (c >= 0xf0 && c <= 0xf4) { n = 3; cp = c & 0x07; }
        let ok = n > 0 && i + n < s.length;
        for (let k = 1; ok && k <= n; k++) {
            const t = s.charCodeAt(i + k);
            if ((t & 0xc0) !== 0x80) ok = false; else cp = (cp << 6) | (t & 0x3f);
        }
        if (ok) {
            out += String.fromCodePoint(cp);
            i += n;
        } else {
            out += s[i];
        }
    }
    return out;
}

function appClient(raw) {
    const media = /\.(?:m3u8|mp4|ts|m4s|jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;
    const strip = (url, headers) => {
        if (!headers || media.test(String(url || ""))) return headers || {};
        const out = {};
        for (const k in headers) if (k.toLowerCase() !== "user-agent") out[k] = headers[k];
        return out;
    };
    return {
        get: (url, headers) => raw.get(url, strip(url, headers)),
        post: (url, headers, body) => raw.post(url, strip(url, headers), body),
    };
}

// ---------- 필터 화면 맨 위 상태 표시 (주소 · 자동 찾기 · 감시 점검 결과) ----------
// 점검 결과는 저장소 감시 작업이 올리는 status.json 을 20분에 한 번 받아 두었다가 보여 준다.
const STATUS_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/monitor-state/status.json";

function statusKst(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    const d = new Date(t + 9 * 3600000).toISOString();
    return d.substring(5, 7) + "/" + d.substring(8, 10) + " " + d.substring(11, 16);
}

async function statusRefresh(client) {
    let p;
    try {
        p = new SharedPreferences();
    } catch (e) {
        return;
    }
    const last = Number(p.getString("status_at", "0")) || 0;
    if (Date.now() - last < 20 * 60000) return;
    p.setString("status_at", String(Date.now()));
    try {
        const r = await client.get(STATUS_URL, {});
        const body = String(r.body || "");
        if (r.statusCode === 200 && body.trim().startsWith("{")) p.setString("status_json", body);
    } catch (e) {
        // 다음 기회에 다시 받음
    }
}

function statusFilters(key, base, autoOn) {
    const host = String(base || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const lines = [`📡 주소: ${host}` + (autoOn === null || autoOn === undefined ? "" : ` · 자동 찾기 ${autoOn ? "켜짐" : "꺼짐"}`)];
    let item = null;
    try {
        item = (JSON.parse(new SharedPreferences().getString("status_json", "") || "{}").items || {})[key] || null;
    } catch (e) {
        item = null;
    }
    if (!item || item.ok === undefined) lines.push("🩺 점검: 정보 없음 (목록을 한 번 연 뒤 필터를 다시 열면 표시)");
    else if (item.ok) lines.push(`🩺 점검: 정상 · ${statusKst(item.checkedAt)}`);
    else lines.push(`❌ 점검: 문제 · ${statusKst(item.checkedAt)} · ${String(item.msg || "").substring(0, 40)}`);
    lines.push("🛡 Cloudflare에 막히면: 웹뷰 버튼으로 한 번 열어 통과");
    return lines.map((name) => ({ type_name: "HeaderFilter", name, _status: true }));
}
