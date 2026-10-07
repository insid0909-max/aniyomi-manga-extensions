const mangayomiSources = [{
    "id": 870214004,
    "name": "Blacktoon 웹툰",
    "lang": "ko",
    "baseUrl": "https://blacktoon423.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.3.9",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "blacktoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?blacktoon\d+\.com$/;
const AUTO_NUM = /blacktoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "webtoon_";

// Blacktoon 웹툰 - Aniyomi 확장(Blacktoon.kt)과 같은 구조를 망가요미용으로 옮김
// 사이트가 전체 작품 목록을 webtoon_0.js / webtoon_1.js 로 내려주므로 받아서 정렬/검색/필터
const BT_PAGE = 24;
const BT_CACHE_MS = 30 * 60 * 1000; // 전체 작품 목록 저장 시간
const BT_POSTER = "https://ttjsde.speedwebgo.com/";
const BT_CDN = "https://aa3cc9.speedwebgo.com/";
const BT_DATA_HOSTS = ["https://ttjsde.speedwebgo.com", "https://jsc.speedwebgo.com"];
const BT_VARS = "inc_url2|inc_url1|inc_url3|inc_url|poster_js|img_domain[2-8]?|img_per[3-8]|toonlistid|uptime|servtime";
const BT_PLATFORMS = { 1: "네이버", 2: "다음", 3: "카카오", 4: "레진", 5: "투믹스", 6: "탑툰", 7: "코미카", 8: "배틀코믹", 9: "코믹GT", 10: "케이툰", 11: "애니툰", 12: "폭스툰", 13: "피너툰", 14: "봄툰", 15: "코미코", 16: "무툰", 17: "지존신마", 99: "기타" };
const BT_TAGS = { 1: "학원", 2: "액션", 3: "SF", 4: "스토리", 5: "판타지", 6: "BL/백합", 7: "개그/코미디", 8: "연애/순정", 9: "드라마", 10: "로맨스", 11: "시대극", 12: "스포츠", 13: "일상", 14: "추리/미스터리", 15: "공포/스릴러", 16: "성인", 17: "옴니버스", 18: "에피소드", 19: "무협", 20: "소년", 99: "기타" };
const BT_DAYS = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일", 10: "열흘" };

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

// 회차 순서: 이름 앞부분(작품명·"매거진"·"특별편"·"스핀오프 …" 등)이 같은 것끼리 묶어 번호순으로 놓음 (결과는 최신 → 과거)
// 회차가 가장 많은 묶음이 본편 → 맨 앞, 그다음 번호 없는 특별편(후기 등), 다른 묶음(처음 올라온 순), 번외, 외전
// 앞부분이 다른 앞부분으로 끝나면 같은 묶음 ("스핀오프 - 식극의 상디" = "식극의 상디"), "6-1화" 는 6.01, "1.5화" 는 1.5, "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편, 프롤로그는 맨 앞
function orderChapters(list) {
    if (!list || list.length < 2) return list;
    const PRO = "\u0000prologue";
    const keys = list.map((c, i) => {
        const name = String(c.name || "").trim();
        const index = list.length - 1 - i;
        const m = /(\d+)(?:\s*([-.])\s*(\d+))?\s*(화|권|호|부|話)/.exec(name) || /(\d+)(?:\s*([-.])\s*(\d+))?/.exec(name);
        if (!m) return { prefix: /프롤로그|prologue/i.test(name) ? PRO : "", num: /프롤로그|prologue/i.test(name) ? 0 : -1, index };
        let num = parseInt(m[1], 10);
        if (m[3]) num = m[2] === "." ? parseFloat(`${m[1]}.${m[3]}`) : num + Math.min(parseInt(m[3], 10), 99) / 100;
        const prefix = name.substring(0, m.index).replace(/[\s\-–—:.,·\[\](){}제第#]+$/, "").trim();
        return { prefix, num, index };
    });
    const norm = (p) => p.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const isExtra = (p) => p.indexOf("번외") >= 0 || p.indexOf("외전") >= 0;
    // 앞부분이 다른 앞부분으로 끝나면 같은 시리즈 ("스핀오프 - 식극의 상디" = "식극의 상디"), 번외·외전끼리만 따로
    const prefixes = [...new Set(keys.map((k) => k.prefix))].filter((p) => p !== PRO && norm(p).length >= 2)
        .sort((a, b) => norm(a).length - norm(b).length);
    const canon = {};
    prefixes.forEach((p, i) => {
        const q = prefixes.slice(0, i).find((x) => norm(x).length < norm(p).length && norm(p).endsWith(norm(x)) && isExtra(x) === isExtra(p));
        canon[p] = q ? (canon[q] || q) : p;
    });
    keys.forEach((k) => { if (canon[k.prefix]) k.prefix = canon[k.prefix]; });
    const groups = {};
    keys.forEach((k) => {
        if (k.num < 0 || k.prefix === PRO) return;
        const g = groups[k.prefix] || (groups[k.prefix] = { count: 0, first: k.index });
        g.count++;
        g.first = Math.min(g.first, k.index);
    });
    let main = null;
    for (const p of Object.keys(groups)) {
        if (isExtra(p)) continue;
        if (main === null || groups[p].count > groups[main].count ||
            (groups[p].count === groups[main].count && groups[p].first < groups[main].first)) main = p;
    }
    const rank = (k) => k.prefix === PRO ? -1 : k.num < 0 ? 1 : k.prefix === main ? 0
        : k.prefix.indexOf("번외") >= 0 ? 3 : k.prefix.indexOf("외전") >= 0 ? 4 : 2;
    const firstOf = (k) => (rank(k) >= 2 ? groups[k.prefix].first : 0);
    const order = list.map((_, i) => i).sort((a, b) => {
        const x = keys[a], y = keys[b];
        return rank(x) - rank(y) || firstOf(x) - firstOf(y) || x.num - y.num || x.index - y.index;
    });
    return order.reverse().map((i) => list[i]);
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
        const n = parseInt((current.match(AUTO_NUM) || [0, "423"])[1], 10) || 423;
        const out = [];
        for (let i = Math.max(1, n - 2); i <= n + 30; i++) out.push(`https://blacktoon${i}.com`);
        return out;
    }

    /** 공식 주소 안내(blacktoonurl.net)의 링크에서 최신 주소 확인 */
    async autoGuide(current) {
        try {
            return this.pickFrom((await this.client.get("https://blacktoonurl.net/", {})).body, current);
        } catch (e) {
            return null;
        }
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/", "Origin": this.source.baseUrl };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/", "Origin": this.base };
    }

    async get(url, referer) {
        const h = { "User-Agent": MOBILE_UA, "Referer": referer || (this.base + "/"), "Origin": this.base };
        const res = await this.req(url, h);
        if (res.statusCode && res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
        return this.fixText(res.body || "");
    }

    /** 사이트가 문자셋을 알려 주지 않아 한글이 Latin-1 로 깨져 들어온 경우 UTF-8 로 다시 풂 */
    fixText(s) {
        if (/[\uac00-\ud7a3]/.test(s) || !/[\u00c0-\u00ff][\u0080-\u00bf]/.test(s)) return s;
        let out = "";
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c > 0xff) return s; // 이미 제대로 된 글자가 섞여 있으면 손대지 않음
            const n = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
            if (!n || i + n >= s.length + 0) {
                out += s[i];
                continue;
            }
            let cp = c & (0x3f >> n);
            let ok = true;
            for (let k = 1; k <= n; k++) {
                const d = s.charCodeAt(i + k);
                if ((d & 0xc0) !== 0x80) { ok = false; break; }
                cp = (cp << 6) | (d & 0x3f);
            }
            if (!ok) {
                out += s[i];
                continue;
            }
            out += String.fromCodePoint(cp);
            i += n;
        }
        return out;
    }

    // ---------- 페이지 안 스크립트에서 변수/데이터 주소 읽기 (사이트 JS는 실행하지 않음) ----------
    stripComments(code) {
        return code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
            m => (m.startsWith("//") || m.startsWith("/*")) ? "\n" : m);
    }

    /** "문자열" + 변수 + 숫자 + Math.random() 이어붙이기만 계산 */
    expr(e, vars) {
        const tok = new RegExp(`^\\s*(?:"([^"\\\\]*)"|'([^'\\\\]*)'|(${BT_VARS})\\b|(\\d+(?:\\.\\d+)?)|(Math\\.random\\(\\)))\\s*`);
        let out = "";
        let rest = e;
        while (rest.length) {
            const m = rest.match(tok);
            if (!m) return null;
            let v = m[1] ?? m[2] ?? m[4];
            if (v === undefined) v = m[5] ? String(Math.random()) : vars[m[3]];
            if (v === undefined || v === null) return null;
            out += v;
            rest = rest.substring(m[0].length);
            if (!rest.length) return out;
            if (rest[0] !== "+") return null;
            rest = rest.substring(1);
        }
        return null;
    }

    readVars(code, vars) {
        const re = new RegExp(`(?:^|[;\\r\\n])\\s*(?:(?:var|let|const)\\s+)?(${BT_VARS})\\s*=\\s*([^;\\r\\n]+)`, "g");
        let m;
        const c = this.stripComments(code);
        while ((m = re.exec(c)) !== null) {
            const v = this.expr(m[2], vars);
            if (v !== null) vars[m[1]] = v;
        }
    }

    /** 페이지 + /data/config.js 의 변수, 그리고 loadScript/loadjs/script src 로 부르는 주소들 */
    /** config.js (이미지 서버 정보). 실패하면 빈 문자열 */
    async configJs(pageUrl) {
        try {
            return await this.get(`${this.base}/data/config.js?m=${Math.random()}`, pageUrl);
        } catch (e) {
            return "";
        }
    }

    // config 는 이미지 서버를 고를 때만 필요 (목록/회차는 페이지 변수로 충분)
    async pageScripts(html, pageUrl, config) {
        const vars = {};
        const block = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let b;
        while ((b = block.exec(html)) !== null) this.readVars(b[1], vars);
        if (!Object.keys(vars).length) this.readVars(html, vars);
        if (config) this.readVars(config, vars);
        const urls = [];
        const add = u => {
            if (!u) return;
            if (u.startsWith("//")) u = "https:" + u;
            else if (u.startsWith("/")) u = this.base + u;
            if (/^https?:\/\//.test(u) && urls.indexOf(u) < 0) urls.push(u);
        };
        const code = this.stripComments(html);
        let m;
        const call = /\b(?:loadScript|loadjs)\s*\(((?:"[^"\\]*"|'[^'\\]*'|Math\.random\(\)|[^"'();\r\n])+)\)/g;
        while ((m = call.exec(code)) !== null) add(this.expr(m[1], vars));
        const src = /<script[^>]+src=["']([^"']+)["']/g;
        while ((m = src.exec(html)) !== null) add(m[1].replace(/&amp;/g, "&"));
        return { vars, urls };
    }

    // ---------- 작품 목록 ----------
    loadSavedCatalog(now) {
        try {
            const prefs = new SharedPreferences();
            const at = Number(prefs.getString("cat_at", "0")) || 0;
            if (now - at > BT_CACHE_MS) return null;
            const rows = JSON.parse(prefs.getString("cat_data", "[]"));
            if (!rows.length) return null;
            this.vars = JSON.parse(prefs.getString("cat_vars", "{}"));
            this._catAt = at;
            return rows.map(r => ({
                id: r[0], title: r[1], poster: r[2], author: r[3], updated: r[4], hot: r[5],
                tags: r[6] ? String(r[6]).split(",").map(Number) : [], platform: r[7], day: r[8], listIndex: r[9]
            }));
        } catch (e) {
            return null;
        }
    }

    saveCatalog(items, now) {
        try {
            const rows = JSON.stringify(items.map(s => [s.id, s.title, s.poster, s.author, s.updated, s.hot, s.tags.join(","), s.platform, s.day, s.listIndex]));
            if (rows.length > 8 * 1024 * 1024) return;
            const prefs = new SharedPreferences();
            prefs.setString("cat_data", rows);
            prefs.setString("cat_vars", JSON.stringify({ inc_url1: (this.vars || {}).inc_url1, inc_url2: (this.vars || {}).inc_url2 }));
            prefs.setString("cat_at", String(now));
        } catch (e) {
            // 저장 실패해도 계속
        }
    }

    async catalog() {
        const now = Date.now();
        if (this._cat && now - this._catAt < BT_CACHE_MS) return this._cat;
        const saved = this.loadSavedCatalog(now);
        if (saved) {
            this._cat = saved;
            return saved;
        }
        const pageUrl = this.base + "/";
        const html = await this.get(pageUrl);
        const { vars, urls } = await this.pageScripts(html, pageUrl);
        this.vars = vars;
        const items = [];
        // 연재(1) / 완결(0) 데이터를 동시에 받음
        const loadIndex = async index => {
            const cands = urls.filter(u => new RegExp(`/(?:webtoon_${index}|data/webtoon/webtoon_${index}_\\d+)\\.js`).test(u.split("?")[0]));
            for (const h of [vars.inc_url2, vars.inc_url1].concat(BT_DATA_HOSTS)) {
                if (h) cands.push(`${h.replace(/\/+$/, "")}/webtoon_${index}.js`);
            }
            for (const u of cands) {
                try {
                    const body = await this.get(u, pageUrl);
                    const m = body.match(new RegExp(`data${index}\\s*=\\s*(\\[[\\s\\S]*\\])`));
                    if (!m) continue;
                    const arr = JSON.parse(m[1]);
                    if (arr.length) return arr;
                } catch (e) {
                    // 다음 후보
                }
            }
            return null;
        };
        const lists = await Promise.all([loadIndex(1), loadIndex(0)]);
        for (const [n, index] of [[0, 1], [1, 0]]) {
            const loaded = lists[n];
            if (!loaded) throw new Error(`블랙툰 작품 데이터(webtoon_${index})를 불러오지 못했습니다`);
            for (const o of loaded) {
                if (!o.x) continue;
                items.push({
                    id: String(o.x), title: o.t || "", poster: o.p || "", author: o.au || "",
                    updated: Number(o.g) || 0, hot: Number(o.h) || 0,
                    tags: String(o.tag || "").split(",").map(s => parseInt(s)).filter(n => !isNaN(n)),
                    platform: parseInt(o.c), day: parseInt(o.pd), listIndex: index
                });
            }
        }
        this._cat = items;
        this._catAt = now;
        this.saveCatalog(items, now);
        return items;
    }

    posterHost() {
        const v = this.vars || {};
        const h = v.inc_url2 || v.inc_url1;
        return h ? h.replace(/\/+$/, "") + "/" : BT_POSTER;
    }

    toManga(s) {
        let img = "";
        if (s.poster) {
            const p = s.poster.replace("_x4", "").replace("_x3", "");
            img = /^https?:/.test(p) ? p : p.startsWith("//") ? "https:" + p : this.posterHost() + p.replace(/^\/+/, "");
        }
        return { name: s.title, imageUrl: img, link: `/webtoon/${s.id}.html` };
    }

    async browse(page, sel) {
        const all = await this.catalog();
        const sorted = all.slice().sort(sel.order === 1 ? (a, b) => b.hot - a.hot : (a, b) => b.updated - a.updated);
        const q = (sel.query || "").toLowerCase();
        const filtered = sorted.filter(s =>
            (!q || s.title.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)) &&
            (sel.status === -1 || s.listIndex === sel.status) &&
            (sel.platform === -1 || s.platform === sel.platform) &&
            (sel.day === -1 || s.day === sel.day) &&
            (sel.tag === -1 || s.tags.indexOf(sel.tag) >= 0));
        const start = (page - 1) * BT_PAGE;
        return {
            list: filtered.slice(start, start + BT_PAGE).map(s => this.toManga(s)),
            hasNextPage: start + BT_PAGE < filtered.length
        };
    }

    async basePopular(page) {
        return this.browse(page, { order: 1, status: -1, platform: -1, day: -1, tag: -1 });
    }

    async baseLatest(page) {
        return this.browse(page, { order: 0, status: -1, platform: -1, day: -1, tag: -1 });
    }

    async baseSearch(query, page, filters) {
        const sel = { query: (query || "").trim(), order: 0, status: -1, platform: -1, day: -1, tag: -1 };
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) sel[f.param] = parseInt(f.values[f.state].value);
        }
        return this.browse(page, sel);
    }

    // ---------- 상세 + 회차 (data/toonlist/{id}.js 의 clist) ----------
    async getDetail(url) {
        const id = String(url).replace(/\D+/g, "") || url;
        const pageUrl = `${this.base}/webtoon/${id}.html`;
        const html = await this.get(pageUrl);
        const doc = new Document(html);

        // 전체 목록은 크므로 새로 받지 않음 (이미 받아 둔 경우에만 사용)
        const meta = (this._cat || []).find(s => s.id === id) || null;
        const descs = doc.select("p.mt-2");
        const genre = meta
            ? [BT_PLATFORMS[meta.platform], BT_DAYS[meta.day]].concat(meta.tags.map(t => BT_TAGS[t])).filter(x => x)
            : doc.select("span.badge-light").map(e => e.text.trim()).filter(x => x);

        const { vars, urls } = await this.pageScripts(html, pageUrl);
        const cands = urls.filter(u => u.split("?")[0].endsWith(`/data/toonlist/${id}.js`));
        for (const h of [vars.inc_url1, vars.inc_url, vars.inc_url2].concat(BT_DATA_HOSTS, [this.base])) {
            if (h) cands.push(`${h.replace(/\/+$/, "")}/data/toonlist/${id}.js?v=${Math.random()}`);
        }
        let chapters = [];
        const errors = [];
        for (const u of cands) {
            try {
                const body = await this.get(u, pageUrl);
                const m = body.match(/clist\s*=\s*(\[[\s\S]*\])/);
                if (!m) throw new Error("형식 다름");
                const arr = JSON.parse(m[1]);
                if (!arr.length) throw new Error("비어 있음");
                chapters = arr.map(o => ({
                    name: o.t || String(o.id),
                    url: /^\/webtoons\/.+\.html$/.test(o.u || "") ? o.u : `/webtoons/${id}/${o.id}.html`,
                    dateUpload: /^\d{4}-\d{2}-\d{2}/.test(o.d || "") ? String(new Date(`${o.d.substring(0, 10)}T00:00:00+09:00`).valueOf()) : null
                })).reverse();
                break;
            } catch (e) {
                errors.push(`${u.split("/")[2]}: ${e.message || e}`);
            }
        }
        if (!chapters.length) throw new Error("블랙툰 회차 목록 로드 실패 " + errors.join(" / ").substring(0, 200));

        const cover = doc.selectFirst("img.thumb2");
        const plain = html.replace(/<[^>]+>/g, " ");
        return {
            name: meta ? meta.title : (doc.selectFirst("h3 b")?.text || "").trim(),
            imageUrl: meta ? this.toManga(meta).imageUrl : (cover?.attr("src") || ""),
            author: meta ? meta.author : ((plain.match(/작가\s*:\s*([^\n]+?)\s{2,}/) || [])[1] || "").trim(),
            description: descs.length ? descs[descs.length - 1].text.trim() : "",
            genre,
            status: meta ? (meta.listIndex === 0 ? 1 : 0) : 5,
            chapters: orderChapters(chapters)
        };
    }

    // ---------- 이미지 ----------
    /** content.js 의 이미지 서버 선택 규칙과 같게 계산 */
    imageCdn(v) {
        const dom = n => {
            const u = v[n];
            return u && /^https?:\/\//.test(u) ? u.replace(/\/+$/, "") + "/" : null;
        };
        const x = v.toonlistid ? Number(v.toonlistid) % 100 : NaN;
        const uptime = Number(v.uptime);
        const delay = Number(v.img_per8);
        if (!isNaN(x) && v.uptime && v.img_per8 && !isNaN(uptime) && !isNaN(delay)) {
            if (Date.now() > uptime - 5 * 60 * 60 * 1000 + delay * 60 * 1000) {
                let threshold = 0;
                for (let i = 3; i <= 7; i++) {
                    const per = Number(v[`img_per${i}`]);
                    if (isNaN(per) || v[`img_per${i}`] === undefined) break;
                    threshold += per;
                    if (x < threshold) return dom(`img_domain${i}`) || dom("img_domain2") || BT_CDN;
                }
            }
            return dom("img_domain8") || dom("img_domain2") || BT_CDN;
        }
        return dom("img_domain2") || dom("img_domain") || BT_CDN;
    }

    async getPageList(url) {
        // 예전 형식("작품/회차")과 사이트 경로("/webtoons/작품/회차.html") 모두 지원
        const pageUrl = String(url).startsWith("/") ? this.base + url : `${this.base}/webtoons/${url}.html`;
        const [html, config] = await Promise.all([this.get(pageUrl), this.configJs(pageUrl)]);
        const { vars } = await this.pageScripts(html, pageUrl, config);
        const cdn = this.imageCdn(vars);
        const doc = new Document(html);
        const urls = [];
        for (const img of doc.select("#toon_content_imgs img")) {
            let s = img.attr("data-original") || img.attr("o_src") || img.attr("src") || "";
            if (!s) continue;
            if (s.startsWith("//")) s = "https:" + s;
            else if (s.startsWith("/")) s = this.base + s;
            else if (!/^https?:\/\//.test(s)) s = cdn + s;
            urls.push(s);
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.map(u => ({ url: u, headers: { "Referer": pageUrl, "Origin": this.base } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[1], value: String(p[0]) }))
        });
        const withAll = m => [[-1, "전체"]].concat(Object.keys(m).map(k => [k, m[k]]));
        return [
            { type_name: "HeaderFilter", name: "검색어와 필터를 함께 쓸 수 있음" },
            sel("정렬", "order", [[0, "최신순"], [1, "인기순"]]),
            sel("상태", "status", [[-1, "전체"], [1, "연재"], [0, "완결"]]),
            sel("플랫폼", "platform", withAll(BT_PLATFORMS)),
            sel("요일", "day", withAll(BT_DAYS)),
            sel("장르", "tag", withAll(BT_TAGS))
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /^\/webtoon\/([^/?#]+)\.html/.exec(p); return m ? `/webtoon/${m[1]}.html` : null; });
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
        return statusFilters("blacktoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://blacktoon424.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 blacktoonurl.net / 다음 번호 주소에서 새 주소로 자동 변경",
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
