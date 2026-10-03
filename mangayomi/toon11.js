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
    "version": "0.2.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "toon11.js"
}];

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

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
        this.coverBase = "https://11toon8.com/data/toon_category/";
    }

    // ---------- 도메인: 수동 주소 > 자동으로 찾은 주소 > 기본 주소 ----------
    cleanUrl(v) {
        v = String(v || "").trim().replace(/\/+$/, "");
        return /^https?:\/\/[^\s/]+$/.test(v) ? v : "";
    }

    get base() {
        const prefs = new SharedPreferences();
        const manual = this.cleanUrl(prefs.get("domain"));
        if (manual && manual !== this.source.baseUrl) return manual;
        return this.cleanUrl(prefs.getString("auto_domain", "")) || this.source.baseUrl;
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
        const out = [];
        for (let i = 1; i <= 30; i++) out.push(`https://11toon${i}.com`);
        return out;
    }

    async autoGuide(current) {
        return null;
    }

    getHeaders(url) {
        return { "Referer": this.base + "/mb" };
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
            const res = await this.req(this.base + "/mb", this.getHeaders());
            const t = new Document(res.body).selectFirst("meta[name='_token']")?.attr("content");
            if (t) this._token = t;
        } catch (e) {
            // 토큰 없이 진행
        }
        return this._token || "";
    }

    async apiHeaders(referer) {
        const h = {
            "Referer": referer,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
        };
        const t = await this.token();
        if (t) h["X-CSRF-TOKEN"] = t;
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

    async api(path, params, referer) {
        const q = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
        try {
            const res = await this.req(`${this.base}${path}?${q}`, await this.apiHeaders(referer));
            return this.parseJson(res.body);
        } catch (e) {
            return null;
        }
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
        const res = await this.req(this.base + "/mb", this.getHeaders());
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
        return (await this.ranking(T11_TOP, page)) || this.mainPage(page);
    }

    async getLatestUpdates(page) {
        return (await this.ranking(T11_NEW, page)) || this.mainPage(page);
    }

    // 검색: 검색 페이지를 연 뒤(토큰) POST /mb/top_search → {"data":[...],"total":N}
    async search(query, page, filters) {
        const q = (query || "").trim();
        const pageUrl = `${this.base}/mb/top_search?subject=${encodeURIComponent(q)}`;
        try {
            const res = await this.req(pageUrl, this.getHeaders());
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
            chapters
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
                    html = (await this.req(pageUrl, this.getHeaders())).body;
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

    getFilterList() {
        return [];
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
