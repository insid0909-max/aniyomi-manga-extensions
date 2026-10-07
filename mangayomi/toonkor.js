const mangayomiSources = [{
    "id": 870214009,
    "name": "툰코 웹툰",
    "lang": "ko",
    "baseUrl": "https://toonkor2.org",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.1.4",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "toonkor.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(?:www\.)?toonkor\d+\.[a-z]{2,6}$/;
const AUTO_NUM = /toonkor(\d+)/;
const GENRES = ["드라마", "판타지", "액션", "로맨스", "일상", "개그", "미스터리", "순정", "스포츠", "BL", "스릴러", "무협", "학원", "공포", "스토리"];
// 작품 주소로 오인하지 않을 사이트 메뉴
const NON_TITLE = ["웹툰", "망가", "단행본", "포토툰", "소설", "애니", "TV", "notice", "bbs", "코사이트", "주소안내", "토토보증업체"];

// 툰코 - Aniyomi 확장(Toonkor.kt)과 같은 구조를 망가요미용으로 옮김
// 회차의 그림 목록은 페이지 안 toon_img 값(base64 로 감싼 img 태그)에 들어 있다
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
    async req(url, headers) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        try {
            const res = await this.client.get(url, headers || {});
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
        const tld = (current.match(/\.([a-z]{2,6})$/) || [0, "org"])[1];
        for (let i = Math.max(1, cur - 2); i <= cur + 30; i++) {
            const c = `https://toonkor${i}.${tld}`;
            if (c !== current) cands.push(c);
        }
        const hits = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes("툰코") ? c : null;
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

    async get(url) {
        const res = await this.req(url, this.hdr());
        return String(res.body || "");
    }

    /** 사이트 주소의 한글 경로를 그대로 쓰도록 (주소창 모양 %EC.. 은 한글로 풀어 저장) */
    path(u) {
        let p = (u || "").replace(/^https?:\/\/[^/]+/, "").replace(/&amp;/g, "&");
        try {
            p = decodeURIComponent(p.replace(/\+/g, "%2B"));
        } catch (e) {
            // 그대로
        }
        return p;
    }

    /** 경로를 주소로 (한글은 주소 모양으로) */
    url(p) {
        return this.base + encodeURI(p);
    }

    // ---------- 목록 ----------
    /** /분류[/목록]?fil=정렬·장르&wpage=N */
    listUrl(section, list, fil, page) {
        let u = this.base + "/" + encodeURIComponent(section) + (list ? "/" + encodeURIComponent(list) : "");
        const q = [];
        if (fil) q.push("fil=" + encodeURIComponent(fil));
        if (page > 1) q.push("wpage=" + page);
        return u + (q.length ? "?" + q.join("&") : "");
    }

    /** 목록·검색 공통 카드 (.section-item-inner) */
    parseList(html, page) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const item of doc.select(".section-item-inner")) {
            const a = item.selectFirst("a#title") || item.selectFirst(".section-item-title a");
            if (!a) continue;
            const link = this.path(a.attr("href"));
            if (link.length < 2 || link.indexOf(".html") >= 0 || seen[link]) continue;
            seen[link] = true;
            const name = (a.selectFirst("h3")?.text || item.attr("alt") || "").trim();
            if (!name) continue;
            const img = item.selectFirst(".section-item-photo img");
            list.push({ name, imageUrl: this.imgUrl(img), link });
        }
        // 다음 쪽: 지금 쪽보다 큰 wpage 링크가 있으면
        let maxPg = 0;
        for (const a of doc.select("a")) {
            const m = (a.attr("href") || "").match(/[?&]wpage=(\d+)/);
            if (m) maxPg = Math.max(maxPg, parseInt(m[1], 10));
        }
        return { list, hasNextPage: list.length > 0 && maxPg > page };
    }

    async basePopular(page) {
        return this.parseList(await this.get(this.listUrl("웹툰", "", "인기", page)), page);
    }

    async baseLatest(page) {
        return this.parseList(await this.get(this.listUrl("웹툰", "", "최신", page)), page);
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            const u = `${this.base}/bbs/search.php?sfl=${encodeURIComponent("wr_subject||wr_content")}&stx=${encodeURIComponent(query.trim())}` + (page > 1 ? `&wpage=${page}` : "");
            return this.parseList(await this.get(u), page);
        }
        const v = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param && f.values && f.values[f.state]) v[f.param] = f.values[f.state].value;
        }
        const section = v.section || "웹툰";
        // 연재·완결·요일 목록은 웹툰에만 있음
        const list = section === "웹툰" ? (v.list || "") : "";
        return this.parseList(await this.get(this.listUrl(section, list, v.fil || "", page)), page);
    }

    // ---------- 상세 + 회차 (최신순, 한 페이지) ----------
    // 늦게 불러오는 카드는 src 가 빈 그림(data:)이고 진짜 주소는 data-src 에 있음
    imgUrl(img) {
        if (!img) return "";
        const raw = [img.attr("data-src"), img.attr("data-original"), img.attr("src")]
            .map((x) => (x || "").trim()).find((x) => x && !x.startsWith("data:"));
        return raw ? this.abs(raw) : "";
    }

    async getDetail(url) {
        const detailPath = this.path(url);
        const doc = new Document(await this.get(this.url(detailPath)));
        // 라벨(작가·총편수·장르)과 값이 같은 칸 안에 차례로 있음
        const fields = {};
        for (const cell of doc.select("td.bt_label")) {
            const labels = cell.select("span.bt_label");
            const values = cell.select("span.bt_data");
            labels.forEach((l, i) => { if (values[i]) fields[(l.text || "").trim()] = (values[i].text || "").trim(); });
        }
        const field = (label) => fields[label] || "";
        // 날짜 칸도 회차와 같은 data-role 을 가짐
        const dates = {};
        for (const td of doc.select("td.episode__index")) {
            const dm = (td.text || "").trim().match(/(\d{4})-(\d{2})-(\d{2})/);
            if (dm) dates[this.path(td.attr("data-role"))] = String(new Date(`${dm[1]}-${dm[2]}-${dm[3]}T00:00:00+09:00`).valueOf());
        }
        const chapters = [];
        const seen = {};
        for (const td of doc.select("td.content__title")) {
            const p = this.path(td.attr("data-role"));
            if (!p.endsWith(".html") || seen[p]) continue;
            seen[p] = true;
            const n = (td.selectFirst(".ep-n")?.text || "") + (td.selectFirst(".ep-s")?.text || "");
            chapters.push({
                name: n.trim() || (td.attr("alt") || td.text || "").trim(),
                url: p,
                dateUpload: dates[p] || null
            });
        }
        // 최근 회차가 3주 안이면 연재 중, 오래됐으면 완결로 봄 (0 연재, 1 완결, 5 알 수 없음)
        const latest = chapters.length && chapters[0].dateUpload ? Number(chapters[0].dateUpload) : 0;
        const status = !latest ? 5 : (Date.now() - latest <= 21 * 86400000 ? 0 : 1);
        const img = doc.selectFirst("td.bt_thumb img");
        const over = (doc.selectFirst("td.bt_over")?.text || "").trim();
        const total = field("총편수");
        return {
            name: (doc.selectFirst("td.bt_title")?.text || "").trim(),
            imageUrl: this.imgUrl(img),
            author: field("작가"),
            description: [over, total].filter((x) => x).join("\n\n"),
            genre: field("장르").split("/").map((g) => g.trim()).filter((g) => g),
            status,
            link: this.url(detailPath),
            chapters: orderChapters(chapters)
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const html = await this.get(this.url(this.path(url)));
        // toon_img: img 태그 묶음을 base64 로 감싼 값 (사이트 스크립트도 그대로 풀어서 화면에 넣음)
        const m = /var\s+toon_img\s*=\s*'([A-Za-z0-9+/=]+)'/.exec(html);
        const inner = m ? b64ToUtf8(m[1]) : "";
        const doc = new Document(inner || html);
        const imgs = inner ? doc.select("img") : doc.select("#toon_img img");
        const urls = [];
        for (const img of imgs) {
            const raw = [img.attr("data-src"), img.attr("data-original"), img.attr("src")]
                .map((s) => (s || "").trim()).find((s) => s && !s.startsWith("data:"));
            if (!raw) continue;
            const u = this.abs(raw.replace(/&amp;/g, "&"));
            if (urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) {
            const title = (new Document(html).selectFirst("title")?.text || "").trim().substring(0, 40);
            throw new Error(`이미지를 찾을 수 없습니다 (제목: ${title || "없음"})`);
        }
        return urls.map((u) => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어가 없을 때만 적용" },
            sel("분류", "section", [["웹툰", "웹툰"], ["망가", "망가"], ["단행본", "단행본"], ["포토툰", "포토툰"]]),
            sel("목록 (웹툰)", "list", [["전체", ""], ["연재", "연재"], ["완결", "완결"], ["업데이트", "업데이트"], ["월", "월"], ["화", "화"], ["수", "수"], ["목", "목"], ["금", "금"], ["토", "토"], ["일", "일"], ["열흘", "열흘"]]),
            sel("정렬·장르", "fil", [["기본", ""], ["최신순", "최신"], ["인기순", "인기"], ["제목순", "제목"], ["성인", "성인"]].concat(GENRES.map((g) => ["장르: " + g, g])))
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
        const byUrl = await openByUrl(this, query, (p) => { let seg = p.split(/[?#]/)[0].split("/").filter((x) => x)[0] || ""; try { seg = decodeURIComponent(seg); } catch (e) {} if (!seg || NON_TITLE.includes(seg)) return null; if (seg.endsWith(".html")) seg = seg.split("_")[0]; return seg ? "/" + seg : null; });
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
        return statusFilters("toonkor", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://toonkor3.org)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 toonkor#.org 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

// base64 → UTF-8 글자 (망가요미 엔진에 atob 이 없을 수 있어 직접 풂)
function b64ToUtf8(b64) {
    const tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    let buf = 0, bits = 0;
    for (const ch of clean) {
        buf = (buf << 6) | tbl.indexOf(ch);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buf >> bits) & 0xff);
        }
    }
    let out = "";
    for (let i = 0; i < bytes.length;) {
        const c = bytes[i++];
        let cp;
        if (c < 0x80) cp = c;
        else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (bytes[i++] & 0x3f);
        else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        else cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        out += String.fromCodePoint(cp);
    }
    return out;
}

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
