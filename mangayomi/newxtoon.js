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
    "version": "0.2.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "newxtoon.js"
}];

const AUTO_HOST = /^(www\.)?newxtoon\d*\.com$/;
const AUTO_NUM = /newxtoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "뉴엑스툰";

// newxtoon 웹툰 - Aniyomi 확장(NewXtoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        const out = [];
        for (let i = 1; i <= 40; i++) out.push(`https://newxtoon${i}.com`);
        return out;
    }

    async autoGuide(current) {
        return null;
    }

    getHeaders(url) {
        return { "Referer": this.source.baseUrl + "/" };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "Referer": this.base + "/" };
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

    async getPopular(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "popular" })), page);
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "latest" })), page);
    }

    async search(query, page, filters) {
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
        for (let guard = 0; comicId && guard < 300; guard++) {
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

    getFilterList() {
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
