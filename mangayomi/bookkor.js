const mangayomiSources = [{
    "id": 870214008,
    "name": "북코 소설",
    "lang": "ko",
    "baseUrl": "https://002.bookkor.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 2,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.1.7",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "bookkor.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^\d+\.bookkor\.com$/;
const AUTO_NUM = /\/\/(\d+)\.bookkor/;

const LISTS = [["전체 (아래 장르·상태·정렬 적용)", ""], ["일반소설", "일반소설"], ["성인소설", "성인소설"], ["BL/GL", "BLGL"], ["완결소설", "완결소설"]];
const GENRES = ["판타지", "무협", "19금", "현대", "로맨스", "로맨스 판타지", "BL", "라노벨", "드라마", "기타"];
const STATUSES = [["전체", ""], ["연재중", "연재중"], ["완결", "완결"]];
const SORTS = [["최신", "latest"], ["북마크", "bookmark"], ["조회수", "views"], ["평점", "rating"]];

// 북코 (###.bookkor.com) - Laravel + Inertia 사이트라 페이지마다 <script data-page="app"> 에 화면 데이터(JSON)가 통째로 들어 있음.
// 목록·작품·회차 목록·본문 모두 이 JSON 에서 읽는다.
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

// ---------- 접속 속도 제한 · 주소로 바로 열기 ----------
// 사이트로 가는 요청 사이에 최소 간격 (한꺼번에 많이 요청하면 사이트가 403으로 막음). 그림 요청은 제외
let lastSiteRequest = 0;
async function siteWait(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/.exec(String(url || ""));
    if (!m || !AUTO_HOST.test(m[1]) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
    const wait = lastSiteRequest + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSiteRequest = Date.now();
}

// 검색창에 사이트 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
async function openByUrl(ext, query, toLink) {
    const m = /^https?:\/\/([^/?#]+)(\/[^#]*)?/.exec(String(query || "").trim());
    if (!m || !AUTO_HOST.test(m[1])) return null;
    const link = toLink(m[2] || "/");
    if (!link) return null;
    const d = await ext.getDetail(link);
    return { list: d && d.name ? [{ name: d.name, imageUrl: d.imageUrl || "", link }] : [], hasNextPage: false };
}

// 옛 주소가 끊기지 않고 "접속 주소 안내" 페이지(새 주소 링크만 있는 작은 페이지)를 보여 주면,
// 거기 적힌 더 큰 번호의 같은 사이트 주소 중 진짜 사이트(marker 가 보임)를 돌려줌
async function noticeTarget(ext, body, base, marker) {
    body = String(body || "");
    if (!body || body.length >= 30000 || body.indexOf(marker) >= 0) return null;
    if (!/<html|<!doctype/i.test(body.substring(0, 3000))) return null; // JSON·API 응답은 제외
    const host = base.replace(/^https?:\/\//, "");
    const h = host.replace(/^www\./, "");
    const head = h.substring(0, h.lastIndexOf("."));
    const m = /(\d+)(?!.*\d)/.exec(head);
    if (!m) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:www\\.)?${esc(head.substring(0, m.index))}\\d+${esc(head.substring(m.index + m[1].length))}\\.[a-z]{2,6}`, "gi");
    const num = (s) => {
        const x = /(\d+)(?!.*\d)/.exec(s.replace(/^www\./, "").replace(/\.[a-z]{2,6}$/i, ""));
        return x ? parseInt(x[1], 10) : 0;
    };
    const cur = parseInt(m[1], 10);
    const cands = [...new Set((body.match(re) || []).map((x) => x.toLowerCase()))]
        .filter((x) => AUTO_HOST.test(x) && num(x) > cur).sort((a, b) => num(b) - num(a));
    for (const c of cands) {
        for (const hh of host.startsWith("www.") && !c.startsWith("www.") ? [c, "www." + c] : [c]) {
            try {
                const r = await ext.client.get(`https://${hh}/`, { "User-Agent": MOBILE_UA });
                if (r.statusCode === 200 && String(r.body || "").indexOf(marker) >= 0) return `https://${hh}`;
            } catch (e) {}
        }
    }
    return null;
}

// 회차 이름 끝에 남은 화 수를 붙임 ("112화 · 남은 26", 마지막 화는 "112화 · 마지막"). list: 최신 → 과거
// 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목은 뺌. 설정 "회차 이름에 남은 화 표시"로 끌 수 있음
function chapterPosition(list, title) {
    try {
        const v = new SharedPreferences().get("chapter_position");
        if (v === false || v === "false") return list;
    } catch (e) {}
    const t = String(title || "").trim();
    return list.map((c, i) => {
        let n = String(c.name || "").trim().replace(/^\d{2,}\s*[-–.:)\]]\s*/, "");
        if (t && n.startsWith(t)) {
            const rest = n.substring(t.length).replace(/^[\s\-–:·.]+/, "");
            if (rest) n = rest;
        }
        return Object.assign({}, c, { name: n + (i === 0 ? " · 마지막" : ` · 남은 ${i}`) });
    });
}

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
            // 직접 넣은 주소는 기본 주소와 같아도 그대로 씀 (설정 기본값은 빈 칸)
            if (manual) return manual;
            // 자동으로 찾은 주소가 확장 업데이트로 바뀐 기본 주소보다 옛 번호면 기본 주소를 씀
            const auto = this.cleanUrl(prefs.getString("auto_domain", ""));
            const n = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
            return auto && n(auto) >= n(this.source.baseUrl) ? auto : this.source.baseUrl;
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

    /** 요청 실패(접속 불가 / 5xx) 시 새 주소를 찾아 저장하고 같은 요청을 다시 보냄 */
    async req(url, headers) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        let notice = null;
        try {
            const res = await this.client.get(url, headers || {});
            // 자동으로 찾은 주소가 막히면(403) 자동 주소를 지우고 기본 주소로 다시 요청
            if (ours && res.statusCode === 403 && base !== this.source.baseUrl && !this.cleanUrl(new SharedPreferences().get("domain"))) {
                new SharedPreferences().setString("auto_domain", "");
                const fb = this.source.baseUrl;
                const h = {};
                for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(fb);
                const r2 = await this.client.get(fb + url.substring(base.length), h);
                if (r2.statusCode < 400) return r2;
            }
            if (ours && res.statusCode === 200) notice = await noticeTarget(this, res.body, base, "data-page=");
            if (!notice && (!ours || !(res.statusCode >= 500))) return res;
            failed = res;
        } catch (e) {
            if (!ours) throw e;
            error = e;
        }
        const found = notice || await this.discover(base);
        if (notice) new SharedPreferences().setString("auto_domain", notice);
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
        for (let i = Math.max(1, cur - 3); i <= cur + 30; i++) {
            const c = `https://${String(i).padStart(3, "0")}.bookkor.com`;
            if (c !== current) cands.push(c);
        }
        const hits = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes("data-page=\"app\"") ? c : null;
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

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "");
    }

    /** 페이지의 <script data-page="app"> JSON (Inertia 화면 데이터) */
    async page(url) {
        const res = await this.req(url, this.hdr());
        const body = fixUtf8(res.body);
        const m = body.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/);
        if (!m) throw new Error(`페이지 데이터를 찾을 수 없습니다 (상태 ${res.statusCode})`);
        return JSON.parse(m[1]);
    }

    thumb(t) {
        if (!t) return "";
        if (/^https?:\/\//.test(t)) return t;
        return `${this.base}/storage/${String(t).replace(/^\/?(storage\/)?/, "")}`;
    }

    seg(s) {
        return encodeURIComponent(String(s || ""));
    }

    item(c) {
        return { name: c.title || "", imageUrl: this.thumb(c.thumbnail), link: "/" + this.seg(c.slug) };
    }

    // ---------- 목록 ----------
    listUrl(menu, page, params) {
        const parts = [];
        if (params.keyword) parts.push(`keyword=${encodeURIComponent(params.keyword)}`);
        (params.genres || []).forEach((g, i) => parts.push(`genres%5B${i}%5D=${encodeURIComponent(g)}`));
        if (params.status) parts.push(`status=${encodeURIComponent(params.status)}`);
        if (params.sort && params.sort !== "latest") parts.push(`sort=${params.sort}`);
        if (page > 1) parts.push(`page=${page}`);
        return this.base + "/" + (menu ? this.seg(menu) : "") + (parts.length ? "?" + parts.join("&") : "");
    }

    async list(url) {
        const d = await this.page(url);
        const c = (d.props && d.props.comics) || { data: [] };
        return { list: (c.data || []).map((x) => this.item(x)).filter((x) => x.name), hasNextPage: !!c.next_page_url };
    }

    /** 사이트의 "실시간 인기순위"(작품 페이지 옆 목록)를 인기 탭으로 씀 */
    async basePopular(page) {
        const home = await this.page(this.base + "/");
        const first = ((home.props.comics || {}).data || [])[0];
        if (!first) return { list: [], hasNextPage: false };
        const d = await this.page(this.base + "/" + this.seg(first.slug));
        const list = (d.props.popular || []).map((x) => this.item(x)).filter((x) => x.name);
        return list.length ? { list, hasNextPage: false } : this.baseLatest(page);
    }

    async baseLatest(page) {
        return this.list(this.listUrl("", page, {}));
    }

    async baseSearch(query, page, filters) {
        let menu = "";
        const params = { genres: [] };
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) {
                const v = f.values[f.state].value;
                if (f.param === "menu") menu = v; else params[f.param] = v;
            } else if (f.type_name === "GroupFilter" && f.param === "genres") {
                for (const g of f.state || []) if (g.state) params.genres.push(g.value || g.name);
            }
        }
        if (query && query.trim()) {
            menu = "";
            params.keyword = query.trim();
        }
        return this.list(this.listUrl(menu, page, params));
    }

    // ---------- 상세 + 회차 (100화씩 나뉜 회차 목록을 모두 받음) ----------
    epItem(slug, e) {
        return {
            name: e.title || `${e.sort}화`,
            url: "/" + this.seg(slug) + "/" + this.seg(e.slug),
            dateUpload: e.published_at ? String(Date.parse(e.published_at)) : null
        };
    }

    async getDetail(url) {
        const path = this.path(url).replace(/[?#].*$/, "");
        const d = await this.page(this.base + path);
        const c = d.props.comic || {};
        const eps = d.props.episodes || { data: [] };
        const seen = {};
        const chapters = [];
        const add = (e) => {
            const it = this.epItem(c.slug, e);
            if (seen[it.url]) return 0;
            seen[it.url] = true;
            chapters.push(it);
            return 1;
        };
        (eps.data || []).forEach(add);
        const last = Math.min(Number(eps.last_page) || 1, 100);
        for (let p = 2; p <= last; p++) {
            let dd;
            try {
                dd = await this.page(this.base + path + `?page=${p}`);
            } catch (e) {
                break;
            }
            const more = ((dd.props.episodes || {}).data || []);
            if (!more.reduce((n, e) => n + add(e), 0)) break;
        }
        const st = ((c.metadata || {}).ntk_status || "");
        return {
            name: c.title || "",
            imageUrl: this.thumb(c.thumbnail),
            author: c.author || "",
            description: c.description || "",
            genre: (c.tags || []).map((t) => (t.name && (t.name.ko || t.name)) || "").filter((s, i, a) => s && a.indexOf(s) === i),
            status: st === "completed" ? 1 : st === "ongoing" ? 0 : 5,
            link: this.base + path,
            chapters: chapterPosition(chapters.slice().sort((a, b) => {
                const n = (c) => parseFloat((/\d+(?:\.\d+)?/.exec(String(c.name || "")) || ["0"])[0]);
                return n(b) - n(a);
            }), c.title || "")
        };
    }

    // ---------- 본문 ----------
    async getHtmlContent(name, url) {
        const d = await this.page(this.base + this.path(url));
        const ep = d.props.episode || {};
        const body = ep.body || {};
        let html = body.html || body.text || body.content || "";
        if (body.type && body.type !== "html") {
            html = String(html).split(/\n+/).map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
        }
        if (!html) throw new Error("본문이 비어 있습니다");
        return `<h2>${ep.title || name || ""}</h2>` + html;
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
            { type_name: "HeaderFilter", name: "검색어를 넣으면 제목 검색 (메뉴 선택은 무시)" },
            sel("메뉴", "menu", LISTS),
            {
                type_name: "GroupFilter", name: "장르 (여러 개 선택 가능)", param: "genres",
                state: GENRES.map((g) => ({ type_name: "CheckBox", name: g, value: g, state: false }))
            },
            sel("상태", "status", STATUSES),
            sel("정렬", "sort", SORTS)
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
            else if (f.type_name === "GroupFilter" && Array.isArray(s)) f.state.forEach((c, k) => { c.state = !!s[k]; });
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
            else if (f.type_name === "GroupFilter" && Array.isArray(s)) {
                const on = f.state.filter((c, k) => s[k]).map((c) => c.name);
                if (on.length) parts.push(`장르 ${on.join(",")}`);
            }
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
        const byUrl = await openByUrl(this, query, (p) => { const s = p.split(/[/?#]/).filter((x) => x)[0]; return s ? `/${s}` : null; });
        if (byUrl) return byUrl;
        await statusRefresh(this.client);
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const list = withParams(filters, this.tabFilterList());
        const rule = list.find((f) => f && f.name === TAB_RULE_NAME);
        const r = rule ? Number(rule.state) || 0 : 0;
        if (r === 1 || r === 2) {
            const states = list.map((f) => {
                if (f && f.type_name === "GroupFilter" && Array.isArray(f.state)) return f.state.map((c) => !!c.state);
                return (!f || f.name === TAB_RULE_NAME || f.state === undefined || typeof f.state === "object") ? null : f.state;
            });
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
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (실시간 인기순위)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (최근 업데이트)")}` },
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
        return statusFilters("bookkor", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "chapter_position",
            switchPreferenceCompat: {
                title: "회차 이름에 남은 화 표시",
                summary: "예: 51화 · 남은 102 (사이트 순번·작품 제목은 빼고 짧게). 끄면 원래 이름만 표시 (새 화가 올라오면 이름이 바뀌어, 다운로드한 회차가 안 받은 것처럼 보일 수 있음)",
                value: true
            }
        }, {
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://003.bookkor.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 ###.bookkor.com 중 열리는 주소로 자동 변경",
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

// ---------- 망가요미가 돌려준 필터에 우리 표식(param/_status)이 빠져 있어도 동작하게 ----------
// 앱은 필터를 이름·상태값만 남겨 돌려줄 수 있어서, 같은 이름의 원래 필터에서 param 을 다시 채우고 상태 줄은 뺀다.
const STATUS_LINE = /^(?:📡|🩺|❌|🛡)/;
function withParams(list, base) {
    const out = [];
    for (const f of list || []) {
        if (!f || f._status || (f.type_name === "HeaderFilter" && STATUS_LINE.test(String(f.name || "")))) continue;
        if (!f.param) {
            const b = (base || []).find((x) => x && x.name === f.name && x.type_name === f.type_name);
            if (b && b.param) f.param = b.param;
        }
        out.push(f);
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
