const mangayomiSources = [{
    "id": 870214012,
    "name": "마루마루 웹툰",
    "lang": "ko",
    "baseUrl": "https://marumaru106.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "marumaru_webtoon.js"
}];

const MEDIA = "WEBTOON";
const SECTION = MEDIA === "MANHWA" ? "manhwa" : MEDIA === "NOVEL" ? "novel" : "webtoon";
// 감시 점검 결과 이름 (필터 맨 위 🩺 줄)
const STATUS_KEY = MEDIA === "WEBTOON" ? "marumaru" : "marumaru_" + SECTION;

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(?:www\.)?marumaru\d+\.[a-z]{2,6}$/;
const AUTO_NUM = /marumaru(\d+)/;
// 진짜 사이트 첫 화면에만 있는 글자 (로고 그림 주소)
const MARK = "/assets/logo/marumaru";
const READER = "https://api.storagewebtoon.store/api/v1/reader/A2";
const PAGE_SIZE = 49;
const PAID_MSG = "이 회차는 사이트에서 포인트로 사야 볼 수 있어요 (확장으로는 볼 수 없음)";

const opts = (names) => [["전체", ""]].concat(names.map((n) => [n, n]));
const WEBTOON_CATEGORIES = [["일반 (BL/GL 제외)", ""], ["전체", "ALL"], ["BL/GL", "BLGL"], ["성인", "ADULT"]];
const CATEGORIES = [["전체", ""], ["BL/GL", "BLGL"], ["성인", "ADULT"]];
const STATUSES = [["전체", ""], ["완결", "completed"], ["연재 중 (검색만)", "ongoing"]];
const SORTS = [["최신순", "LATEST"], ["신작순", "NEW"], ["북마크순", "BOOKMARK"], ["조회순", "VIEW"], ["평점순", "RATING"], ["화수순", "EPISODE"]];
const SEARCH_SORTS = ["LATEST", "BOOKMARK", "VIEW", "EPISODE"];
const WEEKDAYS = [["전체", ""], ["월", "MON"], ["화", "TUE"], ["수", "WED"], ["목", "THU"], ["금", "FRI"], ["토", "SAT"], ["일", "SUN"]];
const WEBTOON_PLATFORMS = ["네이버", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹스", "케이툰", "피너툰", "봄툰", "코미코", "리디북스", "기타"];
const MANHWA_PLATFORMS = ["네이버", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹스", "코믹GT", "케이툰", "애니툰", "폭스툰", "피너툰", "봄툰", "코미코", "무툰", "리디북스", "기타"];
const WEBTOON_GENRES = ["판타지", "액션", "미스터리", "로맨스", "드라마", "무협", "스포츠", "일상", "학원", "성인", "개그", "연애", "추리", "공포", "옴니버스", "에피소드", "소년", "기타", "고수위"];
const MANHWA_GENRES = ["순정", "판타지", "러브코미디", "드라마", "17", "학원", "라노벨", "개그", "액션", "백합", "일상", "SF", "이세계", "스릴러", "애니화", "전생", "스포츠", "TS", "소년", "먹방", "붕탁", "게임", "호러", "시대", "로맨스", "추리", "음악", "무협", "BL", "스토리", "BL/백합", "성인", "연애", "공포", "옴니버스", "에피소드", "기타", "고수위"];
const NOVEL_GENRES = ["판타지", "무협", "19금", "현대", "로맨스", "로맨스 판타지", "BL", "라노벨", "기타"];
const INITIALS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const WEEKDAY_NAMES = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일" };

// 마루마루 (marumaru###.com) - 화면은 React 앱이고 목록·작품은 사이트의 /api/works, 회차·본문은 api.storagewebtoon.store 에서 JSON 으로 받음.
// 웹툰·만화·소설 파일은 같은 코드 (맨 위 이름·id·pkgPath·itemType 과 MEDIA 만 다름)

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

// ---------- 접속 속도 제한 · 주소로 바로 열기 ----------
// 사이트로 가는 요청 사이에 최소 간격 (한꺼번에 많이 요청하면 사이트가 403으로 막음). 그림 요청은 제외
let lastSiteRequest = 0;
async function siteWait(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/.exec(String(url || ""));
    if (!m || !AUTO_HOST.test(m[1]) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
    const wait = lastSiteRequest + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSiteRequest = Date.now();
}

// 검색창에 사이트 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
async function openByUrl(ext, query, toLink) {
    // 새 주소를 붙여 넣으면 그 주소로 바로 바꿈 (주소만이면 인기 목록)
    const adopted = await addrAdopt(ext, query);
    const m = /^(?:https?:\/\/)?([^/?#\s]+)(\/[^#\s]*)?$/.exec(String(query || "").trim());
    if (!m || !AUTO_HOST.test(m[1].toLowerCase())) return null;
    const link = toLink(m[2] || "/");
    if (!link) return adopted ? await ext.getPopular(1) : null;
    const d = await ext.getDetail(link);
    return { list: d && d.name ? [{ name: d.name, imageUrl: d.imageUrl || "", link }] : [], hasNextPage: false };
}

// 옛 주소가 끊기지 않고 "접속 주소 안내" 페이지(새 주소 링크만 있는 작은 페이지)를 보여 주면,
// 거기 적힌 더 큰 번호의 같은 사이트 주소 중 진짜 사이트(marker 가 보임)를 돌려줌
async function noticeTarget(ext, body, base, marker) {
    body = String(body || "");
    if (!body || body.length >= 30000 || body.indexOf(marker) >= 0) return null;
    if (!/<html|<!doctype/i.test(body.substring(0, 3000))) return null; // JSON·API 응답은 제외
    return familyTarget(ext, body, base, marker, false);
}

// 정상 사이트 화면에 지금보다 번호가 큰 같은 사이트 주소가 적혀 있으면(사이트 자기 주소·새 주소 안내),
// 진짜 사이트인지 확인해 그 주소를 돌려줌 → 옛 주소가 새 주소로 넘겨 줘도 새 주소를 기억 (망가요미는 넘어간 주소를 알려 주지 않음)
const FAMILY_TRIED = {};
async function selfTarget(ext, body, base, marker) {
    body = String(body || "");
    if (!body || body.indexOf(marker) < 0) return null;
    return familyTarget(ext, body, base, marker, true);
}

async function familyTarget(ext, body, base, marker, quiet) {
    const host = base.replace(/^https?:\/\//, "");
    const h = host.replace(/^www\./, "");
    const head = h.substring(0, h.lastIndexOf("."));
    const m = /(\d+)(?!.*\d)/.exec(head);
    if (!m) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:www\\.)?${esc(head.substring(0, m.index))}\\d+${esc(head.substring(m.index + m[1].length))}\\.[a-z]{2,6}`, "gi");
    const num = (s) => {
        const x = /(\d+)(?!.*\d)/.exec(s.replace(/^www\./, "").replace(/\.[a-z]{2,6}$/i, ""));
        return x ? parseInt(x[1], 10) : 0;
    };
    const cur = parseInt(m[1], 10);
    const cands = [...new Set((body.match(re) || []).map((x) => x.toLowerCase()))]
        .filter((x) => AUTO_HOST.test(x) && num(x) > cur).sort((a, b) => num(b) - num(a));
    for (const c of cands.slice(0, 3)) {
        // 확인에 실패한 주소는 30분 동안 다시 열어 보지 않음 (정상 화면마다 확인하므로)
        if (quiet && Date.now() - (FAMILY_TRIED[c] || 0) < 30 * 60000) continue;
        if (quiet) FAMILY_TRIED[c] = Date.now();
        for (const hh of host.startsWith("www.") && !c.startsWith("www.") ? [c, "www." + c] : [c]) {
            try {
                const r = await ext.client.get(`https://${hh}/`, { "User-Agent": MOBILE_UA });
                if (r.statusCode === 200 && String(r.body || "").indexOf(marker) >= 0) return `https://${hh}`;
            } catch (e) {}
        }
    }
    return null;
}

// 회차 이름 끝에 남은 화 수를 붙임 ("112화 · 남은 26화", 마지막 화는 "112화 · 마지막"). list: 최신 → 과거
// 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목은 뺌. 설정 "회차 이름에 남은 화 표시"로 끌 수 있음
function chapterPosition(list, title) {
    try {
        const v = new SharedPreferences().get("chapter_position");
        if (v === false || v === "false") return list;
    } catch (e) {}
    const t = String(title || "").trim();
    return list.map((c, i) => {
        // 정렬이 붙인 앞 번호("65 · ")는 두고 그 뒤에서 사이트 순번·작품 제목을 뺌
        const lead = (/^\d+(?:\.\d+)? · /.exec(String(c.name || "").trim()) || [""])[0];
        let n = String(c.name || "").trim().substring(lead.length).replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "");
        if (t && n.startsWith(t)) {
            const rest = n.substring(t.length).replace(/^[\s\-–:·.]+/, "");
            if (rest) n = rest;
        }
        return Object.assign({}, c, { name: lead + n + (i === 0 ? " · 마지막" : ` · 남은 ${i}화`) });
    });
}

// 오류를 쉬운 말로 (Aniyomi 확장과 같은 문구). Cloudflare 확인은 그대로 둠
function friendlyHttp(code) {
    if (code === 403) return "사이트가 접속을 막았어요 (HTTP 403). 오른쪽 위 웹뷰로 한 번 열어 본 뒤 다시 시도해 주세요.";
    if (code === 429) return "요청이 너무 많아 사이트가 잠시 막았어요 (HTTP 429). 1~2분 뒤 다시 시도해 주세요.";
    if (code >= 500 && code <= 599) return `사이트가 지금 응답하지 않아요 (HTTP ${code}). 잠시 뒤 다시 시도해 주세요.`;
    return null;
}

function friendlyError(e) {
    const m = String((e && e.message) || e || "");
    if (/cloudflare/i.test(m)) return m;
    if (/host lookup|UnknownHost|No address associated|nodename nor servname/i.test(m)) {
        return "사이트 주소에 접속할 수 없어요. 주소가 바뀌었을 수 있어요 — 설정에서 '도메인 자동 찾기'를 켜 두거나 새 주소를 넣어 주세요.";
    }
    if (/timed? ?out|timeout/i.test(m)) return "사이트 응답이 너무 늦어요 (시간 초과). 잠시 뒤 다시 시도해 주세요.";
    if (/Connection (refused|reset|closed|failed)|HandshakeException|SocketException|CERTIFICATE/i.test(m)) {
        return "사이트에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 뒤 다시 시도해 주세요.";
    }
    return m;
}

// 주소 바뀜 대응 설정: 사이트 주소 모양, 진짜 사이트 표시 글자, User-Agent, 직접 넣은 주소 설정 키
const ADDR_HOST = AUTO_HOST;
const ADDR_MARK = MARK;
const ADDR_UA = MOBILE_UA;
const ADDR_PREF = "domain";

// ---------- 주소가 바뀐 것 같을 때 · 붙여 넣은 새 주소 (애니·웹툰 망가요미 파일 같은 코드, 위 ADDR_* 만 다름) ----------
const ADDR_HELP = "주소가 바뀐 것 같아요. 웹뷰로 열어 새 주소를 확인한 뒤 그 주소를 검색창에 붙여 넣어 주세요.";

function addrCurrent(ext) {
    try {
        return String("base" in ext ? ext.base : ext.getBaseUrl());
    } catch (e) {
        return "";
    }
}

// 그 주소가 진짜 사이트인지 (첫 화면에 사이트 표시 글자가 있는지)
async function addrIsSite(ext, origin) {
    try {
        const r = await ext.client.get(origin + "/", { "User-Agent": ADDR_UA });
        return r.statusCode === 200 && String(r.body || "").toLowerCase().includes(ADDR_MARK.toLowerCase());
    } catch (e) {
        return false;
    }
}

// 검색창에 붙여 넣은 사이트 주소(https:// 없어도 됨)가 지금 주소와 다르고 진짜 사이트면 직접 넣은 주소로 바로 씀 → 바뀐 주소(없으면 null)
async function addrAdopt(ext, query) {
    const m = /^(?:https?:\/\/)?([^/?#\s]+)(?:[/?#]\S*)?$/.exec(String(query || "").trim());
    if (!m || !ADDR_HOST.test(m[1].toLowerCase())) return null;
    const origin = "https://" + m[1].toLowerCase();
    const plain = (u) => String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
    if (plain(origin) === plain(addrCurrent(ext))) return null;
    if (!(await addrIsSite(ext, origin))) return null;
    try {
        new SharedPreferences().setString(ADDR_PREF, origin);
    } catch (e) {
        return null;
    }
    return origin;
}

// 인기·최신 첫 쪽이 오류이거나 비었는데 지금 주소가 사이트가 아니면(끊김·빈 페이지·404) 새 주소를 찾아 다시 불러옴,
// 못 찾으면 붙여 넣기 안내 (지금 주소가 진짜 사이트면 원래 결과·오류 그대로)
async function addrGuard(ext, page, fn) {
    let r = null;
    let err = null;
    try {
        r = await fn();
    } catch (e) {
        err = e;
    }
    if (page !== 1 || (r && r.list && r.list.length) || !ext.autoOn()) {
        if (err) throw err;
        return r;
    }
    const base = addrCurrent(ext);
    if (await addrIsSite(ext, base)) {
        if (err) throw err;
        return r;
    }
    const found = await ext.discover(base);
    if (found) return await fn();
    throw new Error(ADDR_HELP + (err ? ` [${(err && err.message) || err}]` : ""));
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
    }

    // ---------- 도메인: 수동 주소 > 자동으로 찾은 주소 > 기본 주소 ----------
    cleanUrl(v) {
        v = String(v || "").trim().replace(/\/+$/, "");
        return /^https?:\/\/[^\s/]+$/.test(v) ? v : "";
    }

    get base() {
        try {
            const prefs = new SharedPreferences();
            const manual = this.cleanUrl(prefs.get("domain"));
            // 직접 넣은 주소는 기본 주소와 같아도 그대로 씀 (설정 기본값은 빈 칸)
            if (manual) {
                // 직접 넣은 주소는 바로 씀. 단 자동 찾기로 그보다 번호가 큰 진짜 사이트 주소가 확인되면 그 주소로 바꾸고 설정 칸도 고침
                const newer = this.cleanUrl(prefs.getString("auto_domain", ""));
                const num = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
                if (newer && newer !== manual && num(newer) > num(manual) && this.autoOn()) {
                    prefs.setString("domain", newer);
                    return newer;
                }
                return manual;
            }
            // 자동으로 찾은 주소가 확장 업데이트로 바뀐 기본 주소보다 옛 번호면 기본 주소를 씀
            const auto = this.cleanUrl(prefs.getString("auto_domain", ""));
            const n = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
            return auto && n(auto) >= n(this.source.baseUrl) ? auto : this.source.baseUrl;
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

    // 요청 + 오류를 쉬운 말로 (연결 오류, HTTP 403·429·5xx)
    async req(...args) {
        let res;
        try {
            res = await this.reqRaw(...args);
        } catch (e) {
            throw new Error(friendlyError(e));
        }
        const msg = friendlyHttp(res && Number(res.statusCode));
        if (msg) throw new Error(msg);
        return res;
    }

    /** 요청 실패(접속 불가 / 5xx / API 대신 다른 화면) 시 새 주소를 찾아 저장하고 같은 요청을 다시 보냄 */
    async reqRaw(url, headers) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        const api = url.substring(base.length).startsWith("/api/");
        let failed = null;
        let error = null;
        let notice = null;
        try {
            const res = await this.client.get(url, headers || {});
            // 자동으로 찾은 주소가 막히면(403) 자동 주소를 지우고 기본 주소로 다시 요청
            if (ours && res.statusCode === 403 && base !== this.source.baseUrl && !this.cleanUrl(new SharedPreferences().get("domain"))) {
                new SharedPreferences().setString("auto_domain", "");
                const fb = this.source.baseUrl;
                const h = {};
                for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(fb);
                const r2 = await this.client.get(fb + url.substring(base.length), h);
                if (r2.statusCode < 400) return r2;
            }
            if (ours && res.statusCode === 200 && !api) notice = await noticeTarget(this, res.body, base, MARK);
            // 정상 화면에 적힌 더 새 주소(사이트가 새 주소로 넘겨 준 경우 포함)를 자동 주소로 기억
            if (ours && !notice && res.statusCode === 200 && !api) {
                const self = await selfTarget(this, res.body, base, MARK);
                if (self) new SharedPreferences().setString("auto_domain", self);
            }
            // 옛 주소가 사이트 대신 다른 화면(주차 페이지 등)을 주면 API 가 JSON 이 아님
            const notApi = ours && api && res.statusCode === 200 && !/^\s*[{[]/.test(String(res.body || ""));
            if (!notice && !notApi && (!ours || !(res.statusCode >= 500))) return res;
            failed = res;
        } catch (e) {
            if (!ours) throw e;
            error = e;
        }
        const found = notice || await this.discover(base);
        if (notice) new SharedPreferences().setString("auto_domain", notice);
        if (!found) {
            if (error) throw error;
            return failed;
        }
        const h = {};
        for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(found);
        return await this.client.get(found + url.substring(base.length), h);
    }

    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));

        const num = (u) => parseInt((String(u).match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const cur = num(current) || num(this.source.baseUrl);
        const tld = (/\.([a-z]{2,6})$/.exec(String(current).replace(/\/+$/, "")) || [0, "com"])[1];
        const cands = [];
        for (let i = Math.max(1, cur - 3); i <= cur + 30; i++) {
            const c = `https://marumaru${i}.${tld}`;
            if (c !== current) cands.push(c);
        }
        const hits = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes(MARK) ? c : null;
            } catch (e) {
                return null;
            }
        }));
        const ok = hits.filter((x) => x);
        ok.sort((a, b) => num(b) - num(a));
        const found = ok[0] || null;
        if (found) prefs.setString("auto_domain", found);
        return found;
    }

    getHeaders(url) {
        return { "User-Agent": MOBILE_UA, "Referer": this.source.baseUrl + "/" };
    }

    hdr() {
        return { "User-Agent": MOBILE_UA, "Referer": this.base + "/" };
    }

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "");
    }

    async json(url) {
        const res = await this.req(url, this.hdr());
        const body = fixUtf8(res.body);
        if (!/^\s*[{[]/.test(body)) throw new Error(`사이트 응답을 읽을 수 없습니다 (상태 ${res.statusCode})`);
        return JSON.parse(body);
    }

    item(w) {
        return { name: w.title || "", imageUrl: w.thumbUrl || w.coverUrl || "", link: `/${SECTION}/${w.id}` };
    }

    works(d, page) {
        const items = d.items || [];
        const size = Number(d.size) || items.length || 1;
        const list = items.map((w) => this.item(w)).filter((x) => x.name);
        return { list, hasNextPage: list.length > 0 && page * size < (Number(d.total) || 0) };
    }

    // ---------- 목록 ----------
    /** /api/works?mediaType=…&page=(0부터)&size=… + 분류·정렬·요일·플랫폼·장르·초성 */
    worksUrl(q, page) {
        const p = [`mediaType=${MEDIA}`];
        if (q.category === "ADULT") p.push("adult=true");
        else if (q.category === "BLGL") p.push("blgl=true");
        // 사이트처럼 웹툰 기본 목록은 BL/GL 을 뺌 (완결 목록은 전체)
        else if (q.category !== "ALL" && MEDIA === "WEBTOON" && !q.completed) p.push("blgl=false");
        if (q.completed) p.push("completed=true");
        for (const k of ["weekday", "initial", "platform", "genre", "sort"]) if (q[k]) p.push(`${k}=${encodeURIComponent(q[k])}`);
        p.push(`page=${page - 1}`, `size=${PAGE_SIZE}`);
        return `${this.base}/api/works?` + p.join("&");
    }

    async basePopular(page) {
        return this.works(await this.json(this.worksUrl({ sort: "VIEW" }, page)), page);
    }

    async baseLatest(page) {
        return this.works(await this.json(this.worksUrl({ sort: "LATEST" }, page)), page);
    }

    async baseSearch(query, page, filters) {
        const q = {};
        let status = "";
        for (const f of filters || []) {
            if (f.type_name !== "SelectFilter" || !f.param || !f.values || !f.values[f.state]) continue;
            const v = f.values[f.state].value;
            if (f.param === "status") status = v; else q[f.param] = v;
        }
        const kw = String(query || "").trim();
        if (kw) {
            // 검색: 정렬은 최신·북마크·조회·화수만, 상태는 연재/완결
            const p = [`q=${encodeURIComponent(kw)}`, `page=${page - 1}`, `media=${MEDIA}`, `sort=${SEARCH_SORTS.indexOf(q.sort) >= 0 ? q.sort : "LATEST"}`];
            if (status === "completed") p.push("status=COMPLETED");
            else if (status === "ongoing") p.push("status=ON");
            return this.works(await this.json(`${this.base}/api/search?` + p.join("&")), page);
        }
        // 목록에는 "완결"만 있음 (연재중만 고르는 값은 사이트에 없음)
        q.completed = status === "completed";
        return this.works(await this.json(this.worksUrl(q, page)), page);
    }

    // ---------- 상세 + 회차 (100화씩 나뉜 회차 목록을 모두 받음) ----------
    /**
     * 회차 이름: 사이트 제목 그대로 ("59화 - 부제", "33-1화"). 단 앞에 (잘린) 작품 제목이 붙어 있으면 그 뒤 "N화"부터
     * ("여사친은 부탁하면 …외로 대준다 1화" → "1화"), 제목에 화 번호가 없으면 "N화 제목"
     */
    epName(num, title, work) {
        const t = String(title || "").trim();
        const w = String(work || "").trim();
        if (!(num >= 0)) return t || "회차";
        const n = String(num);
        const m = /(^|[^\d.-])(\d+(?:[-.]\d+)?\s*화)/.exec(t);
        if (m) {
            const head = t.substring(0, m.index + m[1].length).trim();
            const cut = head && (head.indexOf("…") >= 0 || (w && (w.startsWith(head) || head.startsWith(w))));
            return cut ? t.substring(m.index + m[1].length) : t;
        }
        if (!t || t === w) return `${n}화`;
        return `${n}화 ${t}`;
    }

    async getDetail(url) {
        const id = (/\/(?:webtoon|manhwa|novel)\/(\d+)/.exec(this.path(url)) || [])[1];
        if (!id) throw new Error("작품 주소를 알 수 없습니다");
        const d = await this.json(`${this.base}/api/works/${id}`);
        const w = d.work || {};
        const chapters = [];
        const seen = {};
        for (let p = 1; p <= 100; p++) {
            let r;
            try {
                r = await this.json(`${READER}/works/${id}?page=${p}&size=100&order=asc`);
            } catch (e) {
                if (p === 1) throw e;
                break;
            }
            let added = 0;
            for (const e of r.episodes || []) {
                if (e.ready === false) continue;
                const u = `/${SECTION}/${id}/${e.id}`;
                if (seen[u]) continue;
                seen[u] = true;
                added++;
                const num = Number(e.number);
                chapters.push({
                    name: this.epName(isNaN(num) ? -1 : num, e.title, w.title),
                    url: u,
                    num: isNaN(num) ? -1 : num,
                    dateUpload: e.published_at ? String(Date.parse(e.published_at)) : null
                });
            }
            if (!added || p * 100 >= (Number(r.total) || 0)) break;
        }
        chapters.sort((a, b) => b.num - a.num);
        const info = [
            w.platform || "",
            WEEKDAY_NAMES[w.weekday] ? `${WEEKDAY_NAMES[w.weekday]}요일` : "",
            w.episodeCount ? `총 ${w.episodeCount}화` : ""
        ].filter((s) => s).join(" · ");
        return {
            name: w.title || "",
            imageUrl: w.coverUrl || w.thumbUrl || "",
            author: w.author || "",
            artist: d.illustrator || "",
            description: [String(d.synopsis || "").trim(), info].filter((s) => s).join("\n\n"),
            genre: String(w.genres || "").split(",").map((s) => s.trim()).filter((s, i, a) => s && a.indexOf(s) === i),
            status: w.status === "SERIALIZING" ? 0 : w.status === "COMPLETED" ? 1 : w.status === "HIATUS" ? 2 : 5,
            link: `${this.base}/${SECTION}/${id}`,
            chapters: chapterPosition(chapters.map((c) => ({ name: c.name, url: c.url, dateUpload: c.dateUpload })), w.title || "")
        };
    }

    async episode(url) {
        const ep = this.path(url).replace(/[?#].*$/, "").split("/").filter((s) => s).pop();
        const d = await this.json(`${READER}/episodes/${ep}`);
        if (!d.item) throw new Error("회차 정보를 찾을 수 없습니다");
        // 사이트에서 포인트로 사야 하는 회차 (확장으로는 볼 수 없음)
        if ((d.item.body || []).some((b) => b && b.kind === "paid")) throw new Error(PAID_MSG);
        return d.item;
    }

    // ---------- 그림 (웹툰·만화) ----------
    async getPageList(url) {
        if (MEDIA === "NOVEL") return [];
        const it = await this.episode(url);
        const urls = [];
        for (const b of it.body || []) {
            if (b && (!b.kind || b.kind === "image") && /^https?:\/\//.test(b.url || "") && urls.indexOf(b.url) < 0) urls.push(b.url);
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (준비 중인 회차일 수 있어요)");
        return urls.map((u) => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    // ---------- 본문 (소설) ----------
    async getHtmlContent(name, url) {
        const it = await this.episode(url);
        let raw = "";
        // 소설 본문은 embed_url 의 글자 파일 (웹툰처럼 회차 API 주소면 body 의 글 조각)
        if (/^https?:\/\//.test(it.embed_url || "") && it.embed_url.indexOf("/reader/") < 0) {
            const r = await this.req(it.embed_url, this.hdr());
            if (r.statusCode >= 400) throw new Error(`본문을 받지 못했습니다 (HTTP ${r.statusCode})`);
            raw = fixUtf8(r.body);
        } else {
            raw = (it.body || []).map((b) => (b && b.text) || "").join("\n");
        }
        const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html = String(raw).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter((l) => l).map((l) => `<p>${esc(l)}</p>`).join("");
        if (!html) throw new Error("본문이 비어 있습니다");
        const num = Number(it.number);
        return `<h2>${esc(this.epName(isNaN(num) ? -1 : num, it.title || name || ""))}</h2>` + html;
    }

    async cleanHtmlContent(html) {
        return html;
    }

    // ---------- 필터 ----------
    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        const list = [{ type_name: "HeaderFilter", name: "검색어를 넣으면 제목 검색 (정렬 최신·북마크·조회·화수, 상태만 적용)" }];
        if (MEDIA === "WEBTOON") {
            list.push(sel("분류", "category", WEBTOON_CATEGORIES), sel("상태", "status", STATUSES), sel("정렬", "sort", SORTS),
                sel("요일", "weekday", WEEKDAYS), sel("플랫폼", "platform", opts(WEBTOON_PLATFORMS)), sel("장르", "genre", opts(WEBTOON_GENRES)));
        } else if (MEDIA === "MANHWA") {
            list.push(sel("분류", "category", CATEGORIES), sel("상태", "status", STATUSES), sel("정렬", "sort", SORTS),
                sel("플랫폼", "platform", opts(MANHWA_PLATFORMS)), sel("장르", "genre", opts(MANHWA_GENRES)));
        } else {
            list.push(sel("분류", "category", CATEGORIES), sel("상태", "status", STATUSES), sel("정렬", "sort", SORTS),
                sel("장르", "genre", opts(NOVEL_GENRES)));
        }
        list.push(sel("초성", "initial", opts(INITIALS)));
        return list;
    }

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
            else if (f.type_name === "TextFilter" && typeof s === "string") f.state = s;
            else if (f.type_name === "CheckBox" && typeof s === "boolean") f.state = s;
            else if (f.type_name === "GroupFilter" && Array.isArray(s)) f.state.forEach((c, k) => { c.state = !!s[k]; });
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
            if (f.type_name === "SelectFilter" && f.values[s]) {
                const label = String(f.name || "").replace(/\s*\(.*?\)\s*/g, "").trim();
                parts.push(label === "목록" || label === "정렬" ? f.values[s].name : `${label} ${f.values[s].name}`);
            }
            else if (f.type_name === "TextFilter" && String(s).trim()) parts.push(`${f.name}: ${s}`);
            else if (f.type_name === "CheckBox" && s === true) parts.push(f.name);
            else if (f.type_name === "GroupFilter" && Array.isArray(s)) {
                const on = f.state.filter((c, k) => s[k]).map((c) => c.name);
                if (on.length) parts.push(`장르 ${on.join(",")}`);
            }
        });
        return parts.join(" / ") || fallback;
    }

    async getPopular(page) {
        return addrGuard(this, page, () => this.popularGuarded(page));
    }

    async popularGuarded(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_POPULAR);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.basePopular(page);
    }

    async getLatestUpdates(page) {
        return addrGuard(this, page, () => this.latestGuarded(page));
    }

    async latestGuarded(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_LATEST);
        return s ? this.baseSearch("", page, this.tabRestore(s)) : this.baseLatest(page);
    }

    async search(query, page, filters) {
        const byUrl = await openByUrl(this, query, (p) => { const m = /^\/(webtoon|manhwa|novel)\/(\d+)/.exec(p); return m && m[1] === SECTION ? `/${SECTION}/${m[2]}` : null; });
        if (byUrl) return byUrl;
        await statusRefresh(this.client);
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const list = withParams(filters, this.tabFilterList());
        const rule = list.find((f) => f && f.name === TAB_RULE_NAME);
        const r = rule ? Number(rule.state) || 0 : 0;
        if (r === 1 || r === 2) {
            const states = list.map((f) => {
                if (f && f.type_name === "GroupFilter" && Array.isArray(f.state)) return f.state.map((c) => !!c.state);
                return (!f || f.name === TAB_RULE_NAME || f.state === undefined || typeof f.state === "object") ? null : f.state;
            });
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
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (조회순)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (최신순)")}` },
            {
                type_name: "SelectFilter", name: TAB_RULE_NAME, state: 0,
                values: TAB_RULE_OPTIONS.map((n, i) => ({ type_name: "SelectOption", name: n, value: String(i) }))
            }
        ]);
    }

    // ---------- 상태 표시 ----------
    statusBase() {
        try {
            const b = typeof this.getBaseUrl === "function" ? this.getBaseUrl() : this.base;
            // getBaseUrl 이 비동기(Promise)인 확장은 마지막 정상 주소를 씀
            if (b && typeof b.then === "function") return (this.lastGood && this.lastGood()) || this.source.baseUrl;
            return b;
        } catch (e) {
            return this.source.baseUrl;
        }
    }

    statusAuto() {
        try {
            return typeof this.autoOn === "function" ? this.autoOn() : null;
        } catch (e) {
            return null;
        }
    }

    getFilterList() {
        return statusFilters(STATUS_KEY, this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    getSourcePreferences() {
        return [{
            key: "chapter_position",
            switchPreferenceCompat: {
                title: "회차 이름에 남은 화 표시",
                summary: "예: 51화 · 남은 102화 (사이트 순번·작품 제목은 빼고 짧게). 끄면 원래 이름만 표시 (새 화가 올라오면 이름이 바뀌어, 다운로드한 회차가 안 받은 것처럼 보일 수 있음)",
                value: true
            }
        }, {
            key: "domain",
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://marumaru106.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 marumaru###.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

/** 응답에 charset 이 없으면 망가요미가 Latin-1 로 넘기므로, UTF-8 바이트로 보고 다시 풀어 줌 (이미 한글이면 그대로) */
function fixUtf8(s) {
    s = String(s || "");
    if (/[^\u0000-\u00ff]/.test(s) || !/[\u0080-\u00ff]/.test(s)) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        let n = 0;
        let cp = 0;
        if (c >= 0xc2 && c <= 0xdf) { n = 1; cp = c & 0x1f; }
        else if (c >= 0xe0 && c <= 0xef) { n = 2; cp = c & 0x0f; }
        else if (c >= 0xf0 && c <= 0xf4) { n = 3; cp = c & 0x07; }
        let ok = n > 0 && i + n < s.length;
        for (let k = 1; ok && k <= n; k++) {
            const t = s.charCodeAt(i + k);
            if ((t & 0xc0) !== 0x80) ok = false; else cp = (cp << 6) | (t & 0x3f);
        }
        if (ok) {
            out += String.fromCodePoint(cp);
            i += n;
        } else {
            out += s[i];
        }
    }
    return out;
}

// ---------- 망가요미가 돌려준 필터에 우리 표식(param/_status)이 빠져 있어도 동작하게 ----------
// 앱은 필터를 이름·상태값만 남겨 돌려줄 수 있어서, 같은 이름의 원래 필터에서 param 을 다시 채우고 상태 줄은 뺀다.
const STATUS_LINE = /^(?:📡|🩺|❌|🛡)/;
function withParams(list, base) {
    const out = [];
    for (const f of list || []) {
        if (!f || f._status || (f.type_name === "HeaderFilter" && STATUS_LINE.test(String(f.name || "")))) continue;
        if (!f.param) {
            const b = (base || []).find((x) => x && x.name === f.name && x.type_name === f.type_name);
            if (b && b.param) f.param = b.param;
        }
        out.push(f);
    }
    return out;
}

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

// ---------- 필터 화면 맨 위 상태 표시 (주소 · 자동 찾기 · 감시 점검 결과) ----------
// 점검 결과는 저장소 감시 작업이 올리는 status.json 을 20분에 한 번 받아 두었다가 보여 준다.
const STATUS_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/monitor-state/status.json";

function statusKst(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    const d = new Date(t + 9 * 3600000).toISOString();
    return d.substring(5, 7) + "/" + d.substring(8, 10) + " " + d.substring(11, 16);
}

async function statusRefresh(client) {
    let p;
    try {
        p = new SharedPreferences();
    } catch (e) {
        return;
    }
    const last = Number(p.getString("status_at", "0")) || 0;
    if (Date.now() - last < 20 * 60000) return;
    p.setString("status_at", String(Date.now()));
    try {
        const r = await client.get(STATUS_URL, {});
        const body = String(r.body || "");
        if (r.statusCode === 200 && body.trim().startsWith("{")) p.setString("status_json", body);
    } catch (e) {
        // 다음 기회에 다시 받음
    }
}

function statusFilters(key, base, autoOn) {
    const host = String(base || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const lines = [`📡 주소: ${host}` + (autoOn === null || autoOn === undefined ? "" : ` · 자동 찾기 ${autoOn ? "켜짐" : "꺼짐"}`)];
    let item = null;
    try {
        item = (JSON.parse(new SharedPreferences().getString("status_json", "") || "{}").items || {})[key] || null;
    } catch (e) {
        item = null;
    }
    if (!item || item.ok === undefined) lines.push("🩺 점검: 정보 없음 (목록을 한 번 연 뒤 필터를 다시 열면 표시)");
    else if (item.ok) lines.push(`🩺 점검: 정상 · ${statusKst(item.checkedAt)}`);
    else lines.push(`❌ 점검: 문제 · ${statusKst(item.checkedAt)} · ${String(item.msg || "").substring(0, 40)}`);
    lines.push("🛡 Cloudflare에 막히면: 웹뷰 버튼으로 한 번 열어 통과");
    return lines.map((name) => ({ type_name: "HeaderFilter", name, _status: true }));
}
