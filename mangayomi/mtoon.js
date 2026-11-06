const mangayomiSources = [{
    "id": 870214019,
    "name": "머니툰 웹툰",
    "lang": "ko",
    "baseUrl": "https://mtoon165.asia",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.1.16",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "mtoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

// 머니툰 (mtoon165.asia, 2026-11-06, 해외에서도 열려 실제 구조 확인 후 만듦. 코믹툰툰(comictt.js) 바탕, 이미 만든 웹툰 확장과 다른 사이트)
// 목록: 첫 화면 index.php?wt_fin=(연재중|완결)&w=요일 · ?cate=장르 · ?search= 와 같은 자료를 "더보기" 요청으로 30개씩 받음
//   POST more.php?wt_fin=…&w=(8 UP·1~6 월~토·0 일·7 열흘)&c=시작 번호 / more.php?wt_fin=…&cate=장르&c= / more.php?search=&c= → JSON 배열
//   {wt_idx, wt_title, wt_thumb(./img/data/webtoon/…), wt_author, wt_genre, wt_intro, wt_fin, wt_sca(요일), wt_last("오늘"·날짜), wt_list_cnt}, 끝나면 빈 배열
//   정렬 메뉴는 사이트에 없음 (UP 이 최근 업데이트 순)
// 작품: list.php?i=N (h1.list_page_title, .list_page_head img, p 소개), 회차 .list_data li: .l_d_t a[href=detail.php?wi=N] 이름 + .l_d_d 날짜("오늘"·yyyy-MM-dd), 최신이 위
//   작가·장르·연재 상태는 작품 화면에 없어 more.php?search=제목 자료에서 채움
// 회차: detail.php?wi=N 의 img[loading=lazy] (img.mtoon165.asia/data/file/download/… 또는 /img/data/file/…), 광고(/ban/)·사이트 그림(assets)은 뺌
const AUTO_HOST = /^(?:www\.)?mtoon\d+\.asia$/;
const AUTO_NUM = /mtoon(\d+)\./;
const SITE_HOST = AUTO_HOST;
// 진짜 사이트 화면마다 있는 글자 (머니툰 로고 그림)
const MARK = "money_toon.png";
const PAGE_SIZE = 30;
const STATES = [["연재", "연재중"], ["완결", "완결"]];
const DAYS = [["UP (최근 업데이트)", "8"], ["월", "1"], ["화", "2"], ["수", "3"], ["목", "4"], ["금", "5"], ["토", "6"], ["일", "0"], ["열흘", "7"], ["오늘 요일", "today"]];
const GENRES = [["전체 (요일로 보기)", ""], ["판타지", "판타지"], ["액션", "액션"], ["개그", "개그"], ["미스터리", "미스터리"], ["로맨스", "로맨스"], ["드라마", "드라마"], ["무협", "무협"], ["스포츠", "스포츠"], ["일상", "일상"], ["학원", "학원"], ["성인", "성인"], ["BL", "BL"], ["SF", "SF"], ["시대극", "시대극"], ["기타", "기타"]];

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
    if (!m || !SITE_HOST.test(m[1]) || /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(m[2])) return;
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

// ---------- 머니툰 회차 이름 · 날짜 ----------
// 작품 목록에서 받은 자료(작가·장르·연재 상태) 기억 (작품 화면에 없어서)
const META = {};

// 회차 이름을 "N화 : 부제" 모양으로 (사이트 이름이 "A.I. 닥터 249화"·"A.I. 닥터 - 231화 : 그런 미신"·"257화 ： 대오각성의 시간" 처럼 섞여 있음)
// 앱이 이름 맨 앞 숫자를 회차 번호로 쓰므로 번호를 앞으로. 외전·번외 등은 그대로
function chapterName(name, title) {
    let n = String(name || "").replace(/\s+/g, " ").trim();
    if (/외전|번외|특별/.test(n)) return n;
    const m = /(\d+(?:\.\d+)?)\s*화\s*[:：\-–.]?\s*(.*)$/.exec(n);
    if (!m) return n;
    const sub = m[2].trim();
    const tt = String(title || "").replace(/\s+/g, "");
    return `${m[1]}화` + (sub && sub.replace(/\s+/g, "") !== tt ? ` : ${sub}` : "");
}

// 날짜 글자("오늘"·"어제"·"N일 전"·"N시간 전"·"2026-10-30") → 한국 시간 밀리초 글자
function siteDate(t) {
    t = String(t || "").trim();
    const dayMs = 86400000;
    const kstMidnight = () => { const now = Date.now() + 9 * 3600000; return now - (now % dayMs) - 9 * 3600000; };
    let m;
    if (/^오늘/.test(t) || /(\d+)\s*(시간|분|초)\s*전/.test(t)) return String(kstMidnight());
    if (/^어제/.test(t)) return String(kstMidnight() - dayMs);
    if ((m = /(\d+)\s*일\s*전/.exec(t))) return String(kstMidnight() - Number(m[1]) * dayMs);
    if ((m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t))) {
        const v = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 9 * 3600000;
        return isNaN(v) ? null : String(v);
    }
    return null;
}

// 요청마다 시간 제한 — 응답이 없으면 어느 주소가 몇 초 동안 응답 없었는지 오류로
// 요청마다 시간 제한 + 대체 통신 (2026-11-06, 0.1.4)
// 망가요미 순정 앱은 열리는데 변형 앱 Mangayomi Glitch 는 목록(more.php) 요청이 응답 없이 멈춤(사용자 확인)
// → ① 기본 통신 8초 ② 연결을 재사용하지 않는 별도 통신 12초 ③ Dart 통신 12초 차례로 (애니24 dcVideos 와 같은 방법)
// 한 번 된 통신은 기억해 다음부터 그것부터 씀. 모두 응답 없으면 어느 주소인지 오류로
let MT_WAY = 0;
async function limitedGet(c, url, headers, ms) {
    let timer = null;
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("시간 초과")), ms); });
    return Promise.race([c.get(url, headers), limit]).finally(() => { try { if (typeof clearTimeout === "function") clearTimeout(timer); } catch (e) {} });
}
let MT_ALT = null;
let MT_DART = null;
function timedClient(c, ms) {
    const ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    const withUa = (h) => {
        const o = Object.assign({}, h || {});
        if (!Object.keys(o).some((k) => k.toLowerCase() === "user-agent")) o["User-Agent"] = ua;
        return o;
    };
    const mk = (opts) => {
        try {
            return new Client(opts);
        } catch (e) {
            return null;
        }
    };
    const ways = [
        { name: "기본", wait: Math.min(ms, 8000), client: () => c, fix: (h) => h },
        { name: "별도", wait: 12000, client: () => MT_ALT || (MT_ALT = mk({ persistentConnection: false, noProxy: true, timeout: 12, connectTimeout: 8 })), fix: withUa },
        { name: "Dart", wait: 12000, client: () => MT_DART || (MT_DART = mk({ useDartHttpClient: true })), fix: withUa },
    ];
    const limited = (p, wait) => {
        let timer = null;
        const limit = new Promise((_, rej) => {
            timer = setTimeout(() => { const e = new Error("시간 초과"); e.mtTimeout = true; rej(e); }, wait);
        });
        return Promise.race([p, limit]).finally(() => { try { if (typeof clearTimeout === "function") clearTimeout(timer); } catch (e) {} });
    };
    const send = async (method, url, headers, body) => {
        const order = [MT_WAY].concat([0, 1, 2].filter((i) => i !== MT_WAY));
        const tried = [];
        let lastErr = null;
        for (const i of order) {
            const w = ways[i];
            const cl = w.client();
            if (!cl) continue;
            try {
                const h = w.fix(headers);
                const r = await limited(method === "post" ? cl.post(url, h, body) : cl.get(url, h), w.wait);
                MT_WAY = i;
                return r;
            } catch (e) {
                lastErr = e;
                tried.push(`${w.name} ${e && e.mtTimeout ? Math.round(w.wait / 1000) + "초" : "실패"}`);
            }
        }
        const e = new Error(`사이트가 응답하지 않아요 [${String(url || "").replace(/^https?:\/\//, "").substring(0, 70)}] (${tried.join(" · ")})`);
        e.mtTimeout = !!(lastErr && lastErr.mtTimeout);
        throw e;
    };
    return {
        get: (url, headers) => send("get", url, headers),
        post: (url, headers, body) => send("post", url, headers, body),
    };
}

// Cloudflare 보안 확인 화면 (사이트가 Cloudflare 를 씀, 2026-11-06 휴대폰에서 목록 안 뜸)
const CF_PAGE = /Just a moment|cf-chl|challenge-platform|cf_chl_opt/i;
const BLOCK_HELP = "사이트에 연결되지 않아요. 이 앱의 연결 방식으로는 이 사이트 접속이 막혀 있어요 (응답 없음).";
const CF_HELP = "사이트 보안 확인(Cloudflare)이 떴어요. 오른쪽 위 지구본(웹뷰) 버튼으로 사이트를 한 번 열어 확인을 통과한 뒤, 뒤로 와서 다시 불러와 주세요.";

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
    if (page !== 1 || (r && r.list && r.list.length) || !ext.autoOn() || (err && /Cloudflare|응답하지 않아요|연결되지 않아요/.test(String(err.message || err)))) {
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
        // 머니툰은 User-Agent 없는 요청을 Cloudflare 확인 화면(403)으로 막음 → 처음부터 휴대폰 UA 를 넣어 보냄 (2026-11-06, 0.1.3)
        // + 요청마다 15초 제한 (망가요미는 40초에서 끊고 어디서 멈췄는지 안 알려 줌)
        APP_NO_UA = true;
        this.client = timedClient(appClient(new Client()), 15000);
        // 목록 자료(more.php)는 기본 통신으로만 짧게 시도 (Glitch 에서 멈추면 바로 웹페이지로)
        this.raw = appClient(new Client());
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
        // Cloudflare 보안 확인 화면("Just a moment")이면 주소 바뀜이 아님 → 웹뷰로 한 번 통과하라고 안내 (통과 쿠키는 앱이 같이 씀)
        if (res && Number(res.statusCode) === 403 && CF_PAGE.test(String(res.body || "").substring(0, 4000))) throw new Error(CF_HELP);
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
            if (!notice && (!ours || !(res.statusCode >= 500))) return res;
            failed = res;
        } catch (e) {
            // 응답 없음(시간 제한)은 주소 바뀜이 아님 → 주소 찾기 없이 바로 알림
            if (!ours || (e && e.mtTimeout)) throw e;
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

    /** 저장소 주소 목록 → mtoonN.asia (지금 번호 -3 ~ +20) 중 머니툰이 열리는 가장 큰 번호 */
    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));
        // 없는 주소가 응답 없이 오래 붙잡지 않게 짧게 기다리는 통신으로 확인 (망가요미는 목록을 40초까지만 기다림)
        let quick = null;
        try {
            quick = new Client({ persistentConnection: false, timeout: 8, connectTimeout: 5 });
        } catch (e) {
            quick = null;
        }
        const real = async (c) => {
            try {
                const r = await (quick || this.client).get(c + "/", { "User-Agent": MOBILE_UA });
                const b = String(r.body || "");
                return r.statusCode === 200 && b.includes(MARK) && b.includes("list.php?i=") ? c : null;
            } catch (e) {
                return null;
            }
        };
        // 저장소 주소 목록 파일(domains.json)에 적힌 주소 먼저 (진짜 사이트일 때만)
        const listedC = await listedDomain(this.client, "mtoon");
        if (listedC && listedC !== current && await real(listedC)) {
            prefs.setString("auto_domain", listedC);
            return listedC;
        }
        const num = (u) => parseInt((String(u).match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const cur = num(current) || num(this.source.baseUrl);
        const cands = [];
        for (let i = Math.max(1, cur - 3); i <= cur + 20; i++) {
            const c = `https://mtoon${i}.asia`;
            if (c !== current) cands.push(c);
        }
        // 전체 15초 안에 끝냄 (그 안에 확인된 주소만)
        const done = [];
        await Promise.race([
            Promise.all(cands.map(async (c) => { const r = await real(c); if (r) done.push(r); })),
            new Promise((res) => setTimeout(res, 15000)),
        ]);
        const ok = done.sort((a, b) => num(b) - num(a));
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

    // ---------- 목록 (더보기 자료 more.php, 30개씩) ----------
    /** 오늘 요일 (한국 시간, 사이트 번호: 일 0 · 월 1 … 토 6) */
    today() {
        return String(new Date(Date.now() + 9 * 3600000).getUTCDay());
    }

    listUrl(q, page) {
        const c = (Math.max(1, page) - 1) * PAGE_SIZE;
        const e = encodeURIComponent;
        if (q.search) return `${this.base}/more.php?search=${e(q.search)}&c=${c}`;
        const fin = q.wt_fin || "연재중";
        if (q.cate) return `${this.base}/more.php?wt_fin=${e(fin)}&cate=${e(q.cate)}&c=${c}`;
        const w = !q.w || q.w === "today" ? this.today() : q.w;
        return `${this.base}/more.php?wt_fin=${e(fin)}&w=${e(w)}&c=${c}`;
    }

    unesc(t) {
        return String(t || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    }

    thumb(t) {
        t = String(t || "").trim();
        if (!t) return "";
        if (/^https?:\/\//.test(t)) return t;
        return `${this.base}/img/data/webtoon/${t.replace(/^\.?\/?(img\/data\/webtoon\/)?/, "")}`;
    }

    /** 더보기 자료(JSON) → 작품 카드. 작가·장르·상태는 작품 화면에 없어 기억해 둠 */
    async listPage(url) {
        // 2026-11-06 원인 확인: 머니툰은 한국에서 저작권 침해 사이트로 접속 차단(한국저작권보호원 warninge.kcopa.or.kr) —
        // 일부 앱(Mangayomi Glitch)의 연결 방식은 https 가 응답 없이 멈춤. 차단을 피해 가는 기능은 만들지 않음 → 20초 안에 안내만
        let r;
        try {
            r = await limitedGet(this.raw, url, Object.assign(this.hdr(), { "X-Requested-With": "XMLHttpRequest" }), 20000);
        } catch (e) {
            throw new Error(BLOCK_HELP);
        }
        const code = Number(r && r.statusCode);
        if (code === 403 && CF_PAGE.test(String(r.body || "").substring(0, 4000))) throw new Error(CF_HELP);
        if (code !== 200) throw new Error(friendlyHttp(code) || `목록을 불러오지 못했어요 (HTTP ${code})`);
        const page = this.listJson(String(r.body || "").trim());
        await this.warmCovers(page.list.map((x) => x.imageUrl));
        return page;
    }

    /**
     * 표지 미리 준비 (2026-11-06): 그림 서버(Cloudflare)는 처음 불리는 표지를 원래 서버에서 가져오느라 한 장 1.3~1.7초(MISS),
     * 준비된 표지는 0.26초 — 망가요미가 표지를 몇 장씩 차례로 받아 카드가 하나씩 나타남.
     * → 목록을 돌려주기 전에 그 쪽 표지 전부에 첫 1바이트만(Range) 동시에 요청해 서버가 준비해 두게 함 (최대 1.2초만 기다림)
     */
    async warmCovers(urls) {
        const h = Object.assign(this.hdr(), { "Range": "bytes=0-0" });
        const jobs = (urls || []).filter((u) => u).map((u) => this.raw.get(u, h).catch(() => null));
        if (!jobs.length) return;
        await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, 1200))]);
    }

    listJson(body) {
        let arr = [];
        try {
            const v = JSON.parse(body || "[]");
            arr = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
        } catch (e) {
            throw new Error(`목록을 읽지 못했어요 [${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").substring(0, 60)}]`);
        }
        const list = [];
        for (const o of arr) {
            if (!o || !o.wt_idx) continue;
            META[String(o.wt_idx)] = o;
            list.push({ name: this.unesc(o.wt_title || "").trim(), imageUrl: this.thumb(o.wt_thumb), link: `/list.php?i=${o.wt_idx}` });
        }
        return { list: list.filter((x) => x.name), hasNextPage: arr.length >= PAGE_SIZE };
    }

    async basePopular(page) {
        return this.listPage(this.listUrl({ w: "today" }, page));
    }

    async baseLatest(page) {
        return this.listPage(this.listUrl({ w: "8" }, page));
    }

    async baseSearch(query, page, filters) {
        const kw = String(query || "").trim();
        if (kw) return this.listPage(this.listUrl({ search: kw }, page));
        const q = {};
        for (const f of filters || []) {
            if (f && f.type_name === "SelectFilter" && f.param && f.values && f.values[f.state]) q[f.param] = f.values[f.state].value;
        }
        return this.listPage(this.listUrl(q, page));
    }

    // ---------- 상세 + 회차 (작품 화면에 전부 있음, 최신이 위) ----------
    async getDetail(url) {
        const id = (/[?&]i=(\d+)/.exec(String(url)) || [0, ""])[1];
        const detailPath = `/list.php?i=${id}`;
        const html = await this.get(this.base + detailPath);
        const head = (/<div class="list_page_head">([\s\S]*?)<div class="none_box">/.exec(html) || [0, ""])[1];
        const title = this.unesc(((/<h1[^>]*list_page_title[^>]*>([\s\S]*?)<\/h1>/.exec(head || html) || [0, ""])[1]).replace(/<[^>]+>/g, "")).trim();
        const cover = (/<img[^>]+src="([^"]+)"/.exec(head) || [0, ""])[1];
        const intro = this.unesc(((/<p[^>]*>([\s\S]*?)<\/p>/.exec(head) || [0, ""])[1]).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
        const chapters = [];
        const seen = {};
        const re = /<li class="mb-2">([\s\S]*?)<\/li>/g;
        let m;
        while ((m = re.exec(html))) {
            const a = /href="detail\.php\?wi=(\d+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
            if (!a || seen[a[1]]) continue;
            seen[a[1]] = true;
            const d = ((/<div class="l_d_d">([\s\S]*?)<\/div>/.exec(m[1]) || [0, ""])[1]).replace(/<[^>]+>/g, "").trim();
            chapters.push({ name: this.unesc(a[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(), url: `/detail.php?wi=${a[1]}`, dateUpload: siteDate(d) });
        }
        // 작가·장르·연재 상태: 목록에서 기억한 자료, 없으면 제목으로 검색해 찾음
        let meta = META[id];
        if (!meta && title) {
            try {
                // 목록과 같은 길(더보기 자료, Glitch 면 웹페이지)로 검색 — 결과가 META 에 남음
                await this.listPage(this.listUrl({ search: title }, 1));
                meta = META[id];
            } catch (e) {}
        }
        meta = meta || {};
        const genre = String(meta.wt_genre || "").split(/[,/]/).map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
        if (meta.wt_adult && !genre.includes("성인")) genre.push("성인");
        const info = [
            meta.wt_company ? `연재처: ${meta.wt_company}` : "",
            meta.wt_sca && meta.wt_fin !== "완결" ? `연재 요일: ${meta.wt_sca}` : "",
        ].filter((x) => x).join(" · ");
        const n = chapters.length;
        return {
            name: title,
            imageUrl: cover ? this.abs(cover.replace(/^\.\//, "/")) : this.thumb(meta.wt_thumb),
            author: String(meta.wt_author || "").trim(),
            description: [intro || String(meta.wt_intro || "").trim(), info].filter((x) => x).join("\n\n"),
            genre,
            status: meta.wt_fin === "완결" ? 1 : meta.wt_fin === "연재중" ? 0 : 5,
            link: this.base + detailPath,
            chapters: chapterPosition(this.orderChapters(chapters, title), title)
        };
    }

    /**
     * 사이트 순서 그대로 (최신 → 과거). 같은 번호 회차가 또 올라온 경우(이름 모양만 다름)는 최근 것 하나만 — 망가요미가 같은 번호를 하나로 합침.
     * 번호 없는 회차는 바로 앞(과거) 회차 번호 + 0.5 ("35.5 · 후기") — 앱이 맨 앞 숫자를 회차 번호로 씀.
     */
    /**
     * 회차 정리 (2026-11-06). chapters: 사이트 순서(최신 → 과거), 이름은 사이트 그대로.
     * 이름이 뒤죽박죽인 작품(선을 넘는 짐승들: 1부 "N화" → 2부 "빈집털이 2"·"은밀한 왁싱 케어 7" 처럼 "화" 없이 에피소드 이름+숫자,
     * 같은 번호 다시 올림)은 "화" 없는 회차가 3개 이상이거나 번호가 거꾸로 가면 → 같은 이름 다시 올린 것은 최근 것만,
     * 올라온 순서대로 1화·2화… 차례 번호 ("45화 : 빈집털이 2"). 번호가 깔끔한 작품은 예전 방식(siteOrder)
     */
    orderChapters(chapters, title) {
        const n = chapters.length;
        const t = String(title || "").replace(/\s+/g, " ").trim();
        const strip = (v) => {
            let x = String(v || "").replace(/\s+/g, " ").trim();
            if (t && x.startsWith(t)) x = x.substring(t.length).replace(/^[\s\-–:·.]+/, "").trim() || x;
            return x;
        };
        const extra = /외전|번외|특별|후기|에필로그|프롤로그|공지|휴재/;
        const numIn = (v) => { const m = /(\d+(?:\.\d+)?)\s*화/.exec(v); return m && !extra.test(v) ? parseFloat(m[1]) : null; };
        const oldFirst = chapters.slice().reverse();
        let unnumbered = 0;
        let backwards = false;
        let maxSeen = -1;
        for (const c of oldFirst) {
            const v = numIn(strip(c.name));
            if (v === null) { if (!extra.test(c.name)) unnumbered++; continue; }
            if (v < maxSeen) backwards = true;
            maxSeen = Math.max(maxSeen, v);
        }
        if (unnumbered < 3 && !backwards) {
            return this.siteOrder(chapters.map((c, i) => Object.assign(c, { seq: n - i, name: chapterName(c.name, title) })), title);
        }
        // 같은 이름(빈칸·작품 제목 빼고)으로 다시 올린 것은 최근 것(목록에서 위)만
        const key = (v) => strip(v).replace(/\s+/g, "").toLowerCase();
        const seen = {};
        const kept = chapters.filter((c) => { const k = key(c.name); if (seen[k]) return false; seen[k] = true; return true; });
        const total = kept.length;
        return kept.map((c, i) => {
            const no = total - i;
            const name = strip(c.name);
            const o = Object.assign({}, c);
            // 이름이 같은 번호 "N화" 로 시작하면 그 부분은 빼고 ("33화 - 여름의 짐승 6" → "33화 : 여름의 짐승 6", "1화 - 1화" → "1화")
            let rest = name;
            const lead = new RegExp(`^${no}\\s*화\\s*[:：\\-–.]?\\s*`);
            while (lead.test(rest)) rest = rest.replace(lead, "");
            o.name = rest ? `${no}화 : ${rest}` : `${no}화`;
            return o;
        });
    }

    siteOrder(chapters, title) {
        const clean = (list) => list.map((c) => { const o = Object.assign({}, c); delete o.seq; return o; });
        const numOf = (c) => { const x = /^(\d+(?:\.\d+)?)화/.exec(c.name); return x && !/외전|번외|특별/.test(c.name) ? x[1] : null; };
        const best = {};
        chapters.forEach((c) => { const k = numOf(c); if (k !== null && (!best[k] || c.seq > best[k].seq)) best[k] = c; });
        const list = chapters.filter((c) => { const k = numOf(c); return k === null || best[k] === c; }).sort((a, b) => b.seq - a.seq);
        let last = 0;
        let step = 0;
        for (let i = list.length - 1; i >= 0; i--) {
            const c = list[i];
            const k = numOf(c);
            if (k !== null) { last = parseFloat(k); step = 0; continue; }
            if (/^\d/.test(c.name) && !/외전|번외|특별/.test(c.name)) continue;
            step = Math.min(step + 1, 9);
            c.name = `${Math.round((last + (step === 1 ? 0.5 : 0.5 + (step - 1) / 10)) * 10) / 10} · ${c.name}`;
        }
        return clean(list);
    }

    // ---------- 이미지 (회차 화면의 그림 중 작품 그림 서버 /data/file/ 것, 광고·사이트 그림은 뺌) ----------
    async getPageList(url) {
        const id = (/wi=(\d+)/.exec(String(url)) || [0, ""])[1];
        const html = await this.get(`${this.base}/detail.php?wi=${id}`);
        const urls = [];
        const re = /<img\b[^>]*?\b(?:data-src|data-original|src)=['"]([^'"]+)['"][^>]*>/gi;
        let m;
        while ((m = re.exec(html))) {
            const u = this.abs(this.unesc(m[1].trim()).replace(/^\.\//, "/"));
            if (!/\/data\/file\//.test(u) || /\/ban\/|\/assets\//.test(u)) continue;
            if (urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) {
            const t = (/<title>([^<]*)<\/title>/.exec(html) || [0, ""])[1].trim().substring(0, 40);
            throw new Error(`이미지를 찾을 수 없습니다 (제목: ${t || "없음"}) — 막 올라온 회차면 사이트가 그림을 아직 안 올렸을 수 있어요`);
        }
        const h = { "Referer": this.base + "/", "User-Agent": MOBILE_UA };
        // 그림 서버는 처음 받는 그림이 약 2초(서버 저장 전), 저장된 뒤엔 0.25초(30일 보관) → 회차 그림을 한꺼번에 미리 요청(맨 앞 1바이트만).
        // 1초만 기다리면 확장이 끝나며 요청이 끊기는 듯(내릴 때 느림, 2026-11-06) → 모두 끝날 때까지 최대 2초 기다림(0.1.15 3초 → 첫 그림이 늦다고 해서 2초, 대부분 1.5~2초 안에 끝남)
        const jobs = urls.map((u) => this.raw.get(u, Object.assign({ "Range": "bytes=0-0" }, h)).catch(() => null));
        await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, 2000))]);
        return urls.map((u) => ({ url: u, headers: h }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어가 있으면 아래 조건은 무시 · 장르를 고르면 요일은 무시 (사이트와 같음)" },
            sel("목록", "wt_fin", STATES),
            sel("요일", "w", DAYS),
            sel("장르", "cate", GENRES)
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /list\.php\?i=(\d+)/.exec(p); return m ? `/list.php?i=${m[1]}` : null; });
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
            { type_name: "HeaderFilter", name: `현재 인기: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (연재 · 오늘 요일)")}` },
            { type_name: "HeaderFilter", name: `현재 최신: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (연재 · UP 최근 업데이트)")}` },
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
        return statusFilters("mtoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
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
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://mtoon165.asia)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 머니툰 번호 주소(mtoonN.asia) 중 열리는 주소로 자동 변경",
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
        if (!q || Number(page) > 1 || /[/.:]/.test(q) || (r && r.list && r.list.length)) return r;
        const squash = (s) => String(s || "").normalize("NFC").replace(/[\s\-_:·.,!?~'"()[\]{}]/g, "").toLowerCase();
        const want = squash(q);
        if (want.length < 2) return r;
        const joined = q.replace(/\s+/g, "");
        const tries = [];
        const add = (t) => { if (t && t.length >= 2 && t !== q && tries.indexOf(t) < 0) tries.push(t); };
        add(joined);
        if (joined.length > 2) add(joined.substring(0, Math.max(2, Math.ceil(joined.length / 2))));
        for (let i = 0; i + 2 <= joined.length; i++) add(joined.substring(i, i + 2));
        for (const t of tries.slice(0, 6)) {
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
