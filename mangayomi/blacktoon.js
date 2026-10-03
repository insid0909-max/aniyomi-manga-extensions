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
    "version": "0.3.0",
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
const BT_POSTER = "https://ttjsde.speedwebgo.com/";
const BT_CDN = "https://aa3cc9.speedwebgo.com/";
const BT_DATA_HOSTS = ["https://ttjsde.speedwebgo.com", "https://jsc.speedwebgo.com"];
const BT_VARS = "inc_url2|inc_url1|inc_url3|inc_url|poster_js|img_domain[2-8]?|img_per[3-8]|toonlistid|uptime|servtime";
const BT_PLATFORMS = { 1: "네이버", 2: "다음", 3: "카카오", 4: "레진", 5: "투믹스", 6: "탑툰", 7: "코미카", 8: "배틀코믹", 9: "코믹GT", 10: "케이툰", 11: "애니툰", 12: "폭스툰", 13: "피너툰", 14: "봄툰", 15: "코미코", 16: "무툰", 17: "지존신마", 99: "기타" };
const BT_TAGS = { 1: "학원", 2: "액션", 3: "SF", 4: "스토리", 5: "판타지", 6: "BL/백합", 7: "개그/코미디", 8: "연애/순정", 9: "드라마", 10: "로맨스", 11: "시대극", 12: "스포츠", 13: "일상", 14: "추리/미스터리", 15: "공포/스릴러", 16: "성인", 17: "옴니버스", 18: "에피소드", 19: "무협", 20: "소년", 99: "기타" };
const BT_DAYS = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일", 10: "열흘" };

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
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
        const h = { "Referer": referer || (this.base + "/"), "Origin": this.base };
        const res = await this.req(url, h);
        if (res.statusCode && res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
        return res.body;
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
        this.readVars(html, vars);
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
    async catalog() {
        const now = Date.now();
        if (this._cat && now - this._catAt < 15 * 60 * 1000) return this._cat;
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
        return { name: s.title, imageUrl: img, link: s.id };
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

    async getPopular(page) {
        return this.browse(page, { order: 1, status: -1, platform: -1, day: -1, tag: -1 });
    }

    async getLatestUpdates(page) {
        return this.browse(page, { order: 0, status: -1, platform: -1, day: -1, tag: -1 });
    }

    async search(query, page, filters) {
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
                    url: (o.u || "").replace(/^\/webtoons\//, "").replace(/\.html$/, "") || `${id}/${o.id}`,
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
            chapters
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
        const pageUrl = `${this.base}/webtoons/${url}.html`;
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

    getFilterList() {
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
