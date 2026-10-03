const mangayomiSources = [{
    "id": 870214003,
    "name": "Jjaptoon 웹툰",
    "lang": "ko",
    "baseUrl": "https://www.jjaptoon008.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "jjaptoon.js"
}];

// Jjaptoon 웹툰 - Aniyomi 확장(Jjaptoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        return {
            "Referer": this.base + "/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        };
    }

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "");
    }

    imgUrl(img) {
        if (!img) return "";
        return this.abs(img.attr("data-original") || img.attr("data-src") || img.attr("src"));
    }

    async get(url, headers) {
        return (await this.client.get(url, headers || this.getHeaders(url))).body;
    }

    query(params) {
        const q = [];
        for (const k in params) if (params[k]) q.push(`${k}=${encodeURIComponent(params[k])}`);
        return q.length ? "?" + q.join("&") : "";
    }

    // ---------- 목록 ----------
    homeUrl(page, params) {
        const p = Object.assign({}, params);
        if (page > 1) p.comicsPage = String(page);
        return this.base + "/" + this.query(p);
    }

    statusOf(text) {
        if ((text || "").includes("완결")) return 1;
        if ((text || "").includes("연재")) return 0;
        return 5;
    }

    parseList(html) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("div.grid a[href*='/comics/']")) {
            const img = a.selectFirst("img");
            if (!img) continue;
            const link = this.path(a.attr("href"));
            if (seen[link]) continue;
            seen[link] = true;
            const name = (a.selectFirst("h2")?.text || img.attr("alt") || "").trim();
            if (!name) continue;
            list.push({ name, imageUrl: this.imgUrl(img), link });
        }
        let hasNextPage = doc.selectFirst("a[aria-label='Next page']") != null || doc.selectFirst("a[rel=next]") != null;
        if (!hasNextPage) {
            for (const b of doc.select("button")) {
                if ((b.attr("wire:click") || "").startsWith("nextPage") && b.attr("disabled") == null) { hasNextPage = true; break; }
            }
        }
        return { list, hasNextPage: hasNextPage && list.length > 0 };
    }

    async getPopular(page) {
        return this.parseList(await this.get(this.homeUrl(page, { selectedSort: "popular" })));
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.get(this.homeUrl(page, {})));
    }

    async search(query, page, filters) {
        const params = {};
        let popular = false;
        for (const f of filters || []) {
            if (f.type_name !== "SelectFilter" || !f.param) continue;
            const v = f.values[f.state].value;
            if (f.param === "selectedSort") popular = v === "popular";
            else if (v) params[f.param] = v;
        }
        const q = (query || "").trim();
        // 인기순은 메인 페이지에서만 지원 (검색어/상태 필터와 함께 쓸 수 없음)
        if (popular && !q && !params.selectedStatus) {
            params.selectedSort = "popular";
            return this.parseList(await this.get(this.homeUrl(page, params)));
        }
        const p = Object.assign({}, q ? { search: q } : {}, params);
        if (page > 1) p.page = String(page);
        return this.parseList(await this.get(this.base + "/comics" + this.query(p)));
    }

    // ---------- 상세 + 회차 ----------
    async getDetail(url) {
        const doc = new Document(await this.get(this.abs(url)));
        const title = (doc.selectFirst("h1")?.text || "").trim();
        const badges = doc.select("section div.flex.flex-wrap.justify-center.gap-2 span").map(e => e.text.trim());

        let cover = "";
        for (const img of doc.select("section img[alt]")) {
            if (!cover) cover = this.imgUrl(img);
            if (img.attr("alt") === title) { cover = this.imgUrl(img); break; }
        }
        let description = "";
        for (const sec of doc.select("section")) {
            if ((sec.selectFirst("h2")?.text || "").includes("작품 소개")) {
                description = (sec.selectFirst("p")?.text || "").trim();
                break;
            }
        }
        let author = "";
        for (const p of doc.select("p")) {
            if (p.text.includes("작가:")) { author = (p.selectFirst("span")?.text || "").trim(); break; }
        }

        const all = doc.select("a[href*='/chapters/']");
        let rows = all.filter(a => (a.attr("wire:key") || "").startsWith("comic-"));
        if (!rows.length) rows = all;
        const seen = {};
        const chapters = [];
        for (const a of rows) {
            const link = this.path(a.attr("href"));
            if (!link || seen[link]) continue;
            seen[link] = true;
            const ps = a.select("p").map(e => e.text.trim());
            let dateUpload = null;
            for (const t of ps.slice(1)) {
                const m = t.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
                if (m) { dateUpload = String(new Date(`${m[1]}T${m[2] || "00:00"}:00+09:00`).valueOf()); break; }
            }
            chapters.push({ name: ps[0] || a.text.trim(), url: link, dateUpload });
        }

        return {
            name: title,
            imageUrl: cover,
            description,
            author,
            genre: badges.filter(b => b.length > 1 && ["완결", "연재", "휴재"].indexOf(b) < 0),
            status: this.statusOf(badges.join(" ")),
            chapters
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const pageUrl = this.abs(url);
        const doc = new Document(await this.get(pageUrl, Object.assign(this.getHeaders(pageUrl), { "Referer": pageUrl })));
        const urls = [];
        for (const img of doc.select("[data-reading-image-index] > img")) {
            if ((img.attr("alt") || "").includes("광고문의")) continue;
            let u = this.imgUrl(img);
            if (!u) {
                const m = (img.attr(":src") || "").match(/loaded\s*\?\s*'([^']+)'/);
                if (m) u = this.abs(m[1]);
            }
            if (u && urls.indexOf(u) < 0) urls.push(u.replace(/ /g, "%20"));
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.map(u => ({ url: u, headers: { "Referer": pageUrl } }));
    }

    getFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "인기순은 검색어/상태 필터와 함께 쓸 수 없음" },
            sel("정렬", "selectedSort", [["최신순", "latest"], ["인기순", "popular"]]),
            sel("분류", "selectedType", [["전체", ""], ["일반", "general"], ["성인", "adult"], ["BL", "bl"]]),
            sel("상태", "selectedStatus", [["전체", ""], ["연재", "ongoing"], ["완결", "completed"], ["휴재", "paused"]]),
            sel("요일", "selectedSchedule", [["전체", ""], ["월", "monday"], ["화", "tuesday"], ["수", "wednesday"], ["목", "thursday"], ["금", "friday"], ["토", "saturday"], ["일", "sunday"]]),
            sel("장르", "selectedCategory", [["전체", ""], ["액션", "1"], ["일상", "3"], ["BL/백합", "10"], ["로맨스", "4"], ["SF/판타지", "2"], ["개그", "5"], ["학원", "6"], ["스토리", "8"], ["판타지", "9"], ["연애/순정", "12"], ["드라마", "13"], ["시대극", "14"], ["스포츠", "15"], ["추리/미스터리", "16"], ["공포/스릴러", "17"], ["성인", "18"], ["무협", "21"], ["소년", "22"], ["기타", "23"]]),
            sel("플랫폼", "selectedPublisher", [["전체", ""], ["네이버", "naver"], ["다음", "daum"], ["카카오", "kakao"], ["레진", "lezhin"], ["투믹스", "toomics"], ["탑툰", "toptoon"], ["리디", "ridi"], ["봄툰", "bomtoon"], ["기타", "other"]])
        ];
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소",
                summary: "사이트 주소가 바뀌면 여기서 변경 (예: https://www.jjaptoon009.com)",
                value: this.source.baseUrl,
                dialogTitle: "도메인 주소",
                dialogMessage: ""
            }
        }];
    }
}
