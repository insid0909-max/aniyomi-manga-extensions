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
    "version": "0.3.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "jjaptoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?jjaptoon\d{3}\.com$/;
const AUTO_NUM = /jjaptoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "짭툰";
const AUTO_GUIDES = ["https://xn--kd6b44m.net/", "https://xn--kd6b44m.live/", "https://xn--kd6b44m.cc/"];

// Jjaptoon 웹툰 - Aniyomi 확장(Jjaptoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        for (let i = 1; i <= 40; i++) out.push(`https://www.jjaptoon${String(i).padStart(3, "0")}.com`);
        return out;
    }

    /** 공식 안내 사이트(짭툰.net 등)와 그 data/domain.json 에서 최신 주소 확인 */
    async autoGuide(current) {
        for (const g of AUTO_GUIDES) {
            let text = "";
            try {
                text += (await this.client.get(g, {})).body || "";
            } catch (e) {
                continue;
            }
            try {
                text += " " + ((await this.client.get(g + "data/domain.json", { "Accept": "application/json" })).body || "");
            } catch (e) {
                // 안내 페이지 본문만 사용
            }
            const found = this.pickFrom(text, current);
            if (found) return found;
        }
        return null;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA,
            "Referer": this.source.baseUrl + "/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "User-Agent": MOBILE_UA,
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
        return (await this.req(url, headers || this.hdr(url))).body;
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
        const doc = new Document(await this.get(pageUrl, Object.assign(this.hdr(pageUrl), { "Referer": pageUrl })));
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
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://www.jjaptoon009.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 공식 안내 사이트 / jjaptoon001~040.com 에서 새 주소로 자동 변경",
                value: true
            }
        }];
    }
}
