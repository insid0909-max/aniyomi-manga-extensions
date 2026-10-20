const mangayomiSources = [{
    "id": 870214005,
    "name": "11toon 만화",
    "lang": "ko",
    "baseUrl": "https://update.spotv24.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.3.33",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "toon11.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

// 11toon숫자.com · spotv숫자.com, 사용자가 알려 준 접속 주소(update.spotv24.com · 91.192.107.81:6600)
const AUTO_HOST = /^(www\.)?((11toon|spotv)\d*\.com|[a-z0-9-]+\.spotv24\.com|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/;
const AUTO_NUM = /(?:11toon|spotv)(\d+)/;
const AUTO_PROBE = "/";
// 진짜 일일툰 페이지에 있는 글자 (주소 안내 페이지와 구별)
const AUTO_MARKER = "bo_table=toon";
const T11_GUIDE = "https://11toon1.com/";
// 안내 사이트의 "현재주소"(11toon148.com 등)는 국내에서 막히는 일이 있어, 국내에서 열리는 주소를 먼저 씀
const T11_ALTERNATES = ["https://update.spotv24.com", "http://91.192.107.81:6600"];
// 2026.10 개편 때 설정 키를 바꿈 (옛 11toon2 · 11toon148 저장값을 쓰지 않게)
const T11_DOMAIN_KEY = "domain_v2";
const T11_AUTO_KEY = "auto_domain_v2";

// 11toon 만화 (일일툰) - Aniyomi 확장(Toon11.kt)과 같은 구조를 망가요미용으로 옮김
// 2026.10 사이트 개편 뒤 게시판 구조:
// 목록: /bbs/board.php?bo_table=toon_c&tablename=인기만화 (type=upd 최신, is_over=1 완결, sca=장르, page=N)
// 작품: /bbs/board.php?bo_table=toons&is={작품id}&page=N (회차 100개씩), 회차: bo_table=toons&wr_id={회차id}
// 회차 이미지: 회차 페이지의 img_list (예비 서버 img_list_2), 검색: /bbs/ajax.search.php?search_key= (JSON)
// 앱 안의 작품·회차 주소는 예전 모양(/mb/content/info/{id}, /mb/content/image/{id}) 그대로 두어 서재·읽은 기록이 이어짐
// 목록 종류 (사이트 메뉴)
const T11_LISTS = [
    ["인기만화", "tablename=%EC%9D%B8%EA%B8%B0%EB%A7%8C%ED%99%94"],
    ["최신만화", "type=upd&tablename=%EC%B5%9C%EC%8B%A0%EB%A7%8C%ED%99%94"],
    ["완결만화", "is_over=1&tablename=%EC%99%84%EA%B2%B0%EB%A7%8C%ED%99%94"],
    ["매일 추천 100", "type=today&tablename=%EB%A7%A4%EC%9D%BC%20%EC%B6%94%EC%B2%9C%20100"]
];

// ---------- 접속 속도 제한 · 주소로 바로 열기 ----------
// 사이트로 가는 요청 사이에 최소 간격 (한꺼번에 많이 요청하면 사이트가 403으로 막음). 그림 요청은 제외
let lastSiteRequest = 0;
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
// 사이트 장르 탭 (sca 값, 0 = 전체)
const T11_GENRES = ["전체", "BL", "러브코미디", "17", "판타지", "순정", "드라마", "학원", "게임", "SF", "스릴러", "먹방", "TS",
    "스포츠", "이세계", "추리", "일상", "라노벨", "백합", "시대", "애니화", "전생", "붕탁", "무협", "호러", "공포"];

async function siteWait(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/.exec(String(url || ""));
    if (!m || !AUTO_HOST.test(m[1]) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
    const wait = lastSiteRequest + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSiteRequest = Date.now();
}

// 검색창에 사이트 작품(또는 회차) 주소를 붙여 넣으면 그 작품을 바로 보여 줌 (주소 번호가 달라도 됨)
async function openByUrl(ext, query, toLink) {
    const m = /^https?:\/\/([^/?#]+)(\/[^#]*)?/.exec(String(query || "").trim());
    if (!m || !AUTO_HOST.test(m[1])) return null;
    const link = toLink(m[2] || "/");
    if (!link) return null;
    const d = await ext.getDetail(link);
    return { list: d && d.name ? [{ name: d.name, imageUrl: d.imageUrl || "", link }] : [], hasNextPage: false };
}

// 회차 순서: 이름에서 숫자 앞부분(작품 제목 단어는 빼고)이 같은 것끼리 묶어 번호순으로 놓음 (결과는 최신 → 과거)
// 단위가 다르면 다른 묶음 ("원피스 1화"/"원피스 1권"), 단 번호가 본편과 안 겹치면 본편 ("12화"/"13")
// "(ONE PIECE)원피스 775화" 와 "1194화" 는 같은 묶음, "스핀오프 - 식극의 상디" 와 "식극의 상디" 도 같은 묶음
// 회차가 가장 많은 묶음이 본편 → 맨 앞, 그다음 번호 없는 특별편(후기 등), 다른 묶음(처음 올라온 순), 번외, 외전. 프롤로그는 맨 앞
// "6-1화" 는 6.01, "1.5화" 는 1.5, "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편
// 망가요미는 이름 맨 앞 숫자로 회차 번호를 정하므로, 본편이 아닌 회차는 이름 앞에 본편 마지막 번호 다음 순번을 붙임
// ("1195 · 원피스 매거진 1호") → "화 번호별" 정렬도 본편 1화 ~ 끝 → 나머지 순서
// "시즌2 1화" 처럼 시즌 표시가 있으면 시즌 순서가 먼저: 표시 없는 회차(시즌1) → 시즌2 → …, 본편은 시즌1 안에서 고름
function orderChapters(list, title) {
    if (!list || list.length < 2) return list;
    const PRO = "\u0000prologue";
    const norm = (p) => String(p || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const isExtra = (p) => p.indexOf("번외") >= 0 || p.indexOf("외전") >= 0;
    const seasonOf = (p) => { const m = /(?:시즌|season)(\d+)$|(\d+)부$/.exec(p || ""); return m ? parseInt(m[1] || m[2], 10) : 1; };
    // 제목 전체를 먼저 지움 ("시아버지가 다 따먹음 10화" 의 한 글자 단어 "다" 도 지워지게)
    const titleWords = [...new Set([norm(title)].concat((String(title || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
        .filter((w) => w.length >= 2)))].filter((w) => w).sort((a, b) => b.length - a.length);
    const keyOf = (c, i, arr) => {
        // 이름 맨 앞 사이트 순번 ("0001 - 별을 품은 소드마스터 1화") 은 비교에서 뺌
        const name = String(c.name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "");
        const index = arr.length - 1 - i;
        // "2부 172화" 의 "2부" 는 부 표시 (뒤에 다른 단위 번호가 있으면 그것이 회차)
        // "1~5화" 처럼 여러 화를 묶은 회차는 첫 화 번호
        const units = [...name.matchAll(/(\d+)(?:\s*([-.])\s*(\d+))?(?:\s*[~～]\s*\d+)?\s*(화|권|호|부|話)/g)];
        // 같은 단위 번호가 여러 개면 마지막 것 ("1화 222화" 는 사이트가 잘못 적은 222화, 두 번 사는 랭커).
        // 괄호 안 번호는 덧붙인 설명이라 빼고 봄 ("143화 (외전 2화)" 는 143화, 말단 병사에서 군주까지)
        const brackets = [...name.matchAll(/\([^)]*\)|\[[^\]]*]|（[^）]*）/g)].map((b) => [b.index, b.index + b[0].length]);
        let chapterUnits = units.filter((u) => u[4] !== "부" && !brackets.some(([a, b]) => u.index >= a && u.index < b));
        if (!chapterUnits.length) chapterUnits = units.filter((u) => u[4] !== "부");
        const m = chapterUnits.filter((u) => u[4] === chapterUnits[0][4]).pop() || units[0] || /(\d+)(?:\s*([-.])\s*(\d+))?/.exec(name);
        if (!m) return /프롤로그|prologue/i.test(name) ? { prefix: PRO, unit: "", num: 0, index } : { prefix: "", unit: "", num: -1, index };
        // "2부 예고" 처럼 부 표시 뒤에 번호 없는 말만 있으면 그 부의 번호 없는 회차
        if (m[4] === "부" && /\p{L}/u.test(name.substring(m.index + m[0].length))) {
            let part = norm(name.substring(0, m.index + m[0].length));
            titleWords.forEach((w) => { part = part.split(w).join(""); });
            return { prefix: part, unit: "", num: -1, index };
        }
        let num = parseInt(m[1], 10);
        if (m[3]) num = m[2] === "." ? parseFloat(`${m[1]}.${m[3]}`) : num + Math.min(parseInt(m[3], 10), 99) / 100;
        let prefix = norm(name.substring(0, m.index));
        titleWords.forEach((w) => { prefix = prefix.split(w).join(""); });
        // "제62화" 의 "제" 는 번호 앞에 붙는 말 ("62화" 와 같은 묶음)
        if (prefix.endsWith("제")) prefix = prefix.slice(0, -1);
        return { prefix, unit: m[4] || "", num, index };
    };
    // 앞뒤 회차와 동떨어진 번호는 사이트가 잘못 적은 것 ("2화" 옆 "56화" 가 실제 1화, 늑대닷컴 무직전생):
    // 앞뒤 번호가 서로 가깝고(2 이하) 이 회차 번호는 둘과 10 넘게 차이 나며, 그 사이(맨 끝이면 바로 옆)에
    // 아무도 쓰지 않은 번호가 있으면 그 번호로 바로잡음
    const pre = list.map((c, i) => keyOf(c, i, list));
    // 같은 단위 번호끼리만 봄 ("번외1" 의 1 은 "1화" 와 다름)
    const used = new Set(pre.filter((k) => k.num >= 0).map((k) => `${k.unit}|${k.num}`));
    const fixed = new Map();
    const idx = pre.map((k, i) => i).filter((i) => pre[i].num >= 0 && pre[i].prefix !== PRO);
    idx.forEach((i, p) => {
        const k = pre[i];
        const a = p > 0 && pre[idx[p - 1]].unit === k.unit ? pre[idx[p - 1]] : null;
        const b = p + 1 < idx.length && pre[idx[p + 1]].unit === k.unit ? pre[idx[p + 1]] : null;
        if (!a && !b) return;
        if ([a, b].some((x) => x && Math.abs(x.num - k.num) <= 10)) return;
        let cand;
        if (a && b) {
            if (Math.abs(a.num - b.num) > 2) return;
            cand = [];
            for (let n = Math.floor(Math.min(a.num, b.num)) + 1; n < Math.floor(Math.max(a.num, b.num)); n++) cand.push(n);
        } else {
            // 맨 끝: 목록은 최신 → 과거라서 앞(a)만 있으면 가장 오래된 회차 → 한 번호 작게
            cand = [a ? a.num - 1 : b.num + 1];
        }
        const n = cand.find((x) => x >= 0 && !used.has(`${k.unit}|${x}`));
        if (n === undefined) return;
        used.add(`${k.unit}|${n}`);
        fixed.set(list[i], n);
    });
    // 이름이 똑같은 회차(사이트에 같은 화가 여러 번 올라온 것, 11toon 주술회전)는 가장 최근 업로드 하나만 (바로잡은 회차는 남김)
    const best = {};
    list.forEach((c, i) => {
        if (fixed.has(c)) return;
        const k = String(c.name || "").trim().replace(/\s+/g, " ").toLowerCase();
        if (best[k] === undefined || Number(c.dateUpload || 0) > Number(list[best[k]].dateUpload || 0)) best[k] = i;
    });
    const keep = new Set(Object.values(best));
    if (keep.size + fixed.size < list.length) list = list.filter((c, i) => keep.has(i) || fixed.has(c));
    if (list.length < 2) return list;
    const keys = list.map((c, i) => {
        const k = keyOf(c, i, list);
        if (fixed.has(c)) { k.num = fixed.get(c); k.fixed = true; }
        return k;
    });
    // 앞부분이 다른 앞부분으로 끝나면 같은 시리즈, 번외·외전끼리만 따로
    const prefixes = [...new Set(keys.map((k) => k.prefix))].filter((p) => p !== PRO && p.length >= 2)
        .sort((a, b) => a.length - b.length);
    const canon = {};
    prefixes.forEach((p, i) => {
        const q = prefixes.slice(0, i).find((x) => x.length < p.length && p.endsWith(x) && isExtra(x) === isExtra(p));
        canon[p] = q ? (canon[q] || q) : p;
    });
    keys.forEach((k) => { if (canon[k.prefix]) k.prefix = canon[k.prefix]; });
    // 묶음 = 앞부분 + 단위 ("원피스 1화" 와 "원피스 1권" 은 다른 묶음). 번외·외전은 단위 상관없이 한 묶음
    keys.forEach((k) => { k.group = isExtra(k.prefix) ? k.prefix : `${k.prefix}|${k.unit}`; });
    const collect = () => {
        const groups = {};
        keys.forEach((k) => {
            if (k.num < 0 || k.prefix === PRO) return;
            const g = groups[k.group] || (groups[k.group] = { count: 0, first: k.index, prefix: k.prefix, nums: new Set() });
            g.count++;
            g.first = Math.min(g.first, k.index);
            g.nums.add(k.num);
        });
        return groups;
    };
    let groups = collect();
    // 시즌 표시가 있으면 본편은 가장 앞 시즌(보통 표시 없는 시즌1) 묶음 중에서 고름
    const plain = Object.keys(groups).filter((g) => !isExtra(groups[g].prefix));
    const firstSeason = plain.length ? Math.min(...plain.map((g) => seasonOf(groups[g].prefix))) : 1;
    let main = null;
    for (const g of Object.keys(groups)) {
        if (isExtra(groups[g].prefix) || seasonOf(groups[g].prefix) !== firstSeason) continue;
        if (main === null || groups[g].count > groups[main].count ||
            (groups[g].count === groups[main].count && groups[g].first < groups[main].first)) main = g;
    }
    // 앞부분이 같고 번호가 본편과 안 겹치면 단위만 빠진 본편 ("12화" 와 "13") → 본편에 합침
    if (main !== null) {
        const mg = groups[main];
        for (const g of Object.keys(groups)) {
            // 앞부분이 같고 번호가 안 겹치거나, 번외·외전이 아니면서 번호가 모두 본편의 빈 번호면 본편
            // ("화화화작품명 21화" 처럼 사이트가 잘못 적은 경우도)
            // 단위가 다르면("1부 01권" 과 "66화") 번호가 비어 있어도 다른 묶음
            const sameUnit = g.split("|")[1] === main.split("|")[1];
            const before = sameUnit && !isExtra(groups[g].prefix) && [...groups[g].nums].every((n) => n < Math.max(...mg.nums) && !mg.nums.has(n)) &&
                seasonOf(groups[g].prefix) === seasonOf(mg.prefix);
            const sameUnitless = groups[g].prefix === mg.prefix && ![...groups[g].nums].some((n) => mg.nums.has(n));
            // 다음 시즌·부가 본편 번호를 이어 가면 ("64화" 다음 "2부 65화") 본편
            const after = sameUnit && !isExtra(groups[g].prefix) && seasonOf(groups[g].prefix) > seasonOf(mg.prefix) &&
                [...groups[g].nums].every((n) => n > Math.max(...mg.nums));
            if (g === main || !(sameUnitless || before || after)) continue;
            keys.forEach((k) => { if (k.group === g) k.group = main; });
        }
        groups = collect();
    }
    const rank = (k) => k.prefix === PRO ? -1 : k.num < 0 ? 1 : k.group === main ? 0
        : k.prefix.indexOf("번외") >= 0 ? 3 : k.prefix.indexOf("외전") >= 0 ? 4 : 2;
    const firstOf = (k) => (rank(k) >= 2 ? groups[k.group].first : 0);
    // 시즌 순서 (프롤로그는 맨 앞, 번외·외전은 모든 시즌 뒤)
    const seasons = keys.some((k) => k.num >= 0 && !isExtra(k.prefix) && seasonOf(k.prefix) > firstSeason);
    const season = (k) => rank(k) === -1 ? -1e9 : rank(k) >= 3 ? 1e9 : !seasons ? 0 : seasonOf(k.prefix);
    const order = list.map((_, i) => i).sort((a, b) => {
        const x = keys[a], y = keys[b];
        return season(x) - season(y) || rank(x) - rank(y) || firstOf(x) - firstOf(y) || x.num - y.num || x.index - y.index;
    });
    let next = Math.floor(Math.max(0, ...keys.filter((k) => k.group === main && k.num >= 0).map((k) => k.num)));
    order.forEach((i) => {
        if (rank(keys[i]) > 0) list[i] = Object.assign({}, list[i], { name: `${++next} · ${String(list[i].name || "").trim()}` });
        // 본편인데 회차 번호 앞에 다른 숫자가 있으면 ("2부 172화") 망가요미가 그 숫자를 읽지 않게 번호를 앞에 붙임
        else if (rank(keys[i]) === 0 && (/\d/.test(keys[i].prefix) || keys[i].fixed)) {
            list[i] = Object.assign({}, list[i], { name: `${keys[i].num} · ${String(list[i].name || "").trim()}` });
        }
    });
    return order.reverse().map((i) => list[i]);
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

function nfc(s) {
    try {
        return String(s).normalize("NFC");
    } catch (e) {
        return String(s);
    }
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

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
        this.coverBase = "https://11toon8.com/data/toon_category/";
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
            const manual = this.cleanUrl(prefs.get(T11_DOMAIN_KEY));
            // 직접 넣은 주소는 기본 주소와 같아도 그대로 씀 (설정 기본값은 빈 칸)
            if (manual) {
                // 직접 넣은 주소는 바로 씀. 단 자동 찾기로 그보다 번호가 큰 진짜 사이트 주소가 확인되면 그 주소로 바꾸고 설정 칸도 고침
                const newer = this.cleanUrl(prefs.getString(T11_AUTO_KEY, ""));
                const num = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
                if (newer && newer !== manual && num(newer) > num(manual) && this.autoOn()) {
                    prefs.setString(T11_DOMAIN_KEY, newer);
                    return newer;
                }
                return manual;
            }
            // 자동으로 찾은 주소가 확장 업데이트로 바뀐 기본 주소보다 옛 번호면 기본 주소를 씀
            const auto = this.cleanUrl(prefs.getString(T11_AUTO_KEY, ""));
            const n = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
            return auto || this.source.baseUrl;
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

    async reqRaw(url, headers, post, body) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
        let failed = null;
        let error = null;
        let notice = null;
        try {
            const res = post ? await this.client.post(url, headers || {}, body) : await this.client.get(url, headers || {});
            // 자동으로 찾은 주소가 막히면(403) 자동 주소를 지우고 기본 주소로 다시 요청
            if (ours && res.statusCode === 403 && base !== this.source.baseUrl && !this.cleanUrl(new SharedPreferences().get(T11_DOMAIN_KEY))) {
                new SharedPreferences().setString(T11_AUTO_KEY, "");
                const fb = this.source.baseUrl;
                const h = {};
                for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(fb);
                const r2 = (post ? await this.client.post(fb + url.substring(base.length), h, body) : await this.client.get(fb + url.substring(base.length), h));
                if (r2.statusCode < 400) return r2;
            }
            if (ours && !post && res.statusCode === 200) notice = await noticeTarget(this, res.body, base, AUTO_MARKER);
            // 정상 화면에 적힌 더 새 주소(사이트가 새 주소로 넘겨 준 경우 포함)를 자동 주소로 기억
            if (ours && !post && !notice && res.statusCode === 200) {
                const self = await selfTarget(this, res.body, base, AUTO_MARKER);
                if (self) new SharedPreferences().setString(T11_AUTO_KEY, self);
            }
            if (!notice && (!ours || !(res.statusCode >= 500))) return res;
            failed = res;
        } catch (e) {
            if (!ours) throw e;
            error = e;
        }
        const found = notice || await this.discover(base);
        if (notice) new SharedPreferences().setString(T11_AUTO_KEY, notice);
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
        if (found) prefs.setString(T11_AUTO_KEY, found);
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

    /** 지금 번호 다음 10개 (11toon149 …) */
    autoCandidates(current) {
        const n = parseInt((String(current).match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const out = [];
        if (n > 1 && /11toon\d+\.com/.test(String(current))) for (let i = n + 1; i <= n + 10; i++) out.push(`https://11toon${i}.com`);
        return out;
    }

    /** 예비 주소 → 주소 안내 사이트(11toon1.com)의 "일일툰현재주소" 중 실제로 열리는 주소 (큰 번호 우선) */
    async autoGuide(current) {
        let body = "";
        try {
            body = String((await this.client.get(T11_GUIDE, { "User-Agent": MOBILE_UA })).body || "");
        } catch (e) {}
        const num = u => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const hosts = T11_ALTERNATES.concat([...new Set((body.match(/(?:www\.)?(?:11toon|spotv)\d+\.com/gi) || []).map(h => "https://" + h.toLowerCase()))]
            .filter(h => num(h) > 1).sort((a, b) => num(b) - num(a))).filter(h => h !== current);
        for (const h of hosts) {
            try {
                const r = await this.client.get(h + "/", { "User-Agent": MOBILE_UA });
                if (r.statusCode === 200 && String(r.body || "").includes(AUTO_MARKER)) return h;
            } catch (e) {}
        }
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

    // 앱 안 주소는 예전 모양 그대로 (서재·읽은 기록 유지)
    mangaUrl(id) {
        return `/mb/content/info/${id}?page=toon`;
    }

    mangaId(u) {
        return ((u || "").match(/\/content\/info\/(\d+)/) || (u || "").match(/[?&]is=(\d+)/) || [])[1];
    }

    chapterId(u) {
        return ((u || "").match(/\/content\/image\/(\d+)/) || (u || "").match(/[?&]wr_id=(\d+)/) || [])[1];
    }

    /** 사이트 작품 페이지 (회차 목록 page 쪽) */
    sitePage(id, page) {
        return `${this.base}/bbs/board.php?bo_table=toons&is=${id}` + (page > 1 ? `&page=${page}` : "");
    }

    siteViewer(cid) {
        return `${this.base}/bbs/board.php?bo_table=toons&wr_id=${cid}`;
    }

    // ---------- 목록 ----------
    /** 목록·검색 화면의 작품 카드 (li > a[href*=is=] / li[data-id][data-title]) */
    parseCards(html) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const li of doc.select("li")) {
            if (!li.select(".homelist-title").length) continue;
            const a = li.select("a[href*='is=']");
            let id = a.length ? ((a[0].attr("href") || "").match(/[?&]is=(\d+)/) || [])[1] : null;
            if (!id && li.attr("data-title") && /^\d+$/.test(li.attr("data-id") || "")) id = li.attr("data-id");
            if (!id || seen[id]) continue;
            const t = li.select(".homelist-title span");
            const name = ((t.length ? (t[0].attr("title") || t[0].text) : "") || li.attr("data-title") || "").trim();
            if (!name) continue;
            seen[id] = true;
            const th = li.select(".homelist-thumb");
            let img = th.length ? (th[0].attr("data-mobile-image") || ((th[0].attr("style") || "").match(/url\(['"]?([^'")]+)/) || [])[1] || "") : "";
            if (img) { img = this.abs(img); this.rememberCover(img); } else img = this.coverFor(id);
            list.push({ name, imageUrl: img, link: this.mangaUrl(id) });
        }
        return list;
    }

    /** query: 목록 종류(tablename 등), genre: 사이트 sca 값 */
    async listPage(query, genre, page) {
        const url = `${this.base}/bbs/board.php?bo_table=toon_c&${query}` + (genre ? `&sca=${encodeURIComponent(genre)}` : "") + (page > 1 ? `&page=${page}` : "");
        const html = (await this.req(url, this.hdr())).body;
        const list = this.parseCards(html);
        // 다음 쪽 링크가 있을 때만 더 있음
        const pages = (String(html).match(/[?&](?:amp;)?page=(\d+)/g) || []).map(x => parseInt(x.replace(/\D+/g, ""), 10));
        return { list, hasNextPage: list.length > 0 && pages.some(n => n > page) };
    }

    async getPopular(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_POPULAR);
        if (s) return this.categoryList(page, this.tabRestore(s));
        return this.listPage(T11_LISTS[0][1], "", page);
    }

    async getLatestUpdates(page) {
        await statusRefresh(this.client);
        const s = this.tabLoad(TAB_KEY_LATEST);
        if (s) return this.categoryList(page, this.tabRestore(s));
        return this.listPage(T11_LISTS[1][1], "", page);
    }

    /** 필터(목록 종류 · 장르)로 고른 목록 */
    async categoryList(page, filters) {
        const val = (param) => {
            const f = (filters || []).find((x) => x && x.param === param);
            return f && f.values && f.values[f.state] ? f.values[f.state].value : "";
        };
        const list = T11_LISTS.find((l) => l[1] === val("list")) || T11_LISTS[0];
        return this.listPage(list[1], val("sca"), page);
    }

    // 검색: 검색어가 없으면 필터 목록, 있으면 사이트 검색창과 같은 자동완성 검색 (JSON: list[wr_id, wr_subject, ca_name, wr_6=작가], counts=만화 개수)
    async search(query, page, filters) {
        const byUrl = await openByUrl(this, query, (p) => { const id = this.mangaId(p); return id ? this.mangaUrl(id) : null; });
        if (byUrl) return byUrl;
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
        const flist = withParams(filters, this.tabFilterList());
        const rule = flist.find((f) => f && f.name === TAB_RULE_NAME);
        const r = rule ? Number(rule.state) || 0 : 0;
        if (r === 1 || r === 2) {
            const states = flist.map((f) => (!f || f.name === TAB_RULE_NAME || f.state === undefined || typeof f.state === "object") ? null : f.state);
            this.tabStore(r === 1 ? TAB_KEY_POPULAR : TAB_KEY_LATEST, states);
        }
        if (r === 3 || r === 5) this.tabStore(TAB_KEY_POPULAR, null);
        if (r === 4 || r === 5) this.tabStore(TAB_KEY_LATEST, null);
        if (!String(query || "").trim()) return this.categoryList(page, flist);
        if (page > 1) return { list: [], hasNextPage: false };
        const res = await this.req(`${this.base}/bbs/ajax.search.php?search_key=${encodeURIComponent(query.trim())}`,
            Object.assign(this.hdr(), { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }));
        let json = {};
        try {
            const body = String(res.body || "");
            json = JSON.parse(body.substring(Math.max(0, body.indexOf("{"))));
        } catch (e) {
            json = {};
        }
        const arr = Array.isArray(json.list) ? json.list : [];
        const comics = json.counts !== undefined ? Number(json.counts) : arr.length;
        const list = arr.slice(0, comics).filter((o) => o && o.wr_id && o.wr_subject)
            .map((o) => ({ name: String(o.wr_subject).trim(), imageUrl: this.coverFor(o.wr_id), link: this.mangaUrl(o.wr_id) }));
        return { list, hasNextPage: false };
    }

    // ---------- 상세 + 회차 (작품 페이지, 회차는 100개씩 여러 쪽) ----------
    /** "장르 : …", "분류 : 완결", "작가 : …", "소개 : …" 줄 */
    infoLine(html, label) {
        const m = new RegExp(`genre-subtitle">\\s*${label}\\s*:\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`).exec(html);
        return m ? m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : "";
    }

    parseEpisodes(html, id, title, seen) {
        const out = [];
        const doc = new Document(html);
        for (const b of doc.select("button[onclick*='wr_id']")) {
            const cid = ((b.attr("onclick") || "").match(/wr_id=(\d+)/) || [])[1];
            if (!cid || seen[cid]) continue;
            const tt = b.select(".episode-title");
            if (!tt.length) continue;
            seen[cid] = true;
            // 사이트가 한글을 자모로 풀어 적은 회차("열혈강호 729")도 있어 보통 한글로 모음
            const full = nfc(String(tt[0].text || "").trim());
            // 사이트와 같이 회차 제목에서 작품 제목을 뺌 ("Re: 열혈강호 14권" → "Re: 14권")
            const name = (title ? full.split(nfc(title)).join("") : full).replace(/\s+/g, " ").trim() || full || cid;
            const fd = b.select(".free-date");
            const d = (fd.length ? fd[0].text : "").match(/(\d{2})\.(\d{2})\.(\d{2})/);
            out.push({
                name,
                url: `/mb/content/image/${cid}?page=toon&parent_id=${id}`,
                dateUpload: d ? String(new Date(`20${d[1]}-${d[2]}-${d[3]}T00:00:00+09:00`).valueOf()) : null
            });
        }
        return out;
    }

    async getDetail(url) {
        const id = this.mangaId(url) || String(url).replace(/\D+/g, "");
        const html = (await this.req(this.sitePage(id, 1), this.hdr())).body;
        const doc = new Document(html);
        const h2 = doc.select("h2.title");
        const subject = (h2.length ? h2[0].text : "").trim();
        const seen = {};
        const chapters = this.parseEpisodes(html, id, subject, seen);
        // 다음 쪽: 새 회차가 나오는 동안 계속 (최대 200쪽)
        for (let p = 2; p <= 200 && chapters.length >= (p - 1) * 100; p++) {
            let more = [];
            try {
                more = this.parseEpisodes((await this.req(this.sitePage(id, p), this.hdr())).body, id, subject, seen);
            } catch (e) {
                break;
            }
            if (!more.length) break;
            chapters.push(...more);
        }
        if (!chapters.length) throw new Error("11toon 회차 목록을 불러오지 못했습니다");

        const state = this.infoLine(html, "분류");
        let status = 5;
        if (state.includes("완결")) status = 1;
        else if (state.includes("연재")) status = 0;
        const banner = doc.select("img.banner");
        const img = banner.length && (banner[0].attr("src") || "").includes("toon_category") ? this.abs(banner[0].attr("src")) : this.coverFor(id);
        return {
            name: subject,
            imageUrl: img,
            author: this.infoLine(html, "작가"),
            description: this.infoLine(html, "소개"),
            genre: this.infoLine(html, "장르").split(/[,\/]/).map(s => s.trim()).filter(s => s),
            status,
            chapters: chapterPosition(orderChapters(chapters, subject), subject)
        };
    }

    // ---------- 이미지: 회차 페이지의 img_list (안 되면 예비 서버 img_list_2) ----------
    async getPageList(url) {
        const cid = this.chapterId(url);
        if (!cid) throw new Error("잘못된 회차 주소");
        const pageUrl = this.siteViewer(cid);
        const html = String((await this.req(pageUrl, this.hdr())).body || "");
        const pick = (name) => {
            const m = new RegExp(`var\\s+${name}\\s*=\\s*(\\[[^\\]]*\\])`).exec(html);
            if (!m) return [];
            try {
                return JSON.parse(m[1]).filter((x) => x).map((x) => this.abs(x));
            } catch (e) {
                return [];
            }
        };
        let urls = pick("img_list");
        if (!urls.length) urls = pick("img_list_2");
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.filter((u, i) => urls.indexOf(u) === i).map(u => ({ url: u, headers: { "Referer": pageUrl, "User-Agent": MOBILE_UA } }));
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
        return statusFilters("toon11", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어를 입력하면 필터는 무시됩니다" },
            sel("목록", "list", T11_LISTS.map((l) => [l[0], l[1]])),
            sel("장르", "sca", T11_GENRES.map((n, i) => [n, i ? n : ""]))
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
            if (f.type_name === "SelectFilter" && f.values[s] && s > 0) parts.push(`${f.name} ${f.values[s].name}`);
        });
        return parts.join(" / ") || "전체";
    }

    tabFilterList() {
        const base = this.baseFilterList();
        return base.concat([
            { type_name: "HeaderFilter", name: "조건을 고른 뒤 Filter를 누르면 저장됩니다." },
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (사이트 인기 목록)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (사이트 최신 목록)")}` },
            {
                type_name: "SelectFilter", name: TAB_RULE_NAME, state: 0,
                values: TAB_RULE_OPTIONS.map((n, i) => ({ type_name: "SelectOption", name: n, value: String(i) }))
            }
        ]);
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
            key: T11_DOMAIN_KEY,
            editTextPreference: {
                title: "도메인 주소 (수동)",
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://update.spotv24.com, http://91.192.107.81:6600)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 예비 주소(update.spotv24.com · 91.192.107.81:6600)와 주소 안내(11toon1.com)에 적힌 주소 중 열리는 곳으로 자동 변경",
                value: true
            }
        }];
    }
}

// 필터 목록에서 맨 위 상태 줄을 빼고, 앱이 넘겨준 필터에 빠진 param 을 원래 목록에서 채움
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

// ---------- 앱 기본 User-Agent 사용 ----------
// 망가요미는 내장 웹뷰에서 Cloudflare 확인을 통과하면 쿠키와 그 웹뷰의 User-Agent 를 함께 저장하고,
// 요청에 User-Agent 가 없을 때만 그 값을 넣는다. 확장이 고정 User-Agent 를 보내면 통과 쿠키가 거부되므로
// 사이트(문서·API) 요청에서는 확장의 User-Agent 를 빼고 앱 값을 쓰게 한다. 영상·이미지 주소 요청은 그대로 둔다.
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
