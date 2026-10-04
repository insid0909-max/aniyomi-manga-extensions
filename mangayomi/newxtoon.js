const mangayomiSources = [{
    "id": 870214001,
    "name": "newxtoon 웹툰",
    "lang": "ko",
    "baseUrl": "https://newxtoon1.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.3.5",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "newxtoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?newxtoon\d*\.com$/;
const AUTO_NUM = /newxtoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "뉴엑스툰";

// newxtoon 웹툰 - Aniyomi 확장(NewXtoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        // 설치 중 등 설정을 읽을 수 없을 때는 기본 주소
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

    /** 요청 실패(접속 불가 / 5xx) 시 새 주소를 찾아 저장하고 같은 요청을 다시 보냄 */
    async req(url, headers, post, body) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        try {
            const res = post ? await this.client.post(url, headers || {}, body) : await this.client.get(url, headers || {});
            if (!ours || !(res.statusCode >= 500)) return res;
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
        const fix = s => typeof s === "string" ? s.split(base).join(found) : s;
        const h = {};
        for (const k in headers || {}) h[k] = fix(headers[k]);
        const newUrl = found + url.substring(base.length);
        return post ? await this.client.post(newUrl, h, fix(body)) : await this.client.get(newUrl, h);
    }

    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));

        const num = u => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        let found = null;
        try {
            found = await this.autoGuide(current);
        } catch (e) {
            found = null;
        }
        if (!found) {
            const cands = this.autoCandidates(current).filter(c => c !== current);
            const hits = await Promise.all(cands.map(async c => {
                try {
                    const r = await this.client.get(c + AUTO_PROBE, { "Referer": c + "/" });
                    return r.statusCode === 200 && String(r.body || "").toLowerCase().includes(AUTO_MARKER) ? c : null;
                } catch (e) {
                    return null;
                }
            }));
            const ok = hits.filter(x => x);
            ok.sort((a, b) => num(b) - num(a));
            found = ok[0] || null;
        }
        if (found) prefs.setString("auto_domain", found);
        return found;
    }

    /** 안내 페이지 본문에서 주소 찾기 (가장 큰 번호) */
    pickFrom(text, current) {
        const re = new RegExp(AUTO_HOST.source.replace(/^\^/, "").replace(/\$$/, ""), "gi");
        const hosts = (String(text || "").match(re) || []).map(h => "https://" + h.toLowerCase())
            .filter(h => h !== current);
        const num = u => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        hosts.sort((a, b) => num(b) - num(a));
        return hosts[0] || null;
    }

    autoCandidates(current) {
        const out = [];
        for (let i = 1; i <= 40; i++) out.push(`https://newxtoon${i}.com`);
        return out;
    }

    async autoGuide(current) {
        return null;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/" };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/" };
    }

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "").split("#")[0];
    }

    async get(url, headers) {
        const res = await this.req(url, headers || this.hdr(url));
        return res.body;
    }

    // ---------- 목록 ----------
    listUrl(page, params) {
        const q = [];
        for (const k in params) if (params[k]) q.push(`${k}=${encodeURIComponent(params[k])}`);
        if (page > 1) q.push(`page=${page}`);
        return `${this.base}/comics` + (q.length ? "?" + q.join("&") : "");
    }

    parseList(html, page) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a[href]")) {
            const p = this.path(a.attr("href")).split("?")[0];
            if (!/^\/comics\/\d+$/.test(p) || seen[p]) continue;
            let img = null;
            for (const i of a.select("img")) {
                const s = i.attr("src") || "";
                if (s && s.indexOf("/platforms/logos/") < 0 && !s.endsWith(".svg")) { img = i; break; }
            }
            let name = (img ? (img.attr("alt") || "") : "").replace(/ 표지$/, "").trim();
            if (!name) {
                const label = a.attr("aria-label") || "";
                name = label.lastIndexOf(", ") > 0 ? label.substring(0, label.lastIndexOf(", ")) : label;
            }
            if (!name) name = a.text.trim();
            if (!name) continue;
            seen[p] = true;
            list.push({ name, imageUrl: img ? this.abs(img.attr("src") || img.attr("data-src")) : "", link: p });
        }
        let maxPage = 0;
        for (const a of doc.select("a[href*='page=']")) {
            const m = (a.attr("href") || "").match(/[?&]page=(\d+)/);
            if (m) maxPage = Math.max(maxPage, parseInt(m[1]));
        }
        const hasNextPage = list.length > 0 && (doc.selectFirst("a[rel=next]") != null || maxPage > page);
        return { list, hasNextPage };
    }

    async basePopular(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "popular" })), page);
    }

    async baseLatest(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "latest" })), page);
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            let url = `${this.base}/search?q=${encodeURIComponent(query.trim())}`;
            if (page > 1) url += `&page=${page}`;
            return this.parseList(await this.get(url), page);
        }
        const params = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) params[f.param] = f.values[f.state].value;
        }
        return this.parseList(await this.get(this.listUrl(page, params)), page);
    }

    // ---------- 상세 + 회차 ----------
    parseDate(s) {
        const m = (s || "").match(/(\d{4})\.(\d{2})\.(\d{2})/);
        if (!m) return null;
        return String(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`).valueOf());
    }

    async getDetail(url) {
        const pageUrl = this.abs(url);
        const html = await this.get(pageUrl);
        const doc = new Document(html);
        const h1 = doc.selectFirst("h1#comic-title") || doc.selectFirst("h1");
        const strongs = doc.select("strong").map(e => e.text.trim());
        let status = 5;
        if (strongs.some(t => t === "완결")) status = 1;
        else if (strongs.some(t => t.startsWith("연재"))) status = 0;
        const genre = [];
        for (const a of doc.select("a[href*='category=']")) {
            const t = a.text.trim();
            if (t && genre.indexOf(t) < 0) genre.push(t);
        }

        const comicId = (this.path(url).match(/\/comics\/(\d+)/) || [])[1];
        const chapters = [];
        const seen = {};
        const add = (id, title, date) => {
            if (!id || seen[id]) return;
            seen[id] = true;
            chapters.push({ name: title || id, url: `/comics/${comicId}/chapters/${id}`, dateUpload: this.parseDate(date) });
        };
        // 1) 페이지에 들어있는 첫 묶음
        for (const row of doc.select("a.chapter-item[data-chapter-id]")) {
            const d = (row.text.match(/\d{4}\.\d{2}\.\d{2}/) || [""])[0];
            add(row.attr("data-chapter-id"), (row.selectFirst("span.truncate")?.text || "").trim(), d);
        }
        // 2) 나머지는 JSON 더보기 API (/comics/{id}/chapters?page=N)
        const nextAttr = doc.selectFirst("[data-chapter-next-page]")?.attr("data-chapter-next-page");
        let page = parseInt(nextAttr) || (chapters.length ? 2 : 1);
        const headers = {
            "Referer": pageUrl,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        };
        const fetchPage = async p => {
            try {
                return JSON.parse(await this.get(`${this.base}/comics/${comicId}/chapters?page=${p}`, headers));
            } catch (e) {
                return null;
            }
        };
        // 총 회차 수를 알면 남은 쪽을 6개씩 동시에 받음
        const plain = html.replace(/<[^>]+>/g, " ");
        const total = parseInt(((plain.match(/총\s*([\d,]+)\s*화/) || [])[1] || "").replace(/,/g, ""), 10);
        const size = parseInt(doc.selectFirst("[data-chapter-page-size]")?.attr("data-chapter-page-size"), 10) || 20;
        if (comicId && total > chapters.length) {
            const last = Math.ceil(total / size);
            for (let p = page; p <= last; p += 6) {
                const batch = [];
                for (let q = p; q < p + 6 && q <= last; q++) batch.push(fetchPage(q));
                for (const json of await Promise.all(batch)) {
                    for (const o of (json && json.chapters) || []) add(String(o.id), o.title, o.date);
                }
            }
            page = last + 1;
        }
        // 총 회차 수를 모르거나 덜 받은 경우: 순서대로 이어서
        for (let guard = 0; comicId && !(total > 0 && chapters.length >= total) && guard < 300; guard++) {
            let json;
            try {
                json = JSON.parse(await this.get(`${this.base}/comics/${comicId}/chapters?page=${page}`, headers));
            } catch (e) {
                break;
            }
            for (const o of json.chapters || []) add(String(o.id), o.title, o.date);
            if (!json.has_more) break;
            page = json.next_page > page ? json.next_page : page + 1;
        }

        return {
            name: h1 ? h1.text.trim() : "",
            imageUrl: doc.selectFirst("meta[property='og:image']")?.attr("content") || "",
            description: (doc.selectFirst("[data-comic-description]")?.text || "").trim(),
            author: (doc.selectFirst("a[href*='/search?q=']")?.text || "").trim(),
            genre,
            status,
            chapters
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const doc = new Document(await this.get(this.abs(url)));
        const urls = [];
        for (const img of doc.select("[data-reader-page] img")) {
            if (!(img.className || "").includes("reader-page") && !img.attr("data-reader-image")) continue;
            const u = this.abs(img.attr("src") || img.attr("data-src"));
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.map(u => ({ url: u, headers: { "Referer": this.base + "/" } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어를 입력하면 필터는 무시됩니다" },
            sel("분류", "category", [["전체", ""], ["일반만화", "일반만화"], ["BL·GL", "BL·GL"], ["성인만화", "성인"]]),
            sel("요일", "weekday", [["전체", ""], ["월", "월"], ["화", "화"], ["수", "수"], ["목", "목"], ["금", "금"], ["토", "토"], ["일", "일"]]),
            sel("장르", "genre", [["전체", ""], ["로맨스", "1"], ["드라마", "4"], ["판타지", "2"], ["로맨스판타지", "2739"], ["성장물", "2753"], ["액션", "3"], ["개그/코미디", "6"], ["무협/사극", "2743"], ["성인", "2782"], ["고수위", "2783"], ["학원/캠퍼스", "2745"], ["BL", "2788"]]),
            sel("연재 상태", "status", [["전체", ""], ["연재중", "연재중"], ["완결", "완결"]]),
            sel("플랫폼", "platform", [["전체", ""], ["카카오페이지", "kakao-page"], ["네이버", "naver"], ["레진코믹스", "lezhin"], ["리디", "ridi"], ["탑툰", "toptoon"], ["봄툰", "bomtoon"], ["미스터블루", "mrblue"], ["투믹스", "toomics"]]),
            sel("정렬", "sort", [["최신순", "latest"], ["인기순", "popular"]])
        ];
    }

    // ---------- Popular/Latest 규칙: 필터에서 고른 조건을 인기/최신 탭에 저장 ----------
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /^\/comics\/(\d+)/.exec(p); return m ? `/comics/${m[1]}` : null; });
        if (byUrl) return byUrl;
        await statusRefresh(this.client);
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const list = withParams(filters, this.tabFilterList());
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
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (사이트 인기 목록)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (사이트 최신 목록)")}` },
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
        return statusFilters("newxtoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://newxtoon2.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 newxtoon1~40.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

// ---------- 앱 기본 User-Agent 사용 ----------
// 망가요미는 내장 웹뷰에서 Cloudflare 확인을 통과하면 쿠키와 그 웹뷰의 User-Agent 를 함께 저장하고,
// 요청에 User-Agent 가 없을 때만 그 값을 넣는다. 확장이 고정 User-Agent 를 보내면 통과 쿠키가 거부되므로
// 사이트(문서·API) 요청에서는 확장의 User-Agent 를 빼고 앱 값을 쓰게 한다. 영상·이미지 주소 요청은 그대로 둔다.
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
