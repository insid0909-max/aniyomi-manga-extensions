const mangayomiSources = [{
    "id": 870214011,
    "name": "네이버웹툰",
    "lang": "ko",
    "baseUrl": "https://comic.naver.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "naverwebtoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MOBILE = "https://m.comic.naver.com";
const HOST = /^(?:m\.)?comic\.naver\.com$/;
const WEEK_KEYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const LISTS = [
    ["전체 요일", "all"], ["월요웹툰", "mon"], ["화요웹툰", "tue"], ["수요웹툰", "wed"], ["목요웹툰", "thu"],
    ["금요웹툰", "fri"], ["토요웹툰", "sat"], ["일요웹툰", "sun"], ["매일+", "dailyPlus"], ["신작", "new"], ["완결", "finished"]
].concat([
    ["로맨스", "PURE"], ["판타지", "FANTASY"], ["액션", "ACTION"], ["일상", "DAILY"], ["스릴러", "THRILL"],
    ["개그", "COMIC"], ["무협/사극", "HISTORICAL"], ["드라마", "DRAMA"], ["감성", "SENSIBILITY"], ["스포츠", "SPORTS"]
].map((g) => ["장르: " + g[0], "genre:" + g[1]]));
const ORDERS = [["인기순", "user"], ["업데이트순", "update"], ["조회순", "view"], ["별점순", "starScore"]];
// 완결 목록은 정렬 값 모양이 다름
const FINISHED_ORDER = { user: "VIEW", update: "UPDATE", view: "VIEW", starScore: "STAR_SCORE" };

// 네이버웹툰 (공식, 무료 회차만) - Aniyomi 확장(NaverWebtoon.kt)과 같은 구조를 망가요미용으로 옮김
// 목록·작품·회차는 사이트가 쓰는 JSON(/api/...)을 읽고, 그림은 모바일 회차 화면(img.toon_image)에서 가져온다.
// 미리보기·유료 회차(charge)는 넣지 않는다.
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

// 사이트로 가는 요청 사이에 최소 간격. 그림 요청은 제외
let lastSiteRequest = 0;
async function siteWait(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/.exec(String(url || ""));
    if (!m || !HOST.test(m[1]) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
    const wait = lastSiteRequest + 150 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSiteRequest = Date.now();
}

function chapterPosition(list, title) {
    try {
        const v = new SharedPreferences().get("chapter_position");
        if (v === false || v === "false") return list;
    } catch (e) {}
    const t = String(title || "").trim();
    return list.map((c, i) => {
        let n = String(c.name || "").trim().replace(/^\d{2,}\s*[-–.:)\]]\s*/, "");
        if (t && n.startsWith(t)) {
            const rest = n.substring(t.length).replace(/^[\s\-–:·.]+/, "");
            if (rest) n = rest;
        }
        return Object.assign({}, c, { name: n + (i === 0 ? " · 마지막" : ` · 남은 ${i}화`) });
    });
}

// 오류를 쉬운 말로 (Aniyomi 확장과 같은 문구)
function friendlyHttp(code) {
    if (code === 403) return "사이트가 접속을 막았어요 (HTTP 403). 오른쪽 위 웹뷰로 한 번 열어 본 뒤 다시 시도해 주세요.";
    if (code === 429) return "요청이 너무 많아 사이트가 잠시 막았어요 (HTTP 429). 1~2분 뒤 다시 시도해 주세요.";
    if (code >= 500 && code <= 599) return `사이트가 지금 응답하지 않아요 (HTTP ${code}). 잠시 뒤 다시 시도해 주세요.`;
    return null;
}

function friendlyError(e) {
    const m = String((e && e.message) || e || "");
    if (/host lookup|UnknownHost|No address associated|nodename nor servname/i.test(m)) return "사이트에 접속할 수 없어요. 인터넷 연결을 확인해 주세요.";
    if (/timed? ?out|timeout/i.test(m)) return "사이트 응답이 너무 늦어요 (시간 초과). 잠시 뒤 다시 시도해 주세요.";
    if (/Connection (refused|reset|closed|failed)|HandshakeException|SocketException|CERTIFICATE/i.test(m)) {
        return "사이트에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 뒤 다시 시도해 주세요.";
    }
    return m;
}

function todayWeek() {
    // 한국 시간 기준 오늘 요일
    const d = new Date(Date.now() + 9 * 3600000).getUTCDay();
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d];
}

// "26.09.13" → 밀리초 (한국 시간)
function dateOf(s) {
    const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(s || "").trim());
    return m ? String(new Date(`20${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`).valueOf()) : null;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
    }

    get base() {
        return this.source.baseUrl;
    }

    showAdult() {
        try {
            const v = new SharedPreferences().get("show_adult");
            return v === true || v === "true";
        } catch (e) {
            return false;
        }
    }

    headers(referer) {
        return { "User-Agent": MOBILE_UA, "Referer": referer || this.base + "/" };
    }

    async req(url, headers) {
        await siteWait(url);
        let res;
        try {
            res = await this.client.get(url, headers || this.headers());
        } catch (e) {
            throw new Error(friendlyError(e));
        }
        const msg = friendlyHttp(res && Number(res.statusCode));
        if (msg) throw new Error(msg);
        return res;
    }

    async json(url) {
        const res = await this.req(url);
        try {
            return JSON.parse(res.body);
        } catch (e) {
            throw new Error(`사이트 응답을 읽지 못했어요 (HTTP ${res.statusCode})`);
        }
    }

    // ---------- 목록 ----------
    listUrl(kind, order, page) {
        if (kind === "new") return `${this.base}/api/webtoon/titlelist/new?order=${order}`;
        if (kind === "finished") return `${this.base}/api/webtoon/titlelist/finished?order=${FINISHED_ORDER[order] || "VIEW"}&page=${page}`;
        if (kind.startsWith("genre:")) return `${this.base}/api/webtoon/titlelist/genre?genre=${kind.substring(6)}&order=${order}&page=${page}`;
        if (kind === "all") return `${this.base}/api/webtoon/titlelist/weekday?order=${order}`;
        return `${this.base}/api/webtoon/titlelist/weekday?week=${kind}&order=${order}`;
    }

    parseList(o) {
        let items = [].concat(o.titleList || [], o.searchList || []);
        // 전체 요일: 요일별 묶음을 월→일 순서로 이어 붙임
        if (o.titleListMap) {
            const keys = WEEK_KEYS.concat(Object.keys(o.titleListMap).filter((k) => WEEK_KEYS.indexOf(k) < 0));
            for (const k of keys) items = items.concat(o.titleListMap[k] || []);
        }
        const adult = this.showAdult();
        const seen = {};
        const list = [];
        for (const t of items) {
            const id = t && t.titleId;
            if (!id || seen[id]) continue;
            seen[id] = true;
            if (!adult && (t.adult || t.nineteen)) continue;
            // 도전만화·베스트도전은 회차 주소가 달라서 뺌 (검색 결과)
            if (t.webtoonLevelCode && t.webtoonLevelCode !== "WEBTOON") continue;
            const name = String(t.titleName || "").trim();
            if (!name) continue;
            list.push({ name, imageUrl: t.thumbnailUrl || "", link: `/webtoon/list?titleId=${id}` });
        }
        const info = o.pageInfo;
        return { list, hasNextPage: !!info && Number(info.page) < Number(info.totalPages) };
    }

    async basePopular(page) {
        return this.parseList(await this.json(this.listUrl("all", "user", page)));
    }

    async baseLatest(page) {
        // 최신 = 오늘 요일 웹툰을 업데이트순으로
        return this.parseList(await this.json(this.listUrl(todayWeek(), "update", page)));
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            return this.parseList(await this.json(`${this.base}/api/search/webtoon?keyword=${encodeURIComponent(query.trim())}&page=${page}`));
        }
        const v = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param && f.values && f.values[f.state]) v[f.param] = f.values[f.state].value;
        }
        return this.parseList(await this.json(this.listUrl(v.list || "all", v.order || "user", page)));
    }

    // ---------- 상세 + 회차 (무료 회차 전부, 최신순) ----------
    titleId(url) {
        const m = /titleId=(\d+)/.exec(String(url || ""));
        if (!m) throw new Error("작품 번호를 찾을 수 없습니다: " + url);
        return m[1];
    }

    async getDetail(url) {
        const id = this.titleId(url);
        const o = await this.json(`${this.base}/api/article/list/info?titleId=${id}`);
        const names = (type) => (o.communityArtists || [])
            .filter((a) => (a.artistTypeList || []).indexOf(type) >= 0).map((a) => a.name).filter((n) => n);
        const ageType = String((o.age && o.age.type) || "");
        const adult = /18|19/.test(ageType);
        const meta = [o.publishDescription, o.age && o.age.description, o.rest ? "휴재 중" : ""].filter((x) => x).join(" · ");
        const title = String(o.titleName || "").trim();

        // 회차 목록: 20개씩 여러 쪽
        const chapters = [];
        const seen = {};
        let page = 1;
        let last = 1;
        do {
            const a = await this.json(`${this.base}/api/article/list?titleId=${id}&page=${page}`);
            for (const c of a.articleList || []) {
                // 미리보기·유료 회차는 뺌 (무료 회차만)
                if (!c || c.charge || c.no === undefined || seen[c.no]) continue;
                seen[c.no] = true;
                chapters.push({
                    no: Number(c.no),
                    name: String(c.subtitle || "").trim() || `${c.no}화`,
                    url: `/webtoon/detail?titleId=${id}&no=${c.no}`,
                    dateUpload: dateOf(c.serviceDateDescription)
                });
            }
            last = (a.pageInfo && Number(a.pageInfo.totalPages)) || page;
            page++;
        } while (page <= last && page <= 200);
        chapters.sort((x, y) => y.no - x.no);
        // 망가요미는 이름 맨 앞 숫자로 회차 순서를 정하므로, 숫자로 시작하지 않으면 회차 번호를 붙임
        const named = chapterPosition(chapters, title).map((c) => ({
            name: /^\d/.test(c.name) ? c.name : `${c.no} · ${c.name}`,
            url: c.url,
            dateUpload: c.dateUpload
        }));

        return {
            name: title,
            imageUrl: o.thumbnailUrl || o.posterThumbnailUrl || "",
            author: names("ARTIST_WRITER").concat(names("ARTIST_NOVEL_ORIGIN")).filter((n, i, arr) => arr.indexOf(n) === i).join(", "),
            artist: names("ARTIST_PAINTER").join(", "),
            description: [
                String(o.synopsis || "").trim(),
                meta,
                adult ? "19세 작품: 웹뷰에서 네이버에 로그인해야 볼 수 있어요." : "",
                "미리보기·유료 회차는 목록에 나오지 않아요 (무료 회차만)."
            ].filter((x) => x).join("\n\n"),
            genre: (o.curationTagList || []).map((t) => String(t.tagName || "").trim()).filter((t) => t),
            // 0 연재, 1 완결
            status: o.finished ? 1 : 0,
            link: `${this.base}/webtoon/list?titleId=${id}`,
            chapters: named
        };
    }

    // ---------- 이미지 (모바일 회차 화면) ----------
    async getPageList(url) {
        const path = /^https?:\/\//.test(url) ? url.replace(/^https?:\/\/[^/]+/, "") : url;
        const res = await this.req(MOBILE + path, this.headers(MOBILE + "/"));
        const html = String(res.body || "");
        const doc = new Document(html);
        const urls = [];
        for (const img of doc.select("img.toon_image, #toonLayer img, #sectionContWide img, .wt_viewer img")) {
            const u = [img.attr("data-src"), img.attr("src")].map((s) => (s || "").trim())
                .find((s) => /pstatic\.net/.test(s) && !/\/static\//.test(s));
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) {
            if (/nid\.naver\.com/.test(String(res.url || "")) || /nid\.naver\.com\/nidlogin/.test(html)) {
                throw new Error("19세 작품이에요. 웹뷰에서 네이버에 로그인한 뒤 다시 열어 주세요.");
            }
            throw new Error("이 회차의 그림을 찾을 수 없어요 (유료·미리보기 회차이거나 앱 전용 회차일 수 있어요).");
        }
        return urls.map((u) => ({ url: u, headers: this.headers(MOBILE + "/") }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어가 없을 때만 적용 (무료 회차만 보여요)" },
            sel("목록", "list", LISTS),
            sel("정렬", "order", ORDERS)
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
            if (f.type_name === "SelectFilter" && f.values[s]) parts.push(f.values[s].name);
        });
        return parts.join(" / ") || fallback;
    }

    async getPopular(page) {
        const s = this.tabLoad(TAB_KEY_POPULAR);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.basePopular(page);
    }

    async getLatestUpdates(page) {
        const s = this.tabLoad(TAB_KEY_LATEST);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.baseLatest(page);
    }

    async search(query, page, filters) {
        // 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌
        const m = /^https?:\/\/([^/?#]+)[^#]*[?&]titleId=(\d+)/.exec(String(query || "").trim());
        if (m && HOST.test(m[1])) {
            const link = `/webtoon/list?titleId=${m[2]}`;
            const d = await this.getDetail(link);
            return { list: d && d.name ? [{ name: d.name, imageUrl: d.imageUrl || "", link }] : [], hasNextPage: false };
        }
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
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (전체 요일 인기순)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (오늘 요일 업데이트순)")}` },
            {
                type_name: "SelectFilter", name: TAB_RULE_NAME, state: 0,
                values: TAB_RULE_OPTIONS.map((n, i) => ({ type_name: "SelectOption", name: n, value: String(i) }))
            }
        ]);
    }

    getFilterList() {
        return this.tabFilterList();
    }

    getSourcePreferences() {
        return [{
            key: "chapter_position",
            switchPreferenceCompat: {
                title: "회차 이름에 남은 화 표시",
                summary: "예: 51화 · 남은 102화 (작품 제목은 빼고 짧게). 끄면 원래 이름만 표시 (새 화가 올라오면 이름이 바뀌어, 다운로드한 회차가 안 받은 것처럼 보일 수 있음)",
                value: true
            }
        }, {
            key: "show_adult",
            switchPreferenceCompat: {
                title: "19세 작품도 목록에 표시",
                summary: "19세 작품은 웹뷰에서 네이버에 로그인해야 볼 수 있어요. 끄면 목록에서 뺍니다.",
                value: false
            }
        }];
    }
}

function withParams(list, base) {
    const out = [];
    for (const f of list || []) {
        if (!f) continue;
        if (!f.param) {
            const b = (base || []).find((x) => x && x.name === f.name && x.type_name === f.type_name);
            if (b && b.param) f.param = b.param;
        }
        out.push(f);
    }
    return out;
}

// 망가요미 앱 기본 User-Agent 를 쓰도록 페이지 요청에서는 User-Agent 를 뺌 (그림·영상 요청은 그대로)
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
