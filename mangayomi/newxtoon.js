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
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "newxtoon.js"
}];

// newxtoon 웹툰 - Aniyomi 확장(NewXtoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        const res = await this.client.get(url, headers || this.getHeaders(url));
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
                title: "도메인 주소",
                summary: "사이트 주소가 바뀌면 여기서 변경 (예: https://newxtoon2.com)",
                value: this.source.baseUrl,
                dialogTitle: "도메인 주소",
                dialogMessage: ""
            }
        }];
    }
}
