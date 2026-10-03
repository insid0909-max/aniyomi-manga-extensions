const mangayomiSources = [{
    "id": 870214002,
    "name": "Goodtoon 웹툰",
    "lang": "ko",
    "baseUrl": "https://www.goodtoon006.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.2.3",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "goodtoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?goodtoon\d+\.com$/;
const AUTO_NUM = /goodtoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "goodtoon";

// Goodtoon 웹툰 - Aniyomi 확장(Goodtoon.kt)과 같은 구조를 망가요미용으로 옮김
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
        const www = current.includes("://www.") ? "www." : "";
        const out = [];
        for (let i = 1; i <= 60; i++) out.push(`https://${www}goodtoon${String(i).padStart(3, "0")}.com`);
        return out;
    }

    async autoGuide(current) {
        return null;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/" };
    }

    /** 실제 요청용 헤더 (현재 도메인 기준) */
    hdr(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/" };
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

    async get(url, headers) {
        return (await this.req(url, headers || this.hdr(url))).body;
    }

    // ---------- 목록 ----------
    listUrl(path, page, q, extra) {
        const parts = [];
        if (q) parts.push(`q=${encodeURIComponent(q)}`);
        for (const k in extra || {}) if (extra[k]) parts.push(`${k}=${encodeURIComponent(extra[k])}`);
        if (page > 1) parts.push(`pg=${page}`);
        return this.base + path + (parts.length ? "?" + parts.join("&") : "");
    }

    parseList(html, page) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a.card[href*='/manga/gt-']")) {
            const link = this.path(a.attr("href"));
            if (seen[link]) continue;
            seen[link] = true;
            const name = (a.selectFirst(".subject")?.text || "").trim();
            if (!name) continue;
            let imageUrl = "";
            for (const img of a.select(".thumb img")) {
                if ((img.className || "").includes("platform-icon")) continue;
                imageUrl = this.abs(img.attr("src"));
                break;
            }
            list.push({ name, imageUrl, link });
        }
        let maxPg = 0;
        let hasNextText = false;
        for (const a of doc.select(".pagination a.page-numbers")) {
            const m = (a.attr("href") || "").match(/pg=(\d+)/);
            if (m) maxPg = Math.max(maxPg, parseInt(m[1]));
            if (a.text.includes("다음")) hasNextText = true;
        }
        const hasNextPage = doc.selectFirst(".pagination a.next") != null || maxPg > page || hasNextText;
        return { list, hasNextPage };
    }

    async getPopular(page) {
        return this.parseList(await this.get(this.listUrl("/recommend/", page)), page);
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.get(this.listUrl("/", page)), page);
    }

    async search(query, page, filters) {
        if (query && query.trim()) return this.parseList(await this.get(this.listUrl("/", page, query.trim())), page);
        let path = "/";
        const extra = {};
        for (const f of filters || []) {
            if (f.type_name !== "SelectFilter" || !f.param) continue;
            const v = f.values[f.state].value;
            if (f.param === "list") path = v; else extra[f.param] = v;
        }
        return this.parseList(await this.get(this.listUrl(path, page, null, extra)), page);
    }

    // ---------- 상세 + 회차 ----------
    parseChapters(html) {
        const doc = new Document(html);
        const seen = {};
        const chapters = [];
        for (const li of doc.select("li.wp-manga-chapter")) {
            const a = li.selectFirst("a");
            if (!a) continue;
            const url = this.path(a.attr("href"));
            if (!url || seen[url]) continue;
            seen[url] = true;
            const d = (li.selectFirst(".chapter-release-date")?.text || "").trim().match(/(\d{2})\.(\d{2})\.(\d{2})/);
            chapters.push({
                name: a.text.trim().replace(/^UP/, "").trim(),
                url,
                dateUpload: d ? String(new Date(`20${d[1]}-${d[2]}-${d[3]}T00:00:00+09:00`).valueOf()) : null
            });
        }
        return chapters;
    }

    async getDetail(url) {
        const pageUrl = this.abs(url);
        const html = await this.get(pageUrl);
        const doc = new Document(html);
        const st = doc.select(".summary-meta-row .meta-value").map(e => e.text.trim());
        let status = 5;
        if (st.some(t => t.includes("완결"))) status = 1;
        else if (st.some(t => t.includes("연재"))) status = 0;
        const genre = (doc.selectFirst(".manga-summary-genres")?.text || "")
            .split(/[\/,]/).map(s => s.trim()).filter(s => s);

        // 회차 목록은 작품 주소 뒤 /ajax/chapters/ 로 POST (Madara 테마 방식)
        let chapters = [];
        try {
            const res = await this.req(pageUrl.replace(/\/+$/, "") + "/ajax/chapters/?t=1", {
                "Referer": pageUrl,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": this.base,
                "Accept": "text/html, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            }, true, "");
            chapters = this.parseChapters(res.body);
        } catch (e) {
            chapters = [];
        }
        if (!chapters.length) chapters = this.parseChapters(html);

        return {
            name: (doc.selectFirst("h1.summary-title")?.text || "").trim(),
            imageUrl: this.abs(doc.selectFirst(".manga-summary-cover img")?.attr("src")) ||
                (doc.selectFirst("meta[property='og:image']")?.attr("content") || ""),
            description: (doc.selectFirst("#manga-desc")?.text || "").trim(),
            genre,
            status,
            chapters
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const pageUrl = this.abs(url);
        const res = await this.req(pageUrl, this.hdr(pageUrl));
        const html = String(res.body || "").replace(/\\\//g, "/");
        const re = /https?:\/\/[^"'\s\\<>]+?\/gt-\d+\/(?:ch-)?\d+\/\d+\.(?:jpe?g|png|webp|gif|avif)/gi;
        let urls = [];
        let m;
        while ((m = re.exec(html)) !== null) if (urls.indexOf(m[0]) < 0) urls.push(m[0]);
        const doc = new Document(html);
        if (!urls.length) {
            // 본문(.reading-content) 이미지 또는 주소가 /gt-작품/회차/ 형태인 이미지
            const inReader = doc.select(".reading-content img, .page-break img, #readerarea img");
            const pool = inReader.length ? inReader : doc.select("img");
            for (const img of pool) {
                const raw = (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src") || "").trim();
                if (!raw || raw.startsWith("data:")) continue;
                const u = this.abs(raw);
                if ((inReader.length || /\/gt-\d+\/(?:ch-)?\d+\//.test(u)) && urls.indexOf(u) < 0) urls.push(u);
            }
        }
        const num = u => parseInt((u.match(/\/(\d+)\.[a-z]+$/i) || [0, 0])[1]);
        if (urls.every(u => /\/(?:ch-)?\d+\/\d+\.[a-z]+$/i.test(u))) urls.sort((a, b) => num(a) - num(b));
        if (!urls.length) {
            const title = (doc.selectFirst("title")?.text || "").trim().substring(0, 40);
            throw new Error(`이미지를 찾을 수 없습니다 (HTTP ${res.statusCode}, 제목: ${title || "없음"}, img ${doc.select("img").length}개)`);
        }
        return urls.map(u => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    getFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어가 없을 때만 적용" },
            sel("목록", "list", [["전체(최신)", "/"], ["인기순", "/recommend/"], ["연재중", "/ongoing/"], ["완결", "/end/"]]),
            sel("분류", "mcat", [["전체", ""], ["일반웹툰", "webtoon"], ["BL/GL", "bl-gl"], ["성인웹툰", "adult"]]),
            sel("요일", "mday", [["전체", ""], ["월", "mon"], ["화", "tue"], ["수", "wed"], ["목", "thu"], ["금", "fri"], ["토", "sat"], ["일", "sun"], ["기타", "etc"]]),
            sel("장르", "genre", [["전체", ""], ["학원", "school"], ["액션", "action"], ["SF", "sci-fi"], ["스토리", "story"], ["판타지", "fantasy"], ["BL", "bl"], ["개그", "gag"], ["연애", "romance-drama"], ["드라마", "drama"], ["로맨스", "romance"], ["시대극", "period"], ["스포츠", "sports"], ["일상", "slice-of-life"], ["추리", "mystery"], ["공포", "horror"], ["성인", "adult"], ["무협", "martial-arts"], ["하렘", "harem"], ["백합", "yuri"]]),
            sel("플랫폼", "plat", [["전체", ""], ["네이버", "naver"], ["다음", "daum"], ["카카오", "kakao"], ["레진", "rejin"], ["투믹스", "tomics"], ["탑툰", "toptoon"], ["리디", "ridi"], ["봄툰", "bom"], ["기타", "etc"]])
        ];
    }

    getSourcePreferences() {
        return [{
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://www.goodtoon007.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 goodtoon001~060.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}
