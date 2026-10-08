const mangayomiSources = [{
    "id": 870214005,
    "name": "11toon 만화",
    "lang": "ko",
    "baseUrl": "https://11toon2.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.3.11",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "toon11.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?11toon\d*\.com$/;
const AUTO_NUM = /11toon(\d+)/;
const AUTO_PROBE = "/mb";
const AUTO_MARKER = "content/info/";

// 11toon 만화 (일일툰) - Aniyomi 확장(Toon11.kt)과 같은 구조를 망가요미용으로 옮김
// 작품: /mb/content/info/{id}?page=toon, 회차: /mb/content/image/{id}?page=toon&parent_id={작품id}
// 데이터 API: /iapi/t3 (작품+회차), /iapi/t4 (랭킹), /iapi/t5 (이미지), POST /mb/top_search (검색)
// 응답 형식: {"data":{"SucCode":20000,"SucData":...,"SucAllCnt":N},"code":200}
const T11_USER = "100";
const T11_VIEW = "2001";   // ViewCodeToon
const T11_TOP = "400";     // TopCoce
const T11_NEW = "100";     // NewCoce
const T11_ROW = 30;
const T11_SEARCH_ROW = 20;

// ---------- 접속 속도 제한 · 주소로 바로 열기 ----------
// 사이트로 가는 요청 사이에 최소 간격 (한꺼번에 많이 요청하면 사이트가 403으로 막음). 그림 요청은 제외
let lastSiteRequest = 0;
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
// 사이트 "만화분류"의 장르 (번호 = SType, 0 = 전체)
const T11_GENRES = ["전체", "SF", "TS", "개그", "드라마", "러브코미디", "먹방", "백합", "붕탁", "순정", "스릴러",
    "스포츠", "시대", "액션", "인기", "일상 + 치유", "추리", "판타지", "학원", "호러", "BL"];

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

// 회차 순서: 이름에서 숫자 앞부분(작품 제목 단어는 빼고)이 같은 것끼리 묶어 번호순으로 놓음 (결과는 최신 → 과거)
// 단위가 다르면 다른 묶음 ("원피스 1화"/"원피스 1권"), 단 번호가 본편과 안 겹치면 본편 ("12화"/"13")
// "(ONE PIECE)원피스 775화" 와 "1194화" 는 같은 묶음, "스핀오프 - 식극의 상디" 와 "식극의 상디" 도 같은 묶음
// 회차가 가장 많은 묶음이 본편 → 맨 앞, 그다음 번호 없는 특별편(후기 등), 다른 묶음(처음 올라온 순), 번외, 외전. 프롤로그는 맨 앞
// "6-1화" 는 6.01, "1.5화" 는 1.5, "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편
// 망가요미는 이름 맨 앞 숫자로 회차 번호를 정하므로, 본편이 아닌 회차는 이름 앞에 본편 마지막 번호 다음 순번을 붙임
// ("1195 · 원피스 매거진 1호") → "화 번호별" 정렬도 본편 1화 ~ 끝 → 나머지 순서
function orderChapters(list, title) {
    if (!list || list.length < 2) return list;
    const PRO = "\u0000prologue";
    const norm = (p) => String(p || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const isExtra = (p) => p.indexOf("번외") >= 0 || p.indexOf("외전") >= 0;
    const titleWords = (String(title || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
        .filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
    const keys = list.map((c, i) => {
        const name = String(c.name || "").trim();
        const index = list.length - 1 - i;
        const m = /(\d+)(?:\s*([-.])\s*(\d+))?\s*(화|권|호|부|話)/.exec(name) || /(\d+)(?:\s*([-.])\s*(\d+))?/.exec(name);
        if (!m) return /프롤로그|prologue/i.test(name) ? { prefix: PRO, unit: "", num: 0, index } : { prefix: "", unit: "", num: -1, index };
        let num = parseInt(m[1], 10);
        if (m[3]) num = m[2] === "." ? parseFloat(`${m[1]}.${m[3]}`) : num + Math.min(parseInt(m[3], 10), 99) / 100;
        let prefix = norm(name.substring(0, m.index));
        titleWords.forEach((w) => { prefix = prefix.split(w).join(""); });
        return { prefix, unit: m[4] || "", num, index };
    });
    // 앞부분이 다른 앞부분으로 끝나면 같은 시리즈, 번외·외전끼리만 따로
    const prefixes = [...new Set(keys.map((k) => k.prefix))].filter((p) => p !== PRO && p.length >= 2)
        .sort((a, b) => a.length - b.length);
    const canon = {};
    prefixes.forEach((p, i) => {
        const q = prefixes.slice(0, i).find((x) => x.length < p.length && p.endsWith(x) && isExtra(x) === isExtra(p));
        canon[p] = q ? (canon[q] || q) : p;
    });
    keys.forEach((k) => { if (canon[k.prefix]) k.prefix = canon[k.prefix]; });
    // 묶음 = 앞부분 + 단위 ("원피스 1화" 와 "원피스 1권" 은 다른 묶음). 번외·외전은 단위 상관없이 한 묶음
    keys.forEach((k) => { k.group = isExtra(k.prefix) ? k.prefix : `${k.prefix}|${k.unit}`; });
    const collect = () => {
        const groups = {};
        keys.forEach((k) => {
            if (k.num < 0 || k.prefix === PRO) return;
            const g = groups[k.group] || (groups[k.group] = { count: 0, first: k.index, prefix: k.prefix, nums: new Set() });
            g.count++;
            g.first = Math.min(g.first, k.index);
            g.nums.add(k.num);
        });
        return groups;
    };
    let groups = collect();
    let main = null;
    for (const g of Object.keys(groups)) {
        if (isExtra(groups[g].prefix)) continue;
        if (main === null || groups[g].count > groups[main].count ||
            (groups[g].count === groups[main].count && groups[g].first < groups[main].first)) main = g;
    }
    // 앞부분이 같고 번호가 본편과 안 겹치면 단위만 빠진 본편 ("12화" 와 "13") → 본편에 합침
    if (main !== null) {
        const mg = groups[main];
        for (const g of Object.keys(groups)) {
            if (g === main || groups[g].prefix !== mg.prefix || [...groups[g].nums].some((n) => mg.nums.has(n))) continue;
            keys.forEach((k) => { if (k.group === g) k.group = main; });
        }
        groups = collect();
    }
    const rank = (k) => k.prefix === PRO ? -1 : k.num < 0 ? 1 : k.group === main ? 0
        : k.prefix.indexOf("번외") >= 0 ? 3 : k.prefix.indexOf("외전") >= 0 ? 4 : 2;
    const firstOf = (k) => (rank(k) >= 2 ? groups[k.group].first : 0);
    const order = list.map((_, i) => i).sort((a, b) => {
        const x = keys[a], y = keys[b];
        return rank(x) - rank(y) || firstOf(x) - firstOf(y) || x.num - y.num || x.index - y.index;
    });
    let next = Math.floor(Math.max(0, ...keys.filter((k) => k.group === main && k.num >= 0).map((k) => k.num)));
    order.forEach((i) => {
        if (rank(keys[i]) > 0) list[i] = Object.assign({}, list[i], { name: `${++next} · ${String(list[i].name || "").trim()}` });
    });
    return order.reverse().map((i) => list[i]);
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

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
        this.coverBase = "https://11toon8.com/data/toon_category/";
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
    async req(url, headers, post, body) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        let notice = null;
        try {
            const res = post ? await this.client.post(url, headers || {}, body) : await this.client.get(url, headers || {});
            // 자동으로 찾은 주소가 막히면(403) 자동 주소를 지우고 기본 주소로 다시 요청
            if (ours && res.statusCode === 403 && base !== this.source.baseUrl && !this.cleanUrl(new SharedPreferences().get("domain"))) {
                new SharedPreferences().setString("auto_domain", "");
                const fb = this.source.baseUrl;
                const h = {};
                for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(fb);
                const r2 = (post ? await this.client.post(fb + url.substring(base.length), h, body) : await this.client.get(fb + url.substring(base.length), h));
                if (r2.statusCode < 400) return r2;
            }
            if (ours && !post && res.statusCode === 200) notice = await noticeTarget(this, res.body, base, "content/info/");
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
        for (let i = 1; i <= 30; i++) out.push(`https://11toon${i}.com`);
        return out;
    }

    async autoGuide(current) {
        return null;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/mb" };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/mb" };
    }

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    coverFor(id) {
        return `${this.coverBase}${id}.webp`;
    }

    rememberCover(u) {
        const i = (u || "").indexOf("/data/toon_category/");
        if (i > 0) this.coverBase = u.substring(0, i) + "/data/toon_category/";
    }

    isPlaceholder(t) {
        return !t || t.trim().toLowerCase().startsWith("loading");
    }

    // 사이트는 모든 API 요청에 페이지의 _token 을 X-CSRF-TOKEN 헤더로 보냄
    async token() {
        if (this._token) return this._token;
        try {
            const res = await this.req(this.base + "/mb", this.hdr());
            const t = new Document(res.body).selectFirst("meta[name='_token']")?.attr("content");
            if (t) this._token = t;
        } catch (e) {
            // 토큰 없이 진행
        }
        return this._token || "";
    }

    async apiHeaders(referer, withToken = true) {
        const h = {
            "User-Agent": MOBILE_UA,
            "Referer": referer,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
        };
        if (withToken) {
            const t = await this.token();
            if (t) h["X-CSRF-TOKEN"] = t;
        }
        return h;
    }

    parseJson(body) {
        const i = (body || "").search(/[{[]/);
        if (i < 0) return null;
        try {
            return JSON.parse(body.substring(i));
        } catch (e) {
            return null;
        }
    }

    // 조회(GET) API는 토큰 없이 바로 요청 (메인 페이지를 먼저 받지 않아 빠름), 실패하면 토큰을 붙여 한 번 더
    async api(path, params, referer) {
        const q = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
        const url = `${this.base}${path}?${q}`;
        for (const withToken of [false, true]) {
            try {
                const json = this.parseJson((await this.req(url, await this.apiHeaders(referer, withToken))).body);
                if (json && (json.code === undefined || json.code == 200)) return json;
            } catch (e) {
                // 토큰 붙여 재시도
            }
        }
        return null;
    }

    sucData(o) {
        if (!o) return null;
        return (o.data && o.data.SucData !== undefined) ? o.data.SucData : (o.SucData !== undefined ? o.SucData : (o.data || o));
    }

    /** 응답 안 어디에 있든 id + subject 를 가진 작품 객체들을 모음 (문자열 JSON 포함) */
    collect(node, out) {
        if (node == null) return;
        if (typeof node === "string") {
            if (node.startsWith("{")) {
                try {
                    this.collect(JSON.parse(node), out);
                } catch (e) {
                    // 무시
                }
            }
        } else if (Array.isArray(node)) {
            node.forEach(n => this.collect(n, out));
        } else if (typeof node === "object") {
            if (node.id !== undefined && node.subject !== undefined) out.push(node);
            else Object.keys(node).forEach(k => this.collect(node[k], out));
        }
    }

    imageOf(o) {
        const img = o.image;
        const raw = img && typeof img === "object" ? (img.Big || img.Small || img.Middle || "") : (typeof img === "string" ? img : "");
        return raw ? this.abs(raw) : "";
    }

    mangaUrl(id) {
        return `/mb/content/info/${id}?page=toon`;
    }

    mangaId(u) {
        return ((u || "").match(/\/content\/info\/(\d+)/) || [])[1];
    }

    // ---------- 목록 ----------
    toList(items) {
        const seen = {};
        const list = [];
        for (const o of items) {
            const id = String(o.id || "");
            const name = String(o.subject || "").trim();
            if (!id || seen[id] || this.isPlaceholder(name)) continue;
            if (o.type && o.type !== "만화" && o.type !== "toon") continue;
            seen[id] = true;
            let img = this.imageOf(o);
            if (img) this.rememberCover(img); else img = this.coverFor(id);
            list.push({ name, imageUrl: img, link: this.mangaUrl(id) });
        }
        return list;
    }

    /** 메인(/mb) 등 HTML 의 /mb/content/info/{id} 카드들 */
    parseCards(html) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a[href*='/content/info/']")) {
            const id = this.mangaId(a.attr("href"));
            if (!id || seen[id]) continue;
            const name = (a.selectFirst("h4")?.text || a.selectFirst("h3")?.text || a.selectFirst("img")?.attr("alt") || "").trim();
            if (this.isPlaceholder(name)) continue;
            seen[id] = true;
            let img = "";
            for (const i of a.select("img")) {
                const s = i.attr("data-original") || i.attr("data-src") || i.attr("src") || "";
                if (s.includes("toon_category")) { img = this.abs(s); break; }
            }
            if (img) this.rememberCover(img); else img = this.coverFor(id);
            list.push({ name, imageUrl: img, link: this.mangaUrl(id) });
        }
        return list;
    }

    async mainPage(page) {
        if (page > 1) return { list: [], hasNextPage: false };
        const res = await this.req(this.base + "/mb", this.hdr());
        return { list: this.parseCards(res.body), hasNextPage: false };
    }

    async ranking(menu, page) {
        const json = await this.api("/iapi/t4", {
            usercode: T11_USER, menucode: menu, page: page, pagerow: T11_ROW, type: 0
        }, this.base + "/mb");
        if (!json) return null;
        const items = [];
        this.collect(this.sucData(json), items);
        const list = this.toList(items);
        if (!list.length) return page > 1 ? { list: [], hasNextPage: false } : null;
        const total = json.data && json.data.SucAllCnt ? Number(json.data.SucAllCnt) : -1;
        // 다음 쪽은 이번 쪽이 꽉 찼고 전체 개수가 더 많을 때만
        return { list, hasNextPage: items.length >= T11_ROW && (total < 0 || page * T11_ROW < total) };
    }

    async getPopular(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_POPULAR);
        if (s) return this.categoryList(page, this.tabRestore(s));
        return (await this.ranking(T11_TOP, page)) || this.mainPage(page);
    }

    async getLatestUpdates(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_LATEST);
        if (s) return this.categoryList(page, this.tabRestore(s));
        return (await this.ranking(T11_NEW, page)) || this.mainPage(page);
    }

    /** 사이트 "만화분류"와 같은 목록 (/iapi/t2: 장르 SType, 국가 SCountry, 연재 SEnd) */
    async categoryList(page, filters) {
        const val = (param) => {
            const f = (filters || []).find((x) => x && x.param === param);
            return f && f.values && f.values[f.state] ? f.values[f.state].value : "0";
        };
        const sType = val("SType"), sCountry = val("SCountry"), sEnd = val("SEnd");
        const referer = `${this.base}/mb/search/content?page=toon&SType=${sType}&SCountry=${sCountry}&SEnd=${sEnd}`;
        const json = await this.api("/iapi/t2", {
            Page: page, Pagerow: T11_ROW, SType: sType, SCountry: sCountry, SEnd: sEnd, SzA_Z: 0, MenuCode: 1000
        }, referer);
        if (!json) return { list: [], hasNextPage: false };
        const items = [];
        this.collect(this.sucData(json), items);
        const list = this.toList(items);
        const total = json.data && json.data.SucAllCnt ? Number(json.data.SucAllCnt) : -1;
        return { list, hasNextPage: items.length >= T11_ROW && (total < 0 || page * T11_ROW < total) };
    }

    // 검색: 검색어가 없으면 필터(만화분류) 목록, 있으면 검색 페이지를 연 뒤(토큰) POST /mb/top_search → {"data":[...],"total":N}
    async search(query, page, filters) {
        const byUrl = await openByUrl(this, query, (p) => { const m = /\/content\/info\/(\d+)/.exec(p); return m ? this.mangaUrl(m[1]) : null; });
        if (byUrl) return byUrl;
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const flist = withParams(filters, this.tabFilterList());
        const rule = flist.find((f) => f && f.name === TAB_RULE_NAME);
        const r = rule ? Number(rule.state) || 0 : 0;
        if (r === 1 || r === 2) {
            const states = flist.map((f) => (!f || f.name === TAB_RULE_NAME || f.state === undefined || typeof f.state === "object") ? null : f.state);
            this.tabStore(r === 1 ? TAB_KEY_POPULAR : TAB_KEY_LATEST, states);
        }
        if (r === 3 || r === 5) this.tabStore(TAB_KEY_POPULAR, null);
        if (r === 4 || r === 5) this.tabStore(TAB_KEY_LATEST, null);
        if (!String(query || "").trim()) return this.categoryList(page, flist);
        const q = (query || "").trim();
        const pageUrl = `${this.base}/mb/top_search?subject=${encodeURIComponent(q)}`;
        try {
            const res = await this.req(pageUrl, this.hdr());
            const t = new Document(res.body).selectFirst("meta[name='_token']")?.attr("content");
            if (t) this._token = t;
        } catch (e) {
            // 토큰은 /mb 에서 다시 시도
        }
        const token = await this.token();
        const headers = await this.apiHeaders(pageUrl);
        headers["Origin"] = this.base;
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        const body = `subject=${encodeURIComponent(q)}&page=${page}&pagerow=${T11_SEARCH_ROW}` + (token ? `&_token=${encodeURIComponent(token)}` : "");
        let json = null;
        try {
            json = this.parseJson((await this.req(`${this.base}/mb/top_search`, headers, true, body)).body);
        } catch (e) {
            json = null;
        }
        const items = [];
        this.collect(json, items);
        const list = this.toList(items);
        const total = json && json.total ? Number(json.total) : -1;
        return { list, hasNextPage: items.length >= T11_SEARCH_ROW && (total < 0 || page * T11_SEARCH_ROW < total) };
    }

    // ---------- 상세 + 회차 (t3) ----------
    async getDetail(url) {
        const id = this.mangaId(url) || String(url).replace(/\D+/g, "");
        const json = await this.api("/iapi/t3", {
            usercode: T11_USER, menucode: T11_VIEW, parent: id, ordertype: 1
        }, this.base + this.mangaUrl(id));
        const data = this.sucData(json) || {};
        const toon = data.ToonData || {};
        const subject = String(toon.subject || "").trim();

        const chapters = [];
        const seen = {};
        for (const o of data.ToonList || []) {
            const cid = String(o.id || "");
            if (!cid || seen[cid]) continue;
            seen[cid] = true;
            const full = String(o.subject || "").trim();
            // 사이트와 같이 회차 제목에서 작품 제목을 뺌 ("Re: 열혈강호 14권" → "Re: 14권")
            const name = (subject ? full.split(subject).join("") : full).replace(/\s+/g, " ").trim() || full;
            const d = String(o.datetime || "").match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
            chapters.push({
                name,
                url: `/mb/content/image/${cid}?page=toon&parent_id=${o.parentid || id}`,
                dateUpload: d ? String(new Date(`${d[1]}T${d[2]}+09:00`).valueOf()) : null
            });
        }
        if (!chapters.length) throw new Error("11toon 회차 목록을 불러오지 못했습니다");
        chapters.reverse(); // 사이트는 1화부터 → 최신화가 위로

        const end = String(toon.end || "");
        let status = 5;
        if (end.includes("완결")) status = 1;
        else if (/연재|주간|월간|격주/.test(end)) status = 0;
        const img = this.imageOf(toon);
        return {
            name: subject,
            imageUrl: img || this.coverFor(id),
            author: String(toon.maker || "").trim(),
            description: String(toon.memo || "").trim(),
            genre: String(toon.caname || "").split(/[,\/]/).map(s => s.trim()).filter(s => s),
            status,
            chapters: orderChapters(chapters, subject)
        };
    }

    // ---------- 이미지 (t5 → 실패하면 회차 페이지를 열어 세션을 만든 뒤 재시도) ----------
    async t5(cid, parent, referer) {
        const json = await this.api("/iapi/t5", { id: cid, parent: parent }, referer);
        const image = (this.sucData(json) || {}).Image;
        if (!image) return [];
        let arr = image.imagelist;
        if (typeof arr === "string") {
            try {
                arr = JSON.parse(arr);
            } catch (e) {
                arr = [];
            }
        }
        if (!Array.isArray(arr)) return [];
        const file = image.file || "";
        return arr.filter(x => x).map(x => /^(https?:)?\/\//.test(x) ? this.abs(x) : this.abs(file + x));
    }

    async getPageList(url) {
        const pageUrl = this.abs(url);
        const cid = (pageUrl.match(/\/content\/image\/(\d+)/) || [])[1];
        const parent = (pageUrl.match(/[?&]parent_id=(\d+)/) || [])[1] || "";
        if (!cid) throw new Error("잘못된 회차 주소");

        let urls = [];
        let html = "";
        for (let attempt = 0; attempt < 3 && !urls.length; attempt++) {
            urls = await this.t5(cid, parent, pageUrl);
            if (urls.length) break;
            if (attempt === 0) {
                try {
                    html = (await this.req(pageUrl, this.hdr())).body;
                    const t = new Document(html).selectFirst("meta[name='_token']")?.attr("content");
                    if (t) this._token = t;
                } catch (e) {
                    html = "";
                }
            }
        }
        if (!urls.length && html) {
            for (const img of new Document(html).select("#ImageShow img")) {
                const s = img.attr("src");
                if (s) urls.push(this.abs(s));
            }
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.filter((u, i) => urls.indexOf(u) === i).map(u => ({ url: u, headers: { "Referer": pageUrl } }));
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
        return statusFilters("toon11", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어를 입력하면 필터는 무시됩니다" },
            sel("장르", "SType", T11_GENRES.map((n, i) => [n, String(i)])),
            sel("국가", "SCountry", [["전체", "0"], ["일본만화", "2"]]),
            sel("연재", "SEnd", [["전체", "0"], ["연재만화", "1"], ["완결만화", "2"]])
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
            if (f.type_name === "SelectFilter" && f.values[s] && s > 0) parts.push(`${f.name} ${f.values[s].name}`);
        });
        return parts.join(" / ") || "전체";
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

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://11toon3.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 11toon1~30.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

// 필터 목록에서 맨 위 상태 줄을 빼고, 앱이 넘겨준 필터에 빠진 param 을 원래 목록에서 채움
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

// ---------- 앱 기본 User-Agent 사용 ----------
// 망가요미는 내장 웹뷰에서 Cloudflare 확인을 통과하면 쿠키와 그 웹뷰의 User-Agent 를 함께 저장하고,
// 요청에 User-Agent 가 없을 때만 그 값을 넣는다. 확장이 고정 User-Agent 를 보내면 통과 쿠키가 거부되므로
// 사이트(문서·API) 요청에서는 확장의 User-Agent 를 빼고 앱 값을 쓰게 한다. 영상·이미지 주소 요청은 그대로 둔다.
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
