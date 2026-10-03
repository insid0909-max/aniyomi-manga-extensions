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
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "blacktoon.js"
}];

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

    get base() {
        const v = (new SharedPreferences().get("domain") || "").trim().replace(/\/+$/, "");
        return /^https?:\/\/[^\s/]+$/.test(v) ? v : this.source.baseUrl;
    }

    getHeaders(url) {
        return { "Referer": this.base + "/", "Origin": this.base };
    }

    async get(url, referer) {
        const h = { "Referer": referer || (this.base + "/"), "Origin": this.base };
        const res = await this.client.get(url, h);
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
    async pageScripts(html, pageUrl) {
        const vars = {};
        this.readVars(html, vars);
        try {
            this.readVars(await this.get(`${this.base}/data/config.js?m=${Math.random()}`, pageUrl), vars);
        } catch (e) {
            // config.js 없어도 페이지 변수로 진행
        }
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
        for (const index of [1, 0]) {
            const cands = urls.filter(u => new RegExp(`/(?:webtoon_${index}|data/webtoon/webtoon_${index}_\\d+)\\.js`).test(u.split("?")[0]));
            for (const h of [vars.inc_url2, vars.inc_url1].concat(BT_DATA_HOSTS)) {
                if (h) cands.push(`${h.replace(/\/+$/, "")}/webtoon_${index}.js`);
            }
            let loaded = null;
            for (const u of cands) {
                try {
                    const body = await this.get(u, pageUrl);
                    const m = body.match(new RegExp(`data${index}\\s*=\\s*(\\[[\\s\\S]*\\])`));
                    if (!m) continue;
                    const arr = JSON.parse(m[1]);
                    if (arr.length) { loaded = arr; break; }
                } catch (e) {
                    // 다음 후보
                }
            }
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

        let meta = null;
        try {
            meta = (await this.catalog()).find(s => s.id === id) || null;
        } catch (e) {
            meta = null;
        }
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

        return {
            name: meta ? meta.title : (doc.selectFirst("h3 b")?.text || "").trim(),
            imageUrl: meta ? this.toManga(meta).imageUrl : (doc.selectFirst("img.thumb2")?.attr("src") || ""),
            author: meta ? meta.author : "",
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
        const html = await this.get(pageUrl);
        const { vars } = await this.pageScripts(html, pageUrl);
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
                title: "도메인 주소",
                summary: "사이트 주소가 바뀌면 여기서 변경 (예: https://blacktoon424.com)",
                value: this.source.baseUrl,
                dialogTitle: "도메인 주소",
                dialogMessage: ""
            }
        }];
    }
}
