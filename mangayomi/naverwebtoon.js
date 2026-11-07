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
    "version": "0.1.21",
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
// ---------- 인기/최신 탭 규칙 ----------
const TAB_RULE_NAME = "인기/최신 탭 규칙";
const TAB_KEY_POPULAR = "tab_rule_popular";
const TAB_KEY_LATEST = "tab_rule_latest";
const TAB_RULE_OPTIONS = [
    "저장하지 않음 (필터 결과만 보기)",
    "현재 조건을 인기 탭에 저장",
    "현재 조건을 최신 탭에 저장",
    "인기 탭을 기본값으로 복원",
    "최신 탭을 기본값으로 복원",
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
        // 정렬이 붙인 앞 번호("65 · ")는 두고 그 뒤에서 사이트 순번·작품 제목을 뺌
        const lead = (/^\d+(?:\.\d+)? · /.exec(String(c.name || "").trim()) || [""])[0];
        let n = String(c.name || "").trim().substring(lead.length);
        // 사이트 순번은 빼되, 그 순번이 회차 번호인 이름("230. 제79장. …" 뒤에 화 번호도 숫자로 시작하지도 않음)은 둠
        const seqm = /^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/.exec(n);
        if (seqm) {
            const rest = n.substring(seqm[0].length);
            if (!/^\d+\.\s/.test(seqm[0]) || /^\d/.test(rest) || /\d+\s*(?:화|권|호|話)/.test(rest)) n = rest;
        }
        if (t && n.startsWith(t)) {
            const rest = n.substring(t.length).replace(/^[\s\-–:·.]+/, "");
            if (rest) n = rest;
        }
        return Object.assign({}, c, { name: lead + n + (i === 0 ? " · 마지막" : ` · 남은 ${i}화`) });
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
    if (/host lookup|UnknownHost|No address associated|nodename nor servname|ERR_NAME_NOT_RESOLVED/i.test(m)) return "사이트 주소를 찾지 못했어요. ① 잠시 뒤 다시 ② 앱을 완전히 껐다 켜기 ③ 유니콘 등 DNS 앱을 쓰면 DNS 를 Google 로 ④ 주소가 바뀌었으면 검색창에 새 주소 붙여 넣기";
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

const NW_SLICE = 60;
const NW_LIST_CACHE = {};

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

    // 목록 그림(표지) 요청에 앱이 붙이는 헤더 (네이버 그림 서버는 Referer 가 있어야 그림을 줌)
    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/" };
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

    /**
     * 요일·신작 목록은 사이트가 한 번에 전부 줌(전체 요일 846개) → 카드를 한꺼번에 만드느라 첫 화면이 오래 걸림.
     * 60개씩 나눠 쪽으로 보여 주고, 같은 목록은 5분 동안 다시 받지 않음
     */
    async listPage(url, page) {
        if (!/\/api\/webtoon\/titlelist\/(weekday|new)\?/.test(url)) return this.parseList(await this.json(url));
        const now = Date.now();
        let hit = NW_LIST_CACHE[url];
        if (!hit || now - hit.at > 5 * 60000) {
            hit = { at: now, list: this.parseList(await this.json(url)).list };
            NW_LIST_CACHE[url] = hit;
        }
        const p = Math.max(1, Number(page) || 1);
        const from = (p - 1) * NW_SLICE;
        return { list: hit.list.slice(from, from + NW_SLICE), hasNextPage: from + NW_SLICE < hit.list.length };
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
        return this.listPage(this.listUrl("all", "user", page), page);
    }

    async baseLatest(page) {
        // 최신 = 오늘 요일 웹툰을 업데이트순으로
        return this.listPage(this.listUrl(todayWeek(), "update", page), page);
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            return this.parseList(await this.json(`${this.base}/api/search/webtoon?keyword=${encodeURIComponent(query.trim())}&page=${page}`));
        }
        const v = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param && f.values && f.values[f.state]) v[f.param] = f.values[f.state].value;
        }
        return this.listPage(this.listUrl(v.list || "all", v.order || "user", page), page);
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

    // ---------- 인기/최신 탭 규칙: 필터에서 고른 조건을 인기/최신 탭에 저장 ----------
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
        await notesRefresh(this.client);
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
            { type_name: "HeaderFilter", name: `현재 인기: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (전체 요일 인기순)")}` },
            { type_name: "HeaderFilter", name: `현재 최신: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (오늘 요일 업데이트순)")}` },
            {
                type_name: "SelectFilter", name: TAB_RULE_NAME, state: 0,
                values: TAB_RULE_OPTIONS.map((n, i) => ({ type_name: "SelectOption", name: n, value: String(i) }))
            }
        ]);
    }

    getFilterList() {
        const notes = notesFilters("naverwebtoon");
        return notes.concat(this.tabFilterList());
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
        // 맨 위 업데이트 내역 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        if (!f || f._status || (f.type_name === "HeaderFilter" && /^📝/.test(String(f.name || "")))) continue;
        if (!f.param) {
            const b = (base || []).find((x) => x && x.name === f.name && x.type_name === f.type_name);
            if (b && b.param) f.param = b.param;
        }
        out.push(f);
    }
    return out;
}

// 망가요미 앱 기본 User-Agent 를 쓰도록 페이지 요청에서는 User-Agent 를 뺌 (그림·영상 요청은 그대로)
// 망가요미 변형 앱(Mangayomi Glitch 등)은 User-Agent 를 넣어 주지 않아, 빼고 보내면 사이트가 연결을 끊거나 403 을 줌
// → 그런 응답이면 User-Agent 를 넣어 다시 보내고, 그 뒤로는 처음부터 넣음 (원래 망가요미는 첫 요청이 성공해 그대로)
let APP_NO_UA = false;
let APP_ALT = null;
function appClient(raw) {
    const media = /\.(?:m3u8|mp4|ts|m4s|jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;
    const fallbackUa = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    const strip = (url, headers) => {
        if (!headers || media.test(String(url || ""))) return headers || {};
        const out = {};
        for (const k in headers) if (k.toLowerCase() !== "user-agent") out[k] = headers[k];
        return out;
    };
    const withUa = (headers) => {
        const out = Object.assign({}, headers || {});
        if (!Object.keys(out).some((k) => k.toLowerCase() === "user-agent")) out["User-Agent"] = fallbackUa;
        return out;
    };
    // 망가요미 기본 통신이 끊기면 연결을 재사용하지 않는 별도 통신으로 한 번 더 (애니24에서 효과 확인, DC 확장과 같은 방법)
    const alt = () => {
        if (!APP_ALT) {
            try {
                APP_ALT = new Client({ persistentConnection: false, noProxy: true, timeout: 25, connectTimeout: 10 });
            } catch (e) {
                APP_ALT = null;
            }
        }
        return APP_ALT;
    };
    const send = async (call, url, headers) => {
        if (APP_NO_UA || media.test(String(url || ""))) {
            try {
                return await call(raw, url, APP_NO_UA ? withUa(headers) : headers || {});
            } catch (e) {
                const c = alt();
                if (!c) throw e;
                return call(c, url, withUa(headers));
            }
        }
        let res;
        try {
            res = await call(raw, url, strip(url, headers));
        } catch (e) {
            res = null;
            try {
                const again = await call(raw, url, withUa(headers));
                APP_NO_UA = true;
                return again;
            } catch (e2) {
                const c = alt();
                if (!c) throw e;
                try {
                    return await call(c, url, withUa(headers));
                } catch (e3) {
                    throw e;
                }
            }
        }
        if (res && res.statusCode === 403) {
            try {
                const again = await call(raw, url, withUa(headers));
                if (again && again.statusCode && again.statusCode < 400) {
                    APP_NO_UA = true;
                    return again;
                }
            } catch (e) {}
        }
        return res;
    };
    return {
        get: (url, headers) => send((c, u, h) => c.get(u, h), url, headers),
        post: (url, headers, body) => send((c, u, h) => c.post(u, h, body), url, headers),
    };
}

// ---------- 업데이트 내역 (필터 맨 위 📝 줄) ----------
// 저장소의 changelog.json 을 1시간에 한 번 받아 두었다가 그 소스의 최근 3개를 보여 줌 (필터 화면을 열 때 기다리지 않음)
const NOTES_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/changelog.json";

async function notesRefresh(client) {
    let p;
    try {
        p = new SharedPreferences();
    } catch (e) {
        return;
    }
    await verRefresh(client, p);
    const last = Number(p.getString("notes_at", "0")) || 0;
    if (Date.now() - last < 60 * 60000) return;
    p.setString("notes_at", String(Date.now()));
    try {
        const r = await client.get(NOTES_URL, {});
        const body = String(r.body || "");
        if (r.statusCode === 200 && body.trim().startsWith("{")) p.setString("notes_json", body);
    } catch (e) {
        // 다음 기회에 다시 받음
    }
}

// ---------- 설치 버전 확인 (필터 맨 위 📝 줄) ----------
// 망가요미는 자동 업데이트를 해도 알림이 없어 → 설치된 버전과 저장소의 최신 버전을 1시간마다 비교해 보여 줌 (2026-11-03)
const VER_INDEX_URLS = ["https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/mangayomi/index.json", "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/mangayomi/novel_index.json"];

function verCmp(a, b) {
    const x = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
    const y = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}

async function verRefresh(client, p) {
    const last = Number(p.getString("ver_at", "0")) || 0;
    if (Date.now() - last < 60 * 60000) return;
    p.setString("ver_at", String(Date.now()));
    const file = String(mangayomiSources[0].pkgPath || "").split("/").pop();
    for (const u of VER_INDEX_URLS) {
        try {
            const r = await client.get(u, {});
            const arr = JSON.parse(String(r.body || "[]"));
            const hit = (Array.isArray(arr) ? arr : []).find((x) => x && String(x.sourceCodeUrl || "").endsWith("/" + file));
            if (hit && hit.version) {
                p.setString("ver_latest", String(hit.version));
                return;
            }
        } catch (e) {
            // 다음 기회에 다시 확인
        }
    }
}

function verLine(key, note) {
    // 버전과 마지막 업데이트 내역을 한 줄로 (필터가 지저분해 보여, 사용자 2026-11-03)
    const mine = String(mangayomiSources[0].version || "");
    let latest = "";
    try {
        latest = new SharedPreferences().getString("ver_latest", "") || "";
    } catch (e) {
        latest = "";
    }
    const last = note && note.t ? ` · ${String(note.d || "").substring(5).replace("-", ".")} ${String(note.t).replace(/^망가요미:\s*/, "")}` : "";
    let name = `📝 ${mine}${last}`;
    if (latest && verCmp(latest, mine) > 0) name = `📝 ⚠️ OLD ${mine} → 새 버전 ${latest} 있음, 확장 화면에서 업데이트`;
    else if (latest) name = `📝 🆕 NEW ${mine}${last}`;
    return { type_name: "HeaderFilter", name, _status: true };
}

function notesFilters(key) {
    let list = [];
    try {
        list = (JSON.parse(new SharedPreferences().getString("notes_json", "") || "{}").items || {})[key] || [];
    } catch (e) {
        list = [];
    }
    return [verLine(key, list.filter((n) => n && n.t)[0])];
}

// ---------- 필터 맨 끝 빈 줄 (2026-11-03) ----------
// 망가요미 필터 창이 휴대폰 하단 버튼(|||·○·<)에 가려 맨 아래 항목이 안 눌림 → 맨 끝에 빈 줄을 두어 위로 올릴 수 있게.
// 맨 끝에만 붙여 기존 필터 순서·저장된 탭 규칙은 그대로
(function () {
    const base = DefaultExtension.prototype.getFilterList;
    DefaultExtension.prototype.getFilterList = function () {
        const list = base.apply(this, arguments) || [];
        return list.concat([1, 2, 3].map(() => ({ type_name: "HeaderFilter", name: "\u3000", _status: true })));
    };
})();

// ---------- 빠진 회차 번호 (2026-11-04) ----------
// 망가요미는 "N화 누락됨" 개수만 보여 줌 → 작품 설명 맨 위에 빠진 회차 번호를 적음 (회차 이름 맨 앞 번호 기준)
function missingNote(chapters) {
    const nums = {};
    let max = 0;
    let min = Infinity;
    for (const c of chapters || []) {
        const m = /^\D{0,6}?(\d{1,5})(?:\.\d+)?\s*(?:화|회|부|권|장|편|$|\s|\D)/.exec(String((c && c.name) || "").trim());
        if (!m) continue;
        const n = Number(m[1]);
        if (!(n > 0) || n > 20000) continue;
        nums[n] = true;
        if (n > max) max = n;
        if (n < min) min = n;
    }
    if (!max || max - min > 5000) return "";
    // 가장 작은 번호 ~ 가장 큰 번호 사이만 (앞쪽 1~21화가 원래 없는 작품은 세지 않음, 애니요미와 같음)
    const miss = [];
    for (let i = min; i <= max; i++) if (!nums[i]) miss.push(i);
    if (!miss.length || miss.length > (max - min + 1) / 2) return "";
    const shown = miss.slice(0, 10).map((n) => `${n}화`).join(", ");
    return `⚠️ 빠진 회차: ${shown}${miss.length > 10 ? ` 외 ${miss.length - 10}개` : ""} (사이트에 없거나 확장이 못 받아 온 회차)`;
}
(function () {
    const base = DefaultExtension.prototype.getDetail;
    if (!base) return;
    DefaultExtension.prototype.getDetail = async function () {
        const d = await base.apply(this, arguments);
        try {
            const note = d ? missingNote(d.chapters) : "";
            if (note) d.description = note + (d.description ? "\n\n" + d.description : "");
        } catch (e) {
            // 그대로
        }
        return d;
    };
})();

// ---------- 검색 띄어쓰기 (2026-11-05) ----------
// 사이트 검색이 띄어쓰기를 구분해 "괴력난신"·"나혼자만레벨업" 으로는 "괴력 난신"·"나 혼자만 레벨업" 이 안 나오는 곳이 있음.
// 결과가 0개일 때만: ① 띄어쓰기를 뺀 검색어 ② 검색어 앞부분(절반) ③ 두 글자씩(앞에서부터) 으로 최대 6번 다시 찾아,
// 띄어쓰기·기호를 빼고 비교했을 때 검색어가 들어 있는 작품만 보여 줌. 결과가 있으면 원래 그대로
(function () {
    const base = DefaultExtension.prototype.search;
    DefaultExtension.prototype.search = async function (query, page, filters) {
        const r = await base.apply(this, arguments);
        const q = String(query || "").trim();
        if (!q || Number(page) > 1 || /^(?:https?:\/\/|[\w-]+(?:\.[\w-]+)+(?:[/?#]|$))/i.test(q) || (r && r.list && r.list.length)) return r;
        const squash = (s) => String(s || "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
        const want = squash(q);
        if (want.length < 2) return r;
        const joined = q.replace(/\s+/g, "");
        const tries = [];
        const add = (t) => { if (t && t.length >= 2 && t !== q && tries.indexOf(t) < 0) tries.push(t); };
        // 사이트 검색은 쉼표·쌍점·물결·괄호·한자 같은 기호가 있으면 못 찾음("밑도 끝도 없이, 너다" 0개, 2026-11-06 검색 검사)
        // → 기호를 뺀 검색어, 앞쪽 단어만으로 먼저 찾아 봄
        const plain = q.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/[\u3400-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
        const words = plain.split(" ").filter((w) => w);
        add(plain);
        if (words.length > 2) add(words.slice(0, words.length - 1).join(" "));
        if (words.length > 1) add(words.slice(0, Math.ceil(words.length / 2)).join(" "));
        add(joined);
        if (joined.length > 2) add(joined.substring(0, Math.max(2, Math.ceil(joined.length / 2))));
        for (let i = 0; i + 2 <= joined.length; i++) add(joined.substring(i, i + 2));
        for (const t of tries.slice(0, 8)) {
            try {
                const r2 = await base.call(this, t, 1, filters);
                const hit = ((r2 && r2.list) || []).filter((x) => squash(x && x.name).includes(want));
                if (hit.length) return { list: hit, hasNextPage: false };
            } catch (e) {
                // 다음 방법으로
            }
        }
        return r;
    };
})();

// ---------- 회차 번호 겹침 막기 (2026-11-07 회차 점검) ----------
// 망가요미는 회차 이름에서 숫자를 읽어 번호를 매기고(lib/utils/chapter_recognition.dart: 작품 제목을 지운 뒤 첫 숫자,
// "season/s/t N"·"ep N" 따로), 번호가 같은 회차는 하나만 남김 → "프롤로그 · 남은 98화"(98)와 "98화"가 겹치거나
// "키스 대신 7초 34화"가 모두 7 이 되어 회차가 사라짐. 같은 방식으로 미리 읽어 보고, 겹치거나 번호가 없는 작품만
// 오래된 회차부터 겹치지 않는 번호를 이름 앞에 붙임("35. …", 겹치면 "39.01. …"). 문제없는 작품은 그대로
(function () {
    const base = DefaultExtension.prototype.getDetail;
    const unwanted = /\b(?:v|ver|vol|version|volume|season|staffel|saison|temporada|s|t)[^a-z]?[0-9]+/g;
    const seasonKw = /\b(?:staffel|season|saison|temporada|s|t)\s*([0-9]+)/;
    const epKw = /\b(?:folge|episode|episodio|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/;
    const chNot = /(?<=ch\.) *([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
    const bare = /([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
    const dec = (d, a) => {
        if (d) return parseFloat(d);
        if (a) {
            if (a.includes("extra")) return 0.99;
            if (a.includes("omake")) return 0.98;
            if (a.includes("special")) return 0.97;
            const t = a.replace(".", "");
            if (t.length === 1) { const k = t.charCodeAt(0) - 96; return k >= 10 ? 0 : k / 10; }
        }
        return 0;
    };
    const read = (title, ch) => {
        let n = String(ch || "").toLowerCase();
        if (title) n = n.split(String(title).toLowerCase()).join("");
        n = n.trim().replace(/,/g, ".").replace(/-/g, ".").replace(/\s(?=extra|special|omake)/g, "");
        const sm = seasonKw.exec(n);
        const season = sm ? sm[1] : "0";
        const em = epKw.exec(n);
        if (em) return { season, ep: parseFloat(em[1]) };
        const s2 = n.replace(unwanted, "");
        const m = chNot.exec(s2) || bare.exec(s2);
        return { season, ep: m ? parseFloat(m[1]) + dec(m[2], m[3]) : null };
    };
    const ok = (list, title) => {
        const seen = {};
        for (const x of list) {
            const r = read(title, x.name);
            if (r.ep === null || !(r.ep > 0)) return false;
            const k = `${r.season}::${r.ep}::${x.scanlator || ""}`;
            if (seen[k]) return false;
            seen[k] = true;
        }
        return true;
    };
    // 붙일 번호 짐작: "34화"·"5회" 를 먼저, 없으면 앱 방식. 확장이 붙인 " · 남은 N화"·" · 마지막"·끝 날짜 "(11.05)" 는 빼고 읽음
    const guessNo = (title, name) => {
        const core = String(name || "").replace(/\s*·\s*(?:남은\s*\d+\s*화|마지막)\s*$/, "").replace(/\s*\(\d{2}(?:\.\d{2}){1,2}\)\s*$/, "");
        const m = /(\d+(?:[.-]\d+)?)\s*(?:화|회|話)/.exec(core);
        if (m) return parseFloat(m[1].replace("-", "."));
        return read(title, core).ep;
    };
    DefaultExtension.prototype.getDetail = async function (url) {
        const d = await base.apply(this, arguments);
        const list = d && (d.episodes || d.chapters);
        if (!list || !list.length) return d;
        const title = String(d.name || "");
        // 앱이 기억한 제목이 조금 달라 지워지지 않는 경우까지 보려고 제목을 지운 것·안 지운 것 둘 다 확인
        if (ok(list, title) && ok(list, "")) return d;
        let last = 0;
        const fmt = (v) => String(Math.round(v * 100) / 100);
        for (let i = list.length - 1; i >= 0; i--) { // 목록은 최신이 위 → 오래된 것부터
            const x = list[i];
            const plain = String(x.name || "").replace(/^\s*\d+(?:\.\d+)?\.\s+/, "");
            const guess = guessNo(title, plain);
            const v = guess !== null && guess > last ? guess : Math.round((last + 0.01) * 100) / 100;
            last = v;
            const lead = /^\s*(\d+(?:\.\d+)?)/.exec(plain);
            x.name = lead && parseFloat(lead[1]) === v && !/^\s*\d+(?:\.\d+)?\s*[-.,]\s*\d/.test(plain) ? plain : `${fmt(v)}. ${plain}`;
        }
        return d;
    };
})();
