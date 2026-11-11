const mangayomiSources = [{
    "id": 870214015,
    "name": "고래툰 웹툰",
    "lang": "ko",
    "baseUrl": "https://003.grtoon.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.1.25",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "goraetoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

// 고래툰 (001.grtoon.com, 예전 주소 goraetoon##.com 은 새 주소로 넘겨 줌).
// 목록: 사이트가 작품 목록을 통째로 JSON 으로 줌 (/catalog-data/webtoon-active·ongoing·completed.json, top.json) → 사이트 화면과 같은 규칙으로 거름.
// 작품: /webtoon/{번호}.html (회차 전부), 회차: /webtoons/{번호}/{회차}.html (그림은 img[o_src] + 그림 서버 주소)
const AUTO_HOST = /^\d{3}\.grtoon\.com$/;
const AUTO_NUM = /\/\/(\d+)\.grtoon/;
// 진짜 사이트 화면마다 있는 글자 (로딩 그림 이름)
const MARK = "goraetoon-loading.svg";
// 최신 주소 안내 (사용자가 알려 줌, 2026-10-31, "고래툰 최신주소 https://NNN.grtoon.com/")
const GR_GUIDES = ["https://goraetoonurl.com/latest-address"];
const PAGE_SIZE = 30;
const CATALOG = {};
const BEST_PERIODS = ["day", "week", "month", "realtime"];
const LISTS = [["연재 (오늘 업데이트)", "ongoing"], ["완결", "completed"], ["실시간 BEST", "realtime"], ["일간 BEST", "day"], ["주간 BEST", "week"], ["월간 BEST", "month"]];
const BEST_TYPES = [["일반웹툰", "comm"], ["성인웹툰", "adult"], ["BL/백합", "bl"]];
const DAYS = [["전체 (UP)", ""], ["월", "mon"], ["화", "tue"], ["수", "wed"], ["목", "thu"], ["금", "fri"], ["토", "sat"], ["일", "sun"], ["10일", "ten"]];
const SORTS = [["최신순", "new"], ["인기순", "hot"]];
const PLATFORMS = ["네이버", "다음", "카카오", "레진", "투믹스", "탑툰", "코미카", "배틀코믹", "코믹GT", "케이툰", "애니툰", "폭스툰", "피너툰", "봄툰", "코미코", "무툰", "기타"];
const GENRES = ["학원", "액션", "SF", "스토리", "판타지", "BL/백합", "개그/코미디", "연애/순정", "드라마", "로맨스", "시대극", "스포츠", "일상", "추리/미스터리", "공포/스릴러", "성인", "옴니버스", "에피소드", "무협", "소년", "기타"];

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

// ---------- 접속 속도 제한 · 주소로 바로 열기 ----------
// 사이트로 가는 요청 사이에 최소 간격 (한꺼번에 많이 요청하면 사이트가 403으로 막음). 그림 요청은 제외
let lastSiteRequest = 0;
async function siteWait(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/.exec(String(url || ""));
    if (!m || !(AUTO_HOST.test(m[1]) || /^(?:www\.)?goraetoon\d+\.com$/.test(m[1])) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
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
        let name = String(c.name || "").trim();
        const seq = /^(\d{2,})(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/.exec(name);
        if (seq) name = name.substring(seq[0].length);
        // "143. 제50장. 객잔의 밤 (3)"·"나노마신 248. 제84장 …" 처럼 맨 앞 "N." 이 회차 번호인 이름 (뒤에 화·권·호 번호가 없을 때)
        // → "N화" 로 봄 (굿툰 나노마신: "나노마신 142화" 사이에 섞임). 사이트 순번만 "N." 이면 그 번호
        {
            const t = String(title || "").trim();
            const body = t && name.startsWith(t) ? name.substring(t.length).trim() : name;
            const dot = /^(\d+)\.\s+(?=\S)/.exec(body);
            const noUnit = (s) => !/\d+\s*(?:화|권|호|話)/.test(s);
            if (dot && noUnit(body.substring(dot[0].length))) name = `${dot[1]}화 ${body.substring(dot[0].length)}`;
            else if (seq && /^\d+\.\s/.test(seq[0]) && !dot && noUnit(name) && /\p{L}/u.test(name)) name = `${parseInt(seq[1], 10)}화 ${name}`;
        }
        const index = arr.length - 1 - i;
        // "2부 172화" 의 "2부" 는 부 표시 (뒤에 다른 단위 번호가 있으면 그것이 회차)
        // "1~5화" 처럼 여러 화를 묶은 회차는 첫 화 번호
        const units = [...name.matchAll(/(\d+)(?:\s*([-.])\s*(\d+))?(?:\s*[~～]\s*\d+)?\s*(화|권|호|부|話)/g)];
        // 같은 단위 번호가 여러 개면 마지막 것 ("1화 222화" 는 사이트가 잘못 적은 222화, 두 번 사는 랭커).
        // 단 맨 앞 번호 뒤에 제목 글자가 있고 그 뒤에 또 번호면 맨 앞 것 ("78화 우기명의 겨울 방학 1화" 는 78화, 블랙툰 복학왕)
        // 괄호 안 번호는 덧붙인 설명이라 빼고 봄 ("143화 (외전 2화)" 는 143화, 말단 병사에서 군주까지)
        const brackets = [...name.matchAll(/\([^)]*\)|\[[^\]]*]|（[^）]*）/g)].map((b) => [b.index, b.index + b[0].length]);
        let chapterUnits = units.filter((u) => u[4] !== "부" && !brackets.some(([a, b]) => u.index >= a && u.index < b));
        if (!chapterUnits.length) chapterUnits = units.filter((u) => u[4] !== "부");
        const same = chapterUnits.filter((u) => u[4] === chapterUnits[0][4]);
        const lead = same.length > 1 && !/\p{L}/u.test(name.substring(0, same[0].index)) &&
            /\p{L}/u.test(name.substring(same[0].index + same[0][0].length, same[same.length - 1].index).replace(/화|권|호|話/g, ""));
        const m = (lead ? same[0] : same.pop()) || units[0] || /(\d+)(?:\s*([-.])\s*(\d+))?/.exec(name);
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
    // 빈칸과 맨 앞 작품 제목은 빼고 비교 ("검술명가 막내아들135화" 와 다시 올린 "135화" 는 같은 회차, newxtoon)
    const squash = (v) => String(v || "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
    const tk = squash(title);
    const best = {};
    list.forEach((c, i) => {
        if (fixed.has(c)) return;
        let k = squash(c.name);
        if (tk && k.length > tk.length && k.startsWith(tk)) k = k.substring(tk.length).replace(/^[-–:·._]+/, "");
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
    // 올라온 순서(과거 → 최신)로 본 회차들
    const byTime = keys.slice().sort((a, b) => a.index - b.index);
    const usedNum = new Set(keys.filter((k) => k.num >= 0).map((k) => `${k.prefix}|${k.unit}|${k.num}`));
    const okNum = (k) => k && k.num >= 0 && k.prefix !== PRO && !isExtra(k.prefix);
    // 번호 없는 회차("0240 - 환골탈태 마지막화")가 앞뒤 회차 번호 사이 빈 번호 하나에 딱 맞으면 그 번호 (2026-11-04)
    byTime.forEach((k, p) => {
        if (k.num >= 0 || k.prefix === PRO) return;
        const a = byTime[p - 1], b = byTime[p + 1];
        if (!okNum(a) || !okNum(b) || a.prefix !== b.prefix || a.unit !== b.unit || a.num % 1 || b.num - a.num !== 2) return;
        if (usedNum.has(`${a.prefix}|${a.unit}|${a.num + 1}`)) return;
        k.prefix = a.prefix; k.unit = a.unit; k.num = a.num + 1; k.fixed = true;
        usedNum.add(`${a.prefix}|${a.unit}|${k.num}`);
    });
    // 본편 사이에 끼어 있는 "외전" 묶음이 그 자리 빈 번호 수와 딱 맞으면 사이트가 잘못 적은 본편
    // (굿툰 4000년 만에 귀환한 대마도사: 207화 · 외전 8~11화 · 212화, 외전 1~7화 없음 → 208~211화). 그 외전 묶음에 다른 회차가 없을 때만
    for (let p = 0; p < byTime.length;) {
        const k = byTime[p];
        if (!isExtra(k.prefix)) { p++; continue; }
        let q = p;
        while (q + 1 < byTime.length && byTime[q + 1].prefix === k.prefix) q++;
        const run = byTime.slice(p, q + 1);
        const a = byTime[p - 1], b = byTime[q + 1];
        const whole = keys.filter((x) => x.prefix === k.prefix).length === run.length;
        if (whole && okNum(a) && okNum(b) && a.prefix === b.prefix && a.unit === b.unit && !(a.num % 1) && b.num - a.num - 1 === run.length &&
            !run.some((_, j) => usedNum.has(`${a.prefix}|${a.unit}|${a.num + 1 + j}`))) {
            run.forEach((r, j) => { r.prefix = a.prefix; r.unit = a.unit; r.num = a.num + 1 + j; r.fixed = true; });
        }
        p = q + 1;
    }
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
    if (seasons) {
        // 시즌마다 번호가 다시 시작하고 사이트가 시즌 표시를 빼먹거나 이어 붙인 번호를 쓰기도 함
        // (굿툰 닥터 최태수: 시즌2 중간이 "61화~65화", 시즌5 뒤가 "126화~136화") → 사이트 순서(최신 → 과거) 그대로,
        // 망가요미가 읽는 이름 맨 앞 숫자가 순번과 다르면 "순번 · " 을 붙임 (2026-11-04)
        const hasPro = keys.some((k) => k.prefix === PRO);
        return list.map((c, i) => {
            if (keys[i].prefix === PRO) return c;
            const pos = keys[i].index + (hasPro ? 0 : 1);
            const lead = /\d+/.exec(String(c.name || ""));
            return lead && Number(lead[0]) === pos ? c : Object.assign({}, c, { name: `${pos} · ${String(c.name || "").trim()}` });
        });
    }
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
    // 지금 주소가 다른 주소로 넘겨 주는지 먼저 (앱이 따라가서 화면은 정상이어도, 2026-11-08)
    const moved = await movedSelf(ext, base, marker);
    if (moved) return moved;
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
// 이름 맨 앞이 작품 제목이면(글자·숫자만 비교) 제목이 끝나는 자리, 아니면 0
// 제목 끝 덧붙임("일진녀 길들이기[탑툰]"·"…(완결)")이 회차 이름에 없으면 그 부분을 뺀 제목으로도 맞춰 봄
function titleCut(name, title) {
    const full = titleCutOne(name, title);
    if (full > 0) return full;
    const core = String(title || "").replace(/\s*[\[(【［（][^\])】］）]*[\])】］）]\s*$/, "");
    if (!core || core === String(title || "")) return 0;
    const cut = titleCutOne(name, core);
    // 괄호 앞 제목만 맞고 바로 괄호가 이어지면("원피스(ONE PI…") 잘린 전체 제목이라 떼지 않음
    return cut > 0 && /^\s*[\[(【［（]/.test(String(name).substring(cut)) ? 0 : cut;
}
function titleCutOne(name, title) {
    const T = String(title || "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (!T) return 0;
    const s = String(name || "");
    let j = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!/[\p{L}\p{N}]/u.test(ch)) continue;
        if (ch.toLowerCase() !== T[j]) return 0;
        j++;
        if (j === T.length) return i + 1;
    }
    return 0;
}

function chapterPosition(list, title) {
    try {
        const v = new SharedPreferences().get("chapter_position");
        if (v === false || v === "false") return list;
    } catch (e) {}
    const t = String(title || "").trim();
    const rows = list.map((c) => {
        // 정렬이 붙인 앞 번호("65 · ")는 두고 그 뒤에서 사이트 순번·작품 제목을 뺌
        const lead = (/^\d+(?:\.\d+)? · /.exec(String(c.name || "").trim()) || [""])[0];
        let n = String(c.name || "").trim().substring(lead.length);
        // 사이트 순번은 빼되, 그 순번이 회차 번호인 이름("230. 제79장. …" 뒤에 화 번호도 숫자로 시작하지도 않음)은 둠
        const seqm = /^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/.exec(n);
        if (seqm) {
            const rest = n.substring(seqm[0].length);
            if (!/^\d+\.\s/.test(seqm[0]) || /^\d/.test(rest) || /\d+\s*(?:화|권|호|話)/.test(rest)) n = rest;
        }
        // 2026-11-11: 제목 표기가 조금 달라도(끝 마침표·물음표·띄어쓰기 — "…결심한다." ↔ "…결심한다 115화") 글자·숫자만 맞춰 맨 앞 작품 제목을 뺌
        // 제목이 두 번 붙은 이름("비밀수업 비밀수업 73화")도 있어 최대 3번
        for (let k = 0; k < 3; k++) {
            const cut = titleCut(n, t);
            if (!(cut > 0)) break;
            const rest = n.substring(cut).replace(/^[\s\-–:·.?!~,)\]）】」』>]+/, "");
            if (!rest || rest === n) break;
            n = rest;
        }
        return { c, lead, n };
    });
    // 2026-11-11: 작품 제목이 다른 글자로 붙은 경우("GACHIAKUTA" ↔ "가치액터 47화") — 여러 회차(3개 이상) 앞에 똑같이 붙은 글자를 제목으로 보고 뺌
    // (숫자가 들어 있거나 외전·번외·특별·시즌·후기·공지 같은 뜻 있는 말이면 빼지 않음)
    const cnt = {};
    for (const x of rows) {
        const m = /^([^\d]{2,40}?)\s+\d+(?:[.-]\d+)?\s*화/.exec(x.n);
        if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
    }
    let common = Object.keys(cnt).filter((p) => cnt[p] >= 3 && !/외전|번외|특별|시즌|부$|후기|공지|휴재|에필로그|프롤로그|예고|단편|완결|최종|season|ep\b/i.test(p)).sort((a, b) => cnt[b] - cnt[a])[0];
    if (common) {
        // 떼면 다른 회차 번호와 겹치는 말("애프터스토리 1~33화" ↔ 본편 1~62화)은 제목이 아니라 따로 묶인 회차 이름이라 그대로 둠
        const num = (s) => (/^(\d+(?:[.-]\d+)?)\s*화/.exec(s) || [])[1];
        const mine = new Set(), other = new Set();
        for (const x of rows) {
            if (x.n.startsWith(common)) { const v = num(x.n.substring(common.length).replace(/^[\s\-–:·.]+/, "")); if (v) mine.add(v); }
            else { const v = num(x.n); if (v) other.add(v); }
        }
        if ([...mine].some((v) => other.has(v))) common = "";
    }
    return rows.map((x, i) => {
        let n = x.n;
        if (common && n.startsWith(common)) {
            const rest = n.substring(common.length).replace(/^[\s\-–:·.]+/, "");
            if (/^\d/.test(rest)) n = rest;
        }
        return Object.assign({}, x.c, { name: x.lead + n + (i === 0 ? " · 마지막" : ` · 남은 ${i}화`) });
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
const ADDR_HELP = "주소가 바뀐 것 같아요. 브라우저에서 사이트가 열리면 그 주소를 검색창에 붙여 넣어 주세요. 브라우저에서는 열리는데 앱에서만 안 되면: 잠시 뒤 다시 · 앱 완전히 껐다 켜기 · 유니콘 등 DNS 앱을 쓰면 DNS 를 Google 로.";

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

// 저장소 주소 목록 파일(domains.json, 2026-11-03): 확장이 스스로 새 주소를 못 찾을 때를 대비해 저장소에 적어 둔 지금 주소.
// 주소 찾기 때 먼저 확인하고, 진짜 사이트일 때만 씀
const DOMAIN_LIST_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/domains.json";
// ===== 넘겨 준 주소 직접 읽기 (2026-11-08, 웹툰 망가요미 10개 파일 같은 코드) =====
// 망가요미는 넘어간 최종 주소를 알려 주지 않지만, new Client({ useDartHttpClient: true, followRedirects: false }) 로 보내면
// 301·302… 응답과 location 머리글을 그대로 줌(순정 망가요미 m_client.dart). 넘겨 주는 주소를 끝까지(최대 6번) 따라가
// 이 사이트 모양(AUTO_HOST)의 다른 주소이고 첫 화면이 200 + 표시 글자일 때만 돌려줌. 확인 못 하면 null(원래 방법대로).
let MOVED_CLIENT = null;
const MOVED_SEEN = {};
async function movedOrigin(url, head) {
    try {
        if (!MOVED_CLIENT) MOVED_CLIENT = new Client({ useDartHttpClient: true, followRedirects: false, timeout: 8, connectTimeout: 5 });
    } catch (e) {
        return null;
    }
    // 웹뷰 UA 로 받은 Cloudflare 쿠키가 통하게 UA 는 앱에 맡김 (UA 가 꼭 필요한 소스는 APP_NO_UA)
    const hdr = APP_NO_UA ? { "User-Agent": MOBILE_UA } : {};
    let cur = url;
    let moved = false;
    for (let i = 0; i < 6; i++) {
        let r;
        try {
            r = head && MOVED_CLIENT.head ? await MOVED_CLIENT.head(cur, hdr) : await MOVED_CLIENT.get(cur, hdr);
        } catch (e) {
            break;
        }
        const code = Number(r && r.statusCode);
        if (![301, 302, 303, 307, 308].includes(code)) break;
        const hs = (r && r.headers) || {};
        let loc = "";
        for (const k in hs) if (k.toLowerCase() === "location") loc = String(hs[k] || "").trim();
        if (!loc) break;
        const origin = (/^https?:\/\/[^/?#]+/i.exec(cur) || [""])[0];
        cur = /^https?:\/\//i.test(loc) ? loc : loc.startsWith("//") ? "https:" + loc : origin + (loc.startsWith("/") ? "" : "/") + loc;
        moved = true;
    }
    const m = moved ? /^(https?):\/\/([^/?#]+)/i.exec(cur) : null;
    return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null;
}

// froms 가 넘겨 주는 주소 중 진짜 사이트(첫 화면 200 + marker)를 돌려줌
async function movedTarget(ext, froms, current, marker, head) {
    const origins = await Promise.all(froms.map((u) => movedOrigin(u, head)));
    const seen = {};
    for (const o of origins) {
        if (!o || seen[o] || o === current) continue;
        seen[o] = 1;
        if (!AUTO_HOST.test(o.replace(/^https?:\/\//, ""))) continue;
        try {
            const r = await ext.client.get(o + "/", { "User-Agent": MOBILE_UA });
            if (r.statusCode === 200 && String(r.body || "").indexOf(marker) >= 0) return o;
        } catch (e) {
            // 다음 주소
        }
    }
    return null;
}

// 정상으로 열릴 때: 지금 주소가 다른 주소로 넘겨 주는지(앱이 따라가서 화면은 정상) 앱을 켤 때 주소마다 한 번만 확인
async function movedSelf(ext, base, marker) {
    if (MOVED_SEEN[base]) return null;
    MOVED_SEEN[base] = 1;
    return movedTarget(ext, [base + "/"], base, marker, true);
}

async function listedDomain(client, key) {
    try {
        const r = await client.get(DOMAIN_LIST_URL + "?t=" + Math.floor(Date.now() / 60000), { "Cache-Control": "no-cache" });
        if (Number(r.statusCode) !== 200) return "";
        const u = String((((JSON.parse(String(r.body || "{}")).domains || {})[key]) || {}).baseUrl || "").trim().replace(/\/+$/, "");
        return /^https:\/\/[A-Za-z0-9.-]+$/.test(u) ? u.toLowerCase() : "";
    } catch (e) {
        return "";
    }
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

    async reqRaw(url, headers) {
        await siteWait(url);
        const base = this.base;
        const ours = this.autoOn() && url.startsWith(base) && AUTO_HOST.test(base.replace(/^https?:\/\//, ""));
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
            if (ours && res.statusCode === 200) notice = await noticeTarget(this, res.body, base, MARK);
            // 정상 화면에 적힌 더 새 주소(사이트가 새 주소로 넘겨 준 경우 포함)를 자동 주소로 기억
            if (ours && !notice && res.statusCode === 200) {
                const self = await selfTarget(this, res.body, base, MARK);
                if (self) new SharedPreferences().setString("auto_domain", self);
            }
            // 접근 차단(451)도 새 주소 찾기 (2026-11-07)
            if (!notice && (!ours || !(res.statusCode >= 500 || res.statusCode === 451))) return res;
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

    /** 최신 주소 안내(goraetoonurl.com) → ###.grtoon.com(-2 ~ +30)과 예전 주소 goraetoon1~40.com 이 넘겨 주는 주소 중 고래툰이 열리는 가장 큰 번호 */
    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));

        // 저장소 주소 목록 파일(domains.json)에 적힌 주소 먼저 (진짜 사이트일 때만)
        const listedC = await listedDomain(this.client, "goraetoon");
        if (listedC && listedC !== current) {
            const c = listedC;
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                if (r.statusCode === 200 && String(r.body || "").includes(MARK)) {
                    prefs.setString("auto_domain", c);
                    return c;
                }
            } catch (e) {
                // 원래 방법으로
            }
        }

        // 지금 주소·안내 주소가 넘겨 주는(301·302) 주소를 직접 읽어, 진짜 사이트면 사용 (2026-11-08)
        const movedC = await movedTarget(this, [current + "/"], current, MARK, false);
        if (movedC) {
            prefs.setString("auto_domain", movedC);
            return movedC;
        }

        const num = (u) => parseInt((String(u).match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const cur = num(current) || num(this.source.baseUrl);
        // ① 최신 주소 안내 페이지에 적힌 주소 (번호가 큰 것부터, 진짜 사이트가 열리는지 확인)
        for (const g of GR_GUIDES) {
            let body = "";
            try {
                body = String((await this.client.get(g, { "User-Agent": MOBILE_UA })).body || "");
            } catch (e) {
                continue;
            }
            const listed = [...new Set((body.match(/\d{3}\.grtoon\.com/gi) || []).map((h) => "https://" + h.toLowerCase()))]
                .filter((h) => h !== current).sort((a, b) => num(b) - num(a));
            for (const h of listed.slice(0, 3)) {
                try {
                    const r = await this.client.get(h + "/", { "User-Agent": MOBILE_UA });
                    if (r.statusCode === 200 && String(r.body || "").includes(MARK)) {
                        prefs.setString("auto_domain", h);
                        return h;
                    }
                } catch (e) {
                    // 다음 주소
                }
            }
        }
        // ② 지금 번호 주변
        const cands = [];
        for (let i = Math.max(1, cur - 2); i <= cur + 30; i++) {
            const c = `https://${String(i).padStart(3, "0")}.grtoon.com`;
            if (c !== current) cands.push(c);
        }
        const direct = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes(MARK) ? c : null;
            } catch (e) {
                return null;
            }
        }));
        let ok = direct.filter((x) => x);
        if (!ok.length) {
            // 망가요미는 넘어간 최종 주소를 알려 주지 않으므로, 예전 주소 화면에 적힌 ###.grtoon.com 을 다시 확인
            const old = [];
            for (let i = 1; i <= 40; i++) old.push(`https://goraetoon${String(i).padStart(2, "0")}.com`);
            const bodies = await Promise.all(old.map(async (c) => {
                try {
                    const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                    return r.statusCode === 200 ? String(r.body || "") : "";
                } catch (e) {
                    return "";
                }
            }));
            const seen = [...new Set(bodies.join(" ").match(/\d{3}\.grtoon\.com/g) || [])].map((h) => "https://" + h).filter((c) => c !== current);
            const checked = await Promise.all(seen.map(async (c) => {
                try {
                    const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                    return r.statusCode === 200 && String(r.body || "").includes(MARK) ? c : null;
                } catch (e) {
                    return null;
                }
            }));
            ok = checked.filter((x) => x);
        }
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

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    async get(url) {
        const res = await this.req(url, this.hdr());
        return String(res.body || "");
    }

    /** 사이트 주소의 한글 경로를 그대로 쓰도록 (주소창 모양 %EC.. 은 한글로 풀어 저장) */
    path(u) {
        let p = (u || "").replace(/^https?:\/\/[^/]+/, "").replace(/&amp;/g, "&");
        try {
            p = decodeURIComponent(p.replace(/\+/g, "%2B"));
        } catch (e) {
            // 그대로
        }
        return p;
    }

    // ---------- 작품 목록 데이터 (사이트가 주는 JSON, 사이트 화면과 같은 규칙으로 거름) ----------
    /** 파일마다 받아 둔 시간 동안은 다시 받지 않음 (오늘 업데이트·BEST 10분, 연재 30분, 완결은 커서 6시간) */
    async catalog(name) {
        const ttl = { active: 600000, top: 600000, ongoing: 1800000, completed: 21600000 }[name] || 1800000;
        const c = CATALOG[name];
        if (c && Date.now() - c.at < ttl) return c.data;
        const file = name === "top" ? "top" : `webtoon-${name}`;
        try {
            const res = await this.req(`${this.base}/catalog-data/${file}.json`, this.hdr());
            const body = String(res.body || "").trim();
            if (!/^[[{]/.test(body)) throw new Error(`고래툰 작품 목록을 읽을 수 없습니다 (상태 ${res.statusCode})`);
            const data = JSON.parse(body);
            CATALOG[name] = { at: Date.now(), data };
            return data;
        } catch (e) {
            if (c) return c.data;
            throw e;
        }
    }

    cover(p) {
        p = String(p || "").trim();
        if (!p) return "";
        return /^https?:\/\//.test(p) ? p : `${this.base}/${p.replace(/^\/+/, "")}`;
    }

    item(w) {
        return { name: w.title || "", imageUrl: this.cover(w.cover_path), link: `/webtoon/${w.public_id || w.id}.html` };
    }

    /** q: list(ongoing·completed·day·week·month·realtime), best(comm·adult·bl), day, platform, genre, sort(new·hot) */
    async select(q, keyword) {
        const sq = (s) => String(s || "").trim().replace(/\s+/g, "").toUpperCase();
        let base;
        if (keyword) {
            const k = sq(keyword);
            const seen = {};
            base = (await this.catalog("ongoing")).concat(await this.catalog("completed"))
                .filter((w) => !seen[w.id] && (seen[w.id] = true) && (sq(w.title).includes(k) || sq(w.author).includes(k)));
        } else if (BEST_PERIODS.includes(q.list)) {
            const top = await this.catalog("top");
            const ids = ((top[q.list] || {})[q.best || "comm"]) || [];
            const byId = {};
            for (const w of (await this.catalog("active")).concat(await this.catalog("ongoing"))) byId[Number(w.id)] = w;
            return ids.map((id) => byId[Number(id)]).filter((w) => w);
        } else if (q.list === "completed") {
            base = await this.catalog("completed");
        } else if (!q.day) {
            base = await this.catalog("active");
        } else {
            base = (await this.catalog("ongoing")).filter((w) => w.publish_day === q.day);
        }
        const list = base.filter((w) => (!q.platform || (w.platform && w.platform.name) === q.platform)
            && (!q.genre || (w.genres || []).some((g) => g.name === q.genre)));
        if (q.sort === "hot") return list.slice().sort((a, b) => Number(b.view_count_total || 0) - Number(a.view_count_total || 0));
        // 사이트 순서: catalog_order(있는 것 먼저, 작은 순) → 업데이트 최신순
        const ord = (w) => (w.catalog_order === null || w.catalog_order === undefined || w.catalog_order === "" ? null : Number(w.catalog_order));
        const t = (w) => Date.parse(w.updated_at || "") || 0;
        return list.slice().sort((a, b) => {
            const x = ord(a);
            const y = ord(b);
            if (x !== null && y !== null && x !== y) return x - y;
            if (x === null && y !== null) return 1;
            if (x !== null && y === null) return -1;
            return t(b) - t(a);
        });
    }

    page(list, page) {
        const from = (page - 1) * PAGE_SIZE;
        return { list: list.slice(from, from + PAGE_SIZE).map((w) => this.item(w)).filter((x) => x.name), hasNextPage: from + PAGE_SIZE < list.length };
    }

    async basePopular(page) {
        return this.page(await this.select({ list: "realtime", best: "comm" }, ""), page);
    }

    async baseLatest(page) {
        return this.page(await this.select({ list: "ongoing", sort: "new" }, ""), page);
    }

    async baseSearch(query, page, filters) {
        const q = { list: "ongoing", best: "comm", day: "", platform: "", genre: "", sort: "new" };
        for (const f of filters || []) {
            if (f && f.type_name === "SelectFilter" && f.param && f.values && f.values[f.state]) q[f.param] = f.values[f.state].value;
        }
        return this.page(await this.select(q, String(query || "").trim()), page);
    }

    // ---------- 상세 + 회차 (작품 화면에 전부 있음) ----------
    async getDetail(url) {
        const detailPath = this.path(url).replace(/[?#].*$/, "");
        const doc = new Document(await this.get(this.base + detailPath));
        const art = doc.select("article.work-detail");
        const meta = doc.selectFirst("article.work-detail .work-meta");
        const txt = (sel) => { const e = meta ? meta.select(sel) : []; return e.length ? (e[0].text || "").trim() : ""; };
        const title = txt("h1") || (art.length ? art[0].attr("data-work-title") : "");
        const head = (doc.select(".episode-list .section-header h2")[0]?.text || "").trim();
        const day = txt(".day-badge");
        const age = txt(".age-rating-badge");
        let synopsis = "";
        for (const p of meta ? meta.select("p") : []) {
            if (!(p.attr("class") || "").trim()) {
                synopsis = (p.text || "").trim().replace(/^"+|"+$/g, "").trim();
                break;
            }
        }
        const info = [txt(".platform-meta"), day ? (day === "10" ? "10일마다" : `${day}요일`) : "", age && age !== "ALL" ? `${age}세` : "", head].filter((s) => s).join(" · ");
        const chapters = [];
        const seen = {};
        for (const a of doc.select("#episode-list a.episode-row")) {
            const p = this.path(a.attr("href"));
            if (!p.startsWith("/webtoons/") || seen[p]) continue;
            seen[p] = true;
            const strong = a.select(".episode-title-line strong");
            const dm = /(\d{4})-(\d{2})-(\d{2})/.exec(a.select(".episode-meta-line")[0]?.text || "");
            chapters.push({
                name: (strong.length ? strong[0].text : a.text || "").trim(),
                url: p,
                dateUpload: dm ? String(new Date(`${dm[1]}-${dm[2]}-${dm[3]}T00:00:00+09:00`).valueOf()) : null
            });
        }
        const imgs = doc.select("article.work-detail .work-cover img");
        return {
            name: title,
            imageUrl: imgs.length ? this.cover(imgs[0].attr("src")) : this.cover(art.length ? art[0].attr("data-work-cover") : ""),
            author: txt(".author-meta").replace(/^작가\s*:\s*/, ""),
            description: [synopsis, info].filter((s) => s).join("\n\n"),
            genre: (meta ? meta.select(".tag-list .tag-badge") : []).filter((e) => !(e.attr("class") || "").includes("day-badge")).map((e) => (e.text || "").trim()).filter((s) => s),
            status: head.startsWith("완결") ? 1 : head.startsWith("휴재") ? 2 : head.startsWith("연재") ? 0 : 5,
            link: this.base + detailPath,
            chapters: chapterPosition(orderChapters(chapters, title), title)
        };
    }

    // ---------- 이미지 (img[o_src] + 그림 서버 주소, 사이트 스크립트와 같은 방식) ----------
    async getPageList(url) {
        const html = await this.get(this.base + this.path(url).replace(/[?#].*$/, ""));
        const hm = /__IMAGE_HOST\s*=\s*['"]([^'"]+)['"]/.exec(html);
        const host = hm ? hm[1].replace(/\\\//g, "/").replace(/\/+$/, "") : "";
        const urls = [];
        const re = /<img\b[^>]*\bo_src\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(html))) {
            const p = m[1].trim().replace(/&amp;/g, "&");
            const u = /^https?:\/\//.test(p) ? p : p.startsWith("/") ? this.base + p : host ? `${host}/${p}` : "";
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) {
            const t = (/<title>([^<]*)<\/title>/.exec(html) || [0, ""])[1].trim().substring(0, 40);
            throw new Error(`이미지를 찾을 수 없습니다 (제목: ${t || "없음"})`);
        }
        return urls.map((u) => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        const all = (names) => [["전체", ""]].concat(names.map((n) => [n, n]));
        return [
            { type_name: "HeaderFilter", name: "검색어는 제목·작가 (연재·완결 전체에서 찾음, 정렬만 적용)" },
            sel("목록", "list", LISTS),
            sel("BEST 분류 (BEST 목록만)", "best", BEST_TYPES),
            sel("요일 (연재만)", "day", DAYS),
            sel("플랫폼 (연재·완결)", "platform", all(PLATFORMS)),
            sel("장르 (연재·완결)", "genre", all(GENRES)),
            sel("정렬 (연재·완결)", "sort", SORTS)
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
            else if (f.type_name === "TextFilter" && typeof s === "string") f.state = s;
            else if (f.type_name === "CheckBox" && typeof s === "boolean") f.state = s;
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /^\/(?:webtoon\/(\d+)\.html|webtoons\/(\d+)\/)/.exec(p); return m ? `/webtoon/${m[1] || m[2]}.html` : null; });
        if (byUrl) return byUrl;
        await statusRefresh(this.client);
        // 맨 위 상태 줄은 빼고 넘김 (규칙 저장 위치가 밀리지 않게)
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
            { type_name: "HeaderFilter", name: `현재 인기: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (실시간 BEST)")}` },
            { type_name: "HeaderFilter", name: `현재 최신: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (연재 오늘 업데이트)")}` },
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
        return statusFilters("goraetoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
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
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://003.grtoon.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 ###.grtoon.com 과 예전 주소(goraetoon##.com)에 적힌 주소 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

// base64 → UTF-8 글자 (망가요미 엔진에 atob 이 없을 수 있어 직접 풂)

const STATUS_LINE = /^(?:📡|🩺|❌|🛡|📝)/;
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
    await notesRefresh(client);
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
    return lines.map((name) => ({ type_name: "HeaderFilter", name, _status: true })).concat(notesFilters(key));
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

const TWIN_NOTE = "블랙툰과 같은 사이트예요 — 작품·회차가 같아서 한쪽이 막히면 다른 쪽에서 보세요";

function notesFilters(key) {
    let list = [];
    try {
        list = (JSON.parse(new SharedPreferences().getString("notes_json", "") || "{}").items || {})[key] || [];
    } catch (e) {
        list = [];
    }
    const out = [verLine(key, list.filter((n) => n && n.t)[0])];
    // 같은 작품·회차를 가진 확장 안내 (전체 웹툰 비교, 2026-11-06) — 확장 이름은 바꾸지 않음(서재 연결)
    if (TWIN_NOTE) out.push({ type_name: "HeaderFilter", name: "📝 🔗 " + TWIN_NOTE, _status: true });
    return out;
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
