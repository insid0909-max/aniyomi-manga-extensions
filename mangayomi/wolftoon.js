const mangayomiSources = [{
    "id": 870214006,
    "name": "늑대닷컴 웹툰",
    "lang": "ko",
    "baseUrl": "https://wfwf537.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.1.83",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "wolftoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

// true 이면 만화책(/cm) 전용 소스 (wolftoon_comic.js 는 이 값만 다름)
const COMIC = false;
const HOME_PATH = COMIC ? "/cm" : "/ing";
const COMIC_GENRES = [["전체", ""], ["액션", "액션"], ["판타지", "판타지"], ["로맨스", "로맨스"], ["드라마", "드라마"], ["이세계", "이세계"], ["전생", "전생"], ["무협", "무협"], ["일상", "일상"], ["일상+치유", "일상 치유"], ["순정", "순정"], ["러브코미디", "러브코미디"], ["개그", "개그"], ["학원", "학원"], ["스포츠", "스포츠"], ["미스터리", "미스터리"], ["추리", "추리"], ["스릴러", "스릴러"], ["공포", "공포"], ["호러", "호러"], ["도박", "도박"], ["역사", "역사"], ["시대", "시대"], ["게임", "게임"], ["SF", "sf"], ["요리", "요리"], ["먹방", "먹방"], ["음악", "음악"], ["라노벨", "라노벨"], ["애니화", "애니화"], ["BL", "bl"], ["백합", "백합"], ["성인", "성인"], ["붕탁", "붕탁"], ["TS", "ts"], ["여장", "여장"], ["17", "17"]];
const AUTO_HOST = /^wfwf\d+\.com$/;
const AUTO_NUM = /wfwf(\d+)/;
// 늑대닷컴 공식 텔레그램 채널 공개 화면 ("늑대닷컴 주소 https://wfwfNNN.com", 사용자가 알려 줌, 2026-10-31)
const WOLF_GUIDE = "https://t.me/s/wfwf_999";
const DETAIL_PATH = /^\/(list|cl)\?toon=\d+/;
const GENRES = ["드라마", "판타지", "액션", "로맨스", "일상", "개그", "미스터리", "순정", "스포츠", "스릴러", "무협", "학원", "공포", "스토리"];

// 늑대닷컴 - Aniyomi 확장(Wolftoon.kt)과 같은 구조를 망가요미용으로 옮김
// 사이트가 euc-kr 이라 망가요미가 Latin-1 로 받은 본문을 fixEucKr 로 한글로 되돌리고, 검색어·장르는 encodeEucKr 로 보냄
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

// 회차 순서: 이름에서 숫자 앞부분(작품 제목 단어는 빼고)이 같은 것끼리 묶어 번호순으로 놓음 (결과는 최신 → 과거)
// 단위가 다르면 다른 묶음 ("원피스 1화"/"원피스 1권"), 단 번호가 본편과 안 겹치면 본편 ("12화"/"13")
// "(ONE PIECE)원피스 775화" 와 "1194화" 는 같은 묶음, "스핀오프 - 식극의 상디" 와 "식극의 상디" 도 같은 묶음
// 회차가 가장 많은 묶음이 본편 → 맨 앞, 그다음 번호 없는 특별편(후기 등), 다른 묶음(처음 올라온 순), 번외, 외전. 프롤로그는 맨 앞
// "6-1화" 는 6.01, "1.5화" 는 1.5, "153화 외전 …" 처럼 화 번호 앞에 다른 말이 없으면 본편
// 망가요미는 이름 맨 앞 숫자로 회차 번호를 정하므로, 본편이 아닌 회차는 이름 앞에 본편 마지막 번호 다음 순번을 붙임
// ("1195 · 원피스 매거진 1호") → "화 번호별" 정렬도 본편 1화 ~ 끝 → 나머지 순서
// "시즌2 1화" 처럼 시즌 표시가 있으면 시즌 순서가 먼저: 표시 없는 회차(시즌1) → 시즌2 → …, 본편은 시즌1 안에서 고름
function orderChapters(list, title, keepOldest) {
    if (!list || list.length < 2) return list;
    const PRO = "\u0000prologue";
    const norm = (p) => String(p || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const isExtra = (p) => p.indexOf("번외") >= 0 || p.indexOf("외전") >= 0;
    const seasonOf = (p) => { const m = /(?:시즌|season)(\d+)$|(\d+)부$/.exec(p || ""); return m ? parseInt(m[1] || m[2], 10) : 1; };
    // 제목 전체를 먼저 지움 ("시아버지가 다 따먹음 10화" 의 한 글자 단어 "다" 도 지워지게)
    const titleWords = [...new Set([norm(title)].concat((String(title || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
        .filter((w) => w.length >= 2)))].filter((w) => w).sort((a, b) => b.length - a.length);
    // 2026-11-11: 맨 앞 "2-15화"·"3-204화" 가 부 표시인 작품(블랙툰 덴마: 1부 "N화" · 2부 "2-N화" · 3부 "3-N화") — 같은 한 자리 앞 숫자로
    // 10개 넘게, 번호가 20 넘게도 있으면 "2부 15화" 로 봄 (나눈 회차 "41-1화"·"5-2화" 는 그대로)
    const partRe = /^(\d)\s*-\s*(\d+)\s*화/;
    const partNums = (() => {
        const m = {};
        for (const c of list) {
            const x = partRe.exec(String(c.name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, ""));
            if (x) (m[x[1]] = m[x[1]] || new Set()).add(parseInt(x[2], 10));
        }
        return new Set(Object.keys(m).filter((k) => m[k].size >= 10 && Math.max(...m[k]) >= 20));
    })();
    const keyOf = (c, i, arr) => {
        // 이름 맨 앞 사이트 순번 ("0001 - 별을 품은 소드마스터 1화") 은 비교에서 뺌
        let name = String(c.name || "").trim();
        const seq = /^(\d{2,})(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/.exec(name);
        if (seq) name = name.substring(seq[0].length);
        if (partNums.size) name = name.replace(partRe, (s, p, n) => (partNums.has(p) ? `${p}부 ${n}화` : s));
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
        // 2026-11-11: "LESSON 41. 인간의 왕"·"EP 12"·"Episode 3" 의 번호도 (2026-11-14 "Chapter N"·"Ch N" 도 — 블랙툰 "… RAW Chapter 57" 이 57화 자리. 앞부분이 달라 본편 빈 번호일 때만 본편으로 합쳐지고, 겹치면 뒤로) "N화" 와 같은 묶음으로 (검은머리 기사왕: LESSON·"6화" 가 섞여 따로 줄 섰음)
        name = name.replace(/(?:^|[\s\-–:])(?:lesson|episode|chapter|ep|ch)\.?\s*(\d+(?:[.-]\d+)?)(?:\s*화)?\.?(?=\s|$)/i, (s, n) => ` ${n}화 `).trim();
        const index = arr.length - 1 - i;
        // "2부 172화" 의 "2부" 는 부 표시 (뒤에 다른 단위 번호가 있으면 그것이 회차)
        // "1~5화" 처럼 여러 화를 묶은 회차는 첫 화 번호
        // 2026-11-14: "2, 3화" 처럼 이어진 번호를 쉼표로 묶은 회차는 "2~3화" 와 같게 (11toon 식량인류)
        name = name.replace(/(\d{1,5})\s*,\s*(\d{1,5})(\s*화)/g, (x, a, b, h) => (+b > +a && +b - +a <= 3 ? a + "~" + b + h : x));
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
        // 2026-11-11: 사이트 순번과 회차 번호가 같으면 이름이 달라도 같은 회차를 다시 올린 것 ("0234 - 취사병 전설이 되다 234화" ↔ "0234 - 234화 ： 외전4화")
        {
            const sq = /^\s*(\d{2,})\s+-\s+/.exec(String(c.name || ""));
            const nm = sq && /(\d+)\s*화/.exec(String(c.name).substring(sq[0].length));
            if (nm && parseInt(sq[1], 10) === parseInt(nm[1], 10)) k = `#${parseInt(nm[1], 10)}화`;
        }
        // keepOldest: 가장 먼저 올라온 것을 남김 (newxtoon 은 다시 올린 회차 그림이 404 라 원래 회차를 남김)
        const t = Number(c.dateUpload || 0);
        const bt = best[k] === undefined ? 0 : Number(list[best[k]].dateUpload || 0);
        if (best[k] === undefined || (keepOldest ? t < bt : t > bt)) best[k] = i;
    });
    const keep = new Set(Object.values(best));
    if (keep.size + fixed.size < list.length) list = list.filter((c, i) => keep.has(i) || fixed.has(c));
    if (list.length < 2) return list;
    const keys = list.map((c, i) => {
        const k = keyOf(c, i, list);
        if (fixed.has(c)) { k.num = fixed.get(c); k.fixed = true; }
        return k;
    });
    // 2026-11-12: 1~3화 대신 카운트다운 회차("D-2"·"D-1"·"D-DAY", 툰코 종말에서 살아남기)가 있고 본편이 그 개수만큼 늦게 시작하면(4화부터)
    // 본편 맨 앞 빈 번호에 D-큰 수 → D-DAY 차례로 넣음 (전엔 다른 묶음으로 보고 맨 뒤로 보냈음)
    {
        const tt = String(title || "").trim();
        const dOf = (c) => {
            let n = String(c.name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "");
            if (tt && n.startsWith(tt)) n = n.substring(tt.length).trim();
            const m = /^D\s*-\s*(\d+|DAY)$/i.exec(n);
            return m ? (/day/i.test(m[1]) ? 0 : parseInt(m[1], 10)) : null;
        };
        const ds = list.map((c, i) => ({ i, d: dOf(c) })).filter((x) => x.d !== null).sort((x, y) => y.d - x.d);
        const mainNums = keys.filter((k) => k.prefix === "" && k.unit === "화" && k.num >= 1).map((k) => k.num);
        const first = mainNums.length ? Math.min(...mainNums) : 0;
        if (ds.length && first > ds.length && new Set(ds.map((x) => x.d)).size === ds.length) {
            ds.forEach((x, j) => { const k = keys[x.i]; k.prefix = ""; k.unit = "화"; k.num = first - ds.length + j; k.fixed = true; });
        }
    }
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
            const before = sameUnit && !isExtra(groups[g].prefix) && [...groups[g].nums].every((n) => !mg.nums.has(n) && (n < Math.max(...mg.nums) || (groups[g].prefix === "" && n <= Math.max(...mg.nums) + 2))) /* 2026-11-11: 본편 마지막 번호 바로 다음(+2까지)인 그냥 "N화"(앞에 다른 말 없음)도(SSS급 자살헌터 "151화" vs "죽어야 사는 헌터 150화") 본편 — 더 크면 다른 묶음(원피스 권·피안도 2부) */ &&
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
    // 2026-11-11: 본편 번호의 빈칸 수가 그 사이에 끼어 올라온 다른 회차(외전 등) 수와 거의 같으면 사이트가 그 회차까지 세어 본편 번호를 매긴 것
    // (블랙툰 애늙은이: 128화 뒤 외전 16개 다음 "144화", 156화 뒤 외전 4개 다음 "161화") → 아래 시즌 작품처럼 사이트 순서 그대로 차례 번호
    const interleaved = (() => {
        if (main === null) return false;
        const mk = keys.filter((k) => k.group === main && k.num >= 0);
        if (mk.length < 10) return false;
        const nums = new Set(mk.map((k) => Math.floor(k.num)));
        const lo = Math.min(...nums);
        const hi = Math.max(...nums);
        let gaps = 0;
        for (let n = lo; n <= hi; n++) if (!nums.has(n)) gaps++;
        const a = Math.min(...mk.map((k) => k.index));
        const b = Math.max(...mk.map((k) => k.index));
        const inside = keys.filter((k) => k.group !== main && k.prefix !== PRO && k.index > a && k.index < b).length;
        return gaps >= 3 && inside >= 3 && Math.abs(gaps - inside) <= Math.max(2, Math.round(gaps * 0.1));
    })();
    if (seasons || interleaved) {
        // 시즌마다 번호가 다시 시작하고 사이트가 시즌 표시를 빼먹거나 이어 붙인 번호를 쓰기도 함
        // (굿툰 닥터 최태수: 시즌2 중간이 "61화~65화", 시즌5 뒤가 "126화~136화") → 사이트 순서(최신 → 과거) 그대로,
        // 망가요미가 읽는 이름 맨 앞 숫자가 순번과 다르면 "순번 · " 을 붙임 (2026-11-04)
        const hasPro = keys.some((k) => k.prefix === PRO);
        return list.map((c, i) => {
            if (keys[i].prefix === PRO) return c;
            const pos = keys[i].index + (hasPro ? 0 : 1);
            const lead = /\d+/.exec(String(c.name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "")); // 2026-11-11: 사이트 순번("0081 - ")은 chapterPosition 이 이름에서 빼므로 그 뒤 숫자로 비교 (블랙툰 위닝샷! "0081 - 위닝샷! 시즌2 4화" 는 앱이 2 로 읽어 겹쳤음)
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

// 회차 이름 끝에 남은 화 수를 붙임 ("112화 · 남은 26화", 마지막 화는 "112화 · 마지막"). list: 최신 → 과거
// 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목은 뺌. 설정 "회차 이름에 남은 화 표시"로 끌 수 있음
// 이름 맨 앞이 작품 제목이면(글자·숫자만 비교) 제목이 끝나는 자리, 아니면 0
// 제목 끝 덧붙임("일진녀 길들이기[탑툰]"·"…(완결)")이 회차 이름에 없으면 그 부분을 뺀 제목으로도 맞춰 봄
// 2026-11-11: 사이트 오타로 작품 제목과 한 글자만 다른 이름("나 혼자만 레벌업 124화" ↔ "나 혼자만 레벨업") — 제목 4글자 이상이고 바로 뒤가 회차 번호일 때만 뗌
function titleCut(name, title) {
    const exact = titleCutExact(name, title);
    if (exact > 0) return exact;
    const T = String(title || "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (T.length < 4) return 0;
    const s = String(name || "");
    let j = 0;
    let miss = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!/[\p{L}\p{N}]/u.test(ch)) continue;
        if (ch.toLowerCase() !== T[j] && ++miss > 1) return 0;
        j++;
        if (j === T.length) return /^\s*\d/.test(s.substring(i + 1)) ? i + 1 : 0;
    }
    return 0;
}
function titleCutExact(name, title) {
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
        // 사이트가 긴 제목을 가운데 "…" 로 줄인 이름("샹그릴라 프론티어 …하려하다~ 13화"·"원피스(ONE PI…ECE) 999화") — 앞뒤 조각이 모두 작품 제목의 일부면 뺌
        {
            const el = n.indexOf("…");
            const pt = String(t).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
            if (el > 0 && pt.length >= 2) {
                const before = n.slice(0, el).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
                const m2 = /^([^\d]*?)\s*(?=\d)/.exec(n.slice(el + 1));
                const after = m2 ? m2[1].replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() : null;
                if (before.length >= 2 && pt.startsWith(before) && after !== null && pt.includes(after)) n = n.slice(el + 1 + m2[0].length);
            }
        }
        return { c, lead, n };
    });
    // 2026-11-11: 작품 제목이 다른 글자로 붙은 경우("GACHIAKUTA" ↔ "가치액터 47화") — 여러 회차(3개 이상) 앞에 똑같이 붙은 글자를 제목으로 보고 뺌
    // (숫자가 들어 있거나 외전·번외·특별·시즌·후기·공지 같은 뜻 있는 말이면 빼지 않음)
    const cnt = {};
    for (const x of rows) {
        const m = /^([^\d]{2,40}?)\s*\d+(?:[.-]\d+)?\s*화/.exec(x.n); // 띄어쓰기 없이 붙은 제목("종말의 왈큐레13화")도
        if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
    }
    // 제목 변형이 여러 가지면("종말의 왈큐레(Re…arok)"·"종말의 왈큐레(Re…ok)"·"종말의 왈큐레") 조건에 맞는 것을 모두, 긴 것부터
    const num = (s) => (/^(\d+(?:[.-]\d+)?)\s*화/.exec(s) || [])[1];
    const commons = Object.keys(cnt).filter((p) => cnt[p] >= 3 && !/외전|번외|특별|시즌|부$|후기|공지|휴재|에필로그|프롤로그|예고|단편|완결|최종|season|ep\b/i.test(p)).filter((p) => {
        // 떼면 다른 회차 번호와 겹치는 말("애프터스토리 1~33화" ↔ 본편 1~62화)은 제목이 아니라 따로 묶인 회차 이름이라 그대로 둠
        const mine = new Set(), other = new Set();
        for (const x of rows) {
            if (x.n.startsWith(p)) { const v = num(x.n.substring(p.length).replace(/^[\s\-–:·.]+/, "")); if (v) mine.add(v); }
            else { const v = num(x.n); if (v) other.add(v); }
        }
        return ![...mine].some((v) => other.has(v));
    }).sort((a, b) => b.length - a.length);
    return rows.map((x, i) => {
        let n = x.n;
        const common = commons.find((p) => n.startsWith(p));
        if (common) {
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

// 회차 많은 작품 빨리 열기: 지난번 전체 회차 목록을 저장해 두고, 첫 쪽의 가장 오래된 회차가 그 안에 있고
// 합친 개수가 사이트의 총 화수와 같으면 나머지 쪽은 받지 않음 (안 맞으면 예전처럼 전부 받음)
function loadChapterCache(key) {
    try {
        const v = new SharedPreferences().getString(key, "");
        return v ? JSON.parse(v) : null;
    } catch (e) {
        return null;
    }
}

function saveChapterCache(key, list) {
    try {
        new SharedPreferences().setString(key, JSON.stringify(list.map((c) => ({ name: c.name, url: c.url, dateUpload: c.dateUpload }))));
    } catch (e) {}
}

function mergeChapterCache(cached, firstPage, total) {
    if (!cached || !cached.length || !total || !firstPage.length) return null;
    const oldest = firstPage[firstPage.length - 1].url;
    const at = cached.findIndex((c) => c.url === oldest);
    if (at < 0) return null;
    const seen = {};
    firstPage.forEach((c) => { seen[c.url] = true; });
    const merged = firstPage.concat(cached.slice(at + 1).filter((c) => !seen[c.url] && (seen[c.url] = true)));
    return merged.length === total ? merged : null;
}

const WOLF_TRIED = {};

// 주소 바뀜 대응 설정: 사이트 주소 모양, 진짜 사이트 표시 글자, User-Agent, 직접 넣은 주소 설정 키
const ADDR_HOST = AUTO_HOST;
const ADDR_MARK = "t-card";
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
// 2026-11-13 안내 페이지 주소 따라가기: 감시 작업이 저장소 주소 목록(domains.json)을 매일 고치므로,
// 6시간마다 목록의 주소를 봐서 지금 주소와 같은 사이트 이름이고 번호가 더 크며 진짜 사이트로 열리면 자동 주소로 저장
// (직접 넣은 주소도 번호를 비교해 고침). 잘 열리는 동안에도 따라가지만, 목록에 적힌 주소만 씀
function addrNewer(a, b) {
    const brand = (h) => h.replace(/\d+/g, "").split(".").slice(0, -1).sort((x, y) => y.length - x.length)[0] || "";
    const nums = (h) => (h.match(/\d+/g) || []).map(Number);
    if (a === b || !brand(a) || brand(a) !== brand(b)) return false;
    const x = nums(a);
    const y = nums(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] > y[i];
    return x.length > y.length;
}

// 2026-11-13: 마지막 주소 확인 결과를 필터 📡 줄 끝 🔎 에 (같음·새 주소로 바꿈·넘김·아직 안 열림·목록 못 받음)
function addrNoteSave(msg) {
    try {
        const d = new Date(Date.now() + 9 * 3600000);
        const z = (n) => String(n).padStart(2, "0");
        new SharedPreferences().setString("listed_note", `${z(d.getUTCMonth() + 1)}.${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())} ${msg}`);
    } catch (e) {
        // 그대로
    }
}
function addrNoteText() {
    try {
        const v = String(new SharedPreferences().getString("listed_note", "") || "");
        return v ? ` · 🔎 ${v}` : "";
    } catch (e) {
        return "";
    }
}

async function addrFollow(ext) {
    try {
        if (!ext.autoOn()) return;
        const p = new SharedPreferences();
        const at = Number(p.getString("listed_at", "0")) || 0;
        if (Date.now() - at < 6 * 3600000) return;
        p.setString("listed_at", String(Date.now()));
        const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").toLowerCase();
        const plain = (u) => host(u).replace(/^www\./, "");
        const work = async () => {
            const listed = await listedDomain(ext.client, "wolftoon");
            const h = host(listed);
            if (!h) return addrNoteSave("목록 못 받음");
            if (!(ADDR_HOST.test(h) || ADDR_HOST.test(plain(h))) || !addrNewer(plain(h), plain(addrCurrent(ext)))) return addrNoteSave(`같음 (${plain(h)})`);
            if (await addrIsSite(ext, "https://" + h)) {
                p.setString("auto_domain", "https://" + h);
                return addrNoteSave(`새 주소 ${plain(h)} 로 바꿈`);
            }
            addrNoteSave(`${plain(h)} 가 아직 안 열려 그대로`);
        };
        await Promise.race([work(), new Promise((r) => setTimeout(r, 6000))]);
    } catch (e) {
        // 다음 기회에
    }
}

async function addrGuard(ext, page, fn) {
    if (page === 1) await addrFollow(ext);
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
    const to = await movedTarget(ext, [base + "/"], base, marker, true);
    if (to) addrNoteSave(`넘김 → ${to.replace(/^https?:\/\//, "")} 로 바꿈`);
    return to;
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
            const n = (u) => parseInt((String(u).match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
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
            if (ours && res.statusCode === 200) {
                // 옛 주소가 끊기지 않고 "접속 주소 안내" 페이지(새 주소 링크만 있는 작은 페이지)를 보여 주는 경우
                const body = String(res.body || "");
                const cur = parseInt((base.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
                const nums = (body.match(/wfwf\d+\.com/g) || []).map((x) => parseInt(x.match(/\d+/)[0], 10)).filter((x) => x > cur);
                if (nums.length && body.length < 30000 && /<html|<!doctype/i.test(body.substring(0, 3000)) && body.indexOf("t-card") < 0 && body.indexOf("ep-item") < 0) {
                    const next = `https://wfwf${Math.max(...nums)}.com`;
                    let found = null;
                    try {
                        const r = await this.client.get(next + "/", { "User-Agent": MOBILE_UA });
                        if (r.statusCode === 200 && String(r.body || "").indexOf("t-card") >= 0) found = next;
                    } catch (e) {}
                    found = found || await this.discover(base);
                    if (found) {
                        new SharedPreferences().setString("auto_domain", found);
                        const h = {};
                        for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(found);
                        return await this.client.get(found + url.substring(base.length), h);
                    }
                }
            }
            // 정상 화면에 적힌 더 새 주소(사이트가 새 주소로 넘겨 준 경우 포함)를 자동 주소로 기억
            // (망가요미는 넘어간 주소를 알려 주지 않음). 확인에 실패한 주소는 30분 동안 다시 열지 않음
            if (ours && res.statusCode === 200) {
                const body = String(res.body || "");
                const real = body.indexOf("t-card") >= 0 || body.indexOf("ep-item") >= 0;
                // 지금 주소가 다른 주소로 넘겨 주면 그 주소를 기억 (2026-11-08)
                const moved = real ? await movedSelf(this, base, "t-card") : null;
                if (moved) new SharedPreferences().setString("auto_domain", moved);
                if (real && !moved) {
                    const cur = parseInt((base.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
                    const nums = [...new Set((body.match(/wfwf\d+\.com/g) || []).map((x) => parseInt(x.match(/\d+/)[0], 10)))]
                        .filter((x) => x > cur).sort((a, b) => b - a).slice(0, 3);
                    for (const n of nums) {
                        const next = `https://wfwf${n}.com`;
                        if (Date.now() - (WOLF_TRIED[next] || 0) < 30 * 60000) continue;
                        WOLF_TRIED[next] = Date.now();
                        try {
                            const r = await this.client.get(next + "/", { "User-Agent": MOBILE_UA });
                            if (r.statusCode === 200 && String(r.body || "").indexOf("t-card") >= 0) {
                                new SharedPreferences().setString("auto_domain", next);
                                break;
                            }
                        } catch (e) {}
                    }
                }
            }
            // 접근 차단(451)도 새 주소 찾기 (2026-11-07)
            if (!ours || !(res.statusCode >= 500 || res.statusCode === 451)) return res;
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
        const h = {};
        for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(found);
        return await this.client.get(found + url.substring(base.length), h);
    }

    async discover(current) {
        const prefs = new SharedPreferences();
        const last = Number(prefs.getString("auto_tried_at", "0")) || 0;
        if (Date.now() - last < 60 * 1000) return null;
        prefs.setString("auto_tried_at", String(Date.now()));

        // 저장소 주소 목록 파일(domains.json)에 적힌 주소 먼저 (진짜 사이트일 때만)
        const listedC = await listedDomain(this.client, "wolftoon");
        if (listedC && listedC !== current) {
            const c = listedC;
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                if (r.statusCode === 200 && String(r.body || "").includes("t-card")) {
                    prefs.setString("auto_domain", c);
                    return c;
                }
            } catch (e) {
                // 원래 방법으로
            }
        }

        // 지금 주소·안내 주소가 넘겨 주는(301·302) 주소를 직접 읽어, 진짜 사이트면 사용 (2026-11-08)
        const movedC = await movedTarget(this, [current + "/"], current, "t-card", false);
        if (movedC) {
            prefs.setString("auto_domain", movedC);
            return movedC;
        }

        const num = (u) => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const cur = num(current) || num(this.source.baseUrl);
        // ① 공식 텔레그램 채널 공개 화면(WOLF_GUIDE)에 적힌 주소 (번호가 큰 것부터, 진짜 목록이 열리는지 확인)
        try {
            const g = await this.client.get(WOLF_GUIDE, { "User-Agent": MOBILE_UA });
            const listed = [...new Set((String(g.body || "").match(/wfwf\d+\.com/g) || []))]
                .map((h) => `https://${h}`).filter((h) => h !== current).sort((a, b) => num(b) - num(a));
            for (const h of listed.slice(0, 3)) {
                try {
                    const r = await this.client.get(h + "/", { "User-Agent": MOBILE_UA });
                    if (r.statusCode === 200 && String(r.body || "").includes("t-card")) {
                        prefs.setString("auto_domain", h);
                        return h;
                    }
                } catch (e) {
                    // 다음 주소
                }
            }
        } catch (e) {
            // 번호 찾기로
        }
        // ② 지금 번호 주변 (-10 ~ +60)
        const cands = [];
        for (let i = Math.max(1, cur - 10); i <= cur + 60; i++) {
            const c = `https://wfwf${i}.com`;
            if (c !== current) cands.push(c);
        }
        const hits = await Promise.all(cands.map(async (c) => {
            try {
                const r = await this.client.get(c + "/", { "User-Agent": MOBILE_UA });
                return r.statusCode === 200 && String(r.body || "").includes("t-card") ? c : null;
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

    abs(u) {
        if (!u) return "";
        if (/^https?:\/\//.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return this.base + (u.startsWith("/") ? "" : "/") + u;
    }

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "").replace(/&amp;/g, "&");
    }

    async get(url) {
        const res = await this.req(url, this.hdr());
        return fixEucKr(res.body || "");
    }

    // ---------- 목록 ----------
    listUrl(path, page, params) {
        const parts = [];
        for (const k in params || {}) if (params[k]) parts.push(`${k}=${encodeEucKr(params[k])}`);
        if (page > 1) parts.push(`pg=${page}`);
        return this.base + path + (parts.length ? "?" + parts.join("&") : "");
    }

    parseList(html, page) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a.t-card")) {
            const link = this.path(a.attr("href"));
            if (!DETAIL_PATH.test(link) || seen[link]) continue;
            seen[link] = true;
            const name = (a.selectFirst(".t-title")?.text || "").trim();
            if (!name) continue;
            const img = a.selectFirst(".t-img img");
            list.push({ name, imageUrl: img ? this.abs(img.attr("src")) : "", link });
        }
        let maxPg = 0;
        for (const a of doc.select(".pagi a.pg-btn")) {
            const m = (a.attr("href") || "").match(/[?&]pg=(\d+)/);
            if (m) maxPg = Math.max(maxPg, parseInt(m[1], 10));
        }
        return { list, hasNextPage: maxPg > page };
    }

    async basePopular(page) {
        return this.parseList(await this.get(this.listUrl(HOME_PATH, page, { o: "f" })), page);
    }

    async baseLatest(page) {
        return this.parseList(await this.get(this.listUrl(HOME_PATH, page, { o: "n" })), page);
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            return this.parseList(await this.get(this.listUrl("/sh", page, { q: query.trim() })), page);
        }
        let path = HOME_PATH;
        const params = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) {
                const v = f.values[f.state].value;
                if (f.param === "list") path = v; else params[f.param] = v;
            } else if (f.type_name === "TextFilter" && f.param && String(f.state || "").trim()) {
                params[f.param] = String(f.state).trim();
            }
        }
        // 만화책 목록은 분류·요일 값을 쓰지 않음
        if (path === "/cm") {
            delete params.t1;
            delete params.t2;
        }
        return this.parseList(await this.get(this.listUrl(path, page, params)), page);
    }

    // ---------- 상세 + 회차 (한 페이지에 100화씩, 최신순) ----------
    chapterPageUrl(detailPath, page) {
        return this.abs(detailPath.replace(/&(s|pg)=[^&]*/g, "")) + `&s=n&pg=${page}`;
    }

    parseChapters(doc, seen, out) {
        for (const a of doc.select("a.ep-item")) {
            const url = this.path(a.attr("href"));
            if (!url || seen[url]) continue;
            seen[url] = true;
            const d = (a.selectFirst(".ep-date")?.text || "").trim().match(/(\d{4})-(\d{2})-(\d{2})/);
            out.push({
                name: (a.selectFirst(".ep-title")?.text || "").trim() || `${a.attr("data-num")}화`,
                url,
                dateUpload: d ? String(new Date(`${d[1]}-${d[2]}-${d[3]}T00:00:00+09:00`).valueOf()) : null
            });
        }
    }

    async getDetail(url) {
        const detailPath = this.path(url);
        const firstHtml = await this.get(this.chapterPageUrl(detailPath, 1));
        const doc = new Document(firstHtml);

        const totalM = (doc.selectFirst(".list-header-title")?.text || "").match(/총\s*([\d,]+)\s*화/);
        const total = totalM ? parseInt(totalM[1].replace(/,/g, ""), 10) : 0;
        let linkPages = 1;
        for (const a of doc.select(".pagi a.pg-btn")) {
            const m = (a.attr("href") || "").match(/[?&]pg=(\d+)/);
            if (m) linkPages = Math.max(linkPages, parseInt(m[1], 10));
        }
        const pages = Math.min(100, Math.max(linkPages, Math.ceil(total / 100), 1));

        const seen = {};
        let chapters = [];
        this.parseChapters(doc, seen, chapters);
        // 회차 많은 작품: 지난번 전체 목록과 첫 쪽이 이어지면 나머지 쪽은 받지 않음
        const cacheKey = "chcache:" + detailPath.replace(/&(s|pg)=[^&]*/g, "");
        const merged = pages > 1 ? mergeChapterCache(loadChapterCache(cacheKey), chapters, total) : null;
        if (merged) chapters = merged;
        for (let p = 2; p <= pages && !merged; p++) {
            let html;
            try {
                html = await this.get(this.chapterPageUrl(detailPath, p));
            } catch (e) {
                break;
            }
            const before = chapters.length;
            this.parseChapters(new Document(html), seen, chapters);
            if (chapters.length === before) break;
        }
        if (pages > 1) saveChapterCache(cacheKey, chapters);

        const img = doc.selectFirst(".title-sec .thumb-wrap img");
        return {
            name: (doc.selectFirst("h1.w-title")?.text || "").trim(),
            imageUrl: img ? this.abs(img.attr("src")) : "",
            description: (doc.selectFirst("#summary")?.text || "").trim(),
            genre: doc.select(".genre-tags a.gtag").map((e) => e.text.trim().replace(/^#/, "")).filter((s) => s),
            // 상세 페이지 상단 메뉴에서 현재 칸(연재/완결)이 강조됨 (0 연재, 1 완결, 5 알 수 없음)
            status: { "/ing": 0, "/end": 1 }[(doc.selectFirst("a.nav-item.active")?.attr("href") || "").trim()] ?? 5,
            link: this.abs(detailPath),
            chapters: chapterPosition(orderChapters(chapters, (doc.selectFirst("h1.w-title")?.text || "").trim()), (doc.selectFirst("h1.w-title")?.text || "").trim())
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const pageUrl = this.abs(this.path(url));
        const html = await this.get(pageUrl);
        const doc = new Document(html);
        let imgs = doc.select("#vimg-area img");
        if (!imgs.length) imgs = doc.select(".vimg-area img");
        const urls = [];
        for (const img of imgs) {
            const raw = [img.attr("data-src"), img.attr("data-original"), img.attr("src")]
                .map((s) => (s || "").trim()).find((s) => s && !s.startsWith("data:"));
            if (!raw) continue;
            const u = this.abs(raw.replace(/&amp;/g, "&"));
            if (urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) {
            const title = (doc.selectFirst("title")?.text || "").trim().substring(0, 40);
            throw new Error(`이미지를 찾을 수 없습니다 (제목: ${title || "없음"})`);
        }
        return urls.map((u) => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map((p) => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        if (COMIC) {
            return [
                { type_name: "HeaderFilter", name: "검색어가 없을 때만 적용" },
                sel("정렬", "o", [["최신순", "n"], ["인기순", "f"]]),
                sel("장르", "t3", COMIC_GENRES)
            ];
        }
        return [
            { type_name: "HeaderFilter", name: "검색어가 없을 때만 적용" },
            sel("목록", "list", [["연재", "/ing"], ["완결", "/end"], ["만화책", "/cm"]]),
            sel("정렬", "o", [["최신순", "n"], ["인기순", "f"], ["신작순", "r"]]),
            sel("분류 (웹툰)", "t2", [["전체", ""], ["일반", "1"], ["BL", "2"], ["성인", "3"]]),
            sel("요일 (웹툰)", "t1", [["전체", ""], ["월", "1"], ["화", "2"], ["수", "3"], ["목", "4"], ["금", "5"], ["토", "6"], ["일", "7"], ["10일", "10"]]),
            sel("장르", "t3", [["전체", ""]].concat(GENRES.map((g) => [g, g]))),
            { type_name: "HeaderFilter", name: "만화책 장르는 아래에 직접 입력 (예: 이세계, 러브코미디)" },
            { type_name: "TextFilter", name: "장르 직접 입력", param: "t3", state: "" }
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /[?&]toon=(\d+)/.exec(p); return m ? `${p.startsWith("/cl") ? "/cl" : "/list"}?toon=${m[1]}` : null; });
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
            { type_name: "HeaderFilter", name: `현재 인기: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (사이트 인기 목록)")}` },
            { type_name: "HeaderFilter", name: `현재 최신: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (사이트 최신 목록)")}` },
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
        return statusFilters("wolftoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
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
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 그 주소를 우선 사용 (예: https://wfwf511.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 wfwf###.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
}

const KS_HANGUL_BITS = "kwf/PhGwAxMBKBARAACTBXseEbADlwE7EhGgAJOVazBRsAIRATIwEbACEQEKMHm4BhMBMBAAgAATAQsQEQAAkwMrEAAAAJMFa3RRsCMTATswEAAAAAAAcBGwAxMAKRARgCEBAAAwFbAOAwEwMAAAAhEBIxAAAAATgWsQEAADEwETEBEwAAEAADBVuCIAAAAwEbAClwf7OhGwAxMBIQAAAAAbDTs4EbADEwEzEQEAABMFKxwRAAEAAAAQEbAAEwEqMBmwAgEAEBAAAAARAQMwEDACEwdrFBEAABMFK3T5uI8TATsQAAAAAAAAcNmwShMBOxARAAMRAAAwWbEqEQEAEAAAAREBCxAAAAATASsQAAABAQAgEBGgAhEBITBZsAIBAAAwGbAHEwE7OBGwAwAAAAAAAAATDTs4EbADAQAQAAAAABMBIBAQAAABAAAQAQAAAAAAMBEYAgAAABAAAAARASMAAAAAkwELEBEwABEBKzARsMcTATswAYACAAAAMBGwgxMBKzARsAMRAAowEbACEQAgAAAAAREBKxARoAITASsQAAABAQAAMBGQAhMBKzARsGYAAAAwEbAC0wdrOhGwBwMBIAAAAAATBWs4EbADEwG4EAAAABsFKxABAAMAAAAQEaACEQEKcHmwohEBChAAAAARAQAQEZAAEQEJAAAAAJMFu/L5sCITATsyASAAAAAAMFmwBpMBOzARoCMRAABwEbACEQAQEAAAARMBAxABAACTBysWEAABAQAAMBEAAhEBKTARsAAAAAAwUbAOEwU7OBGwAwMAAQAAAACTATkQAAACAwA7AAAAABMBIwAAAAAAAAAQAAAAAQAgMBGQAgAAAAAAAAAAAAAQAAACEQEDAAAAABMBK7B5sCMTATswEbACEQEh8NmwQxMBOzARsAMRASBwUbAiEwEgEBGQAREBCzARsAKTAasWAAABEwEhMBGwAgMBKTAxsAIAAAAwGbhCGwEzOBEwAwAAIAAAAAATBTMQEQAAAAAAAAEAAJMFIzABAAEBABAQETAAAQAAMBEwAgEAEBAAAAARAAAAAAACE4UDEBEQABMBKzB3uGMTATswkbCiEQECMHvwVxMBK3DR8OMRARswcbkKEwE7MAGQAhMBKzARsAITByswETADEwEjMBGwAhMBqzARtP4RAQkwcbhH0wV7MBGwA1MBIRARAAATBWswEbACEQEzEAAAABMF6zgQoAIBADAQEbACEwAgMHGwAgEAEBAAAAATAQsQERAAEwErAAAAAJMFazaVsAMTATsQAQACAAAAMBGwAwEAIBAAAAEAAAAwEbAKAwEQEAAAAREBAwAAAAITASMQAAADAAAAEAAAAAEAABAAkAIAAAAwETCGUwF7MBGwA1EBIQAAAAATATswEbACEQAQEAEAAhMBKxARAAIAAAAQEbACAQABMBGwAgEAEBABAAARASsQERACEwErAAAAAJMDKzARsAITATswAAACAAAAMBmwAxMBKxARsAMBAAAwEbACEwEhEAAAAgEBABAAAAATASsQEQACAQAgMBGwAhEBATARMAIAAAAwEbACEwM7MBGwAwEAIAAAAAATBTswEbACEQAQEAEAABMBKxQBAAABAAAQAYACAQAAMBGwAgEAEBAAAAATASMQERACkwULEBEwABMBK3BRsCMTATswAAAAAAAAMBGwAxMBKxARMAMBAQowEbACAQAgAAAAABEAABARoACTBSsQAAACAAAAEBGQABEBKRARsAAAAAAwEbACEyErMBGwAwEAIAAAAAATBSswEbACEwE7EBEgABMhKzIRgAITACgwEaACEQEKMBGSAhEBITARAAITASswEZAC0wMrEhEwAhMBKwA=";
const KS_SYMBOL_ROWS = "　、。·‥…¨〃­―∥＼∼‘’“”〔〕〈〉《》「」『』【】±×÷≠≤≥∞∴°′″℃Å￠￡￥♂♀∠⊥⌒∂∇≡≒§※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓≪≫√∽∝∵∫∬∈∋⊆⊇⊂⊃∪∩∧∨￢⇒⇔∀∃´～ˇ˘˝˚˙¸˛¡¿ː∮∑∏¤℉‰◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡↕↗↙↖↘♭♩♪♬㉿㈜№㏇™㏂㏘℡€®�����������������������！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［￦］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣㅤㅥㅦㅧㅨㅩㅪㅫㅬㅭㅮㅯㅰㅱㅲㅳㅴㅵㅶㅷㅸㅹㅺㅻㅼㅽㅾㅿㆀㆁㆂㆃㆄㆅㆆㆇㆈㆉㆊㆋㆌㆍㆎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ�����ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ�������ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ��������αβγδεζηθικλμνξοπρστυφχψω������─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂┒┑┚┙┖┕┎┍┞┟┡┢┦┧┩┪┭┮┱┲┵┶┹┺┽┾╀╁╃╄╅╆╇╈╉╊��������������������������㎕㎖㎗ℓ㎘㏄㎣㎤㎥㎦㎙㎚㎛㎜㎝㎞㎟㎠㎡㎢㏊㎍㎎㎏㏏㎈㎉㏈㎧㎨㎰㎱㎲㎳㎴㎵㎶㎷㎸㎹㎀㎁㎂㎃㎄㎺㎻㎼㎽㎾㎿㎐㎑㎒㎓㎔Ω㏀㏁㎊㎋㎌㏖㏅㎭㎮㎯㏛㎩㎪㎫㎬㏝㏐㏓㏃㏉㏜㏆���������������ÆÐªĦ�Ĳ�ĿŁØŒºÞŦŊ�㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮½⅓⅔¼¾⅛⅜⅝⅞æđðħıĳĸŀłøœßþŧŋŉ㈀㈁㈂㈃㈄㈅㈆㈇㈈㈉㈊㈋㈌㈍㈎㈏㈐㈑㈒㈓㈔㈕㈖㈗㈘㈙㈚㈛⒜⒝⒞⒟⒠⒡⒢⒣⒤⒥⒦⒧⒨⒩⒪⒫⒬⒭⒮⒯⒰⒱⒲⒳⒴⒵⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂¹²³⁴ⁿ₁₂₃₄ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん�����������ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ��������АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ���������������абвгдеёжзийклмнопрстуфхцчшщъыьэюя�������������伽佳假價加可呵哥嘉嫁家暇架枷柯歌珂痂稼苛茄街袈訶賈跏軻迦駕刻却各恪慤殼珏脚覺角閣侃刊墾奸姦干幹懇揀杆柬桿澗癎看磵稈竿簡肝艮艱諫間乫喝曷渴碣竭葛褐蝎鞨勘坎堪嵌感憾戡敢柑橄減甘疳監瞰紺邯鑑鑒龕匣岬甲胛鉀閘剛堈姜岡崗康强彊慷江畺疆糠絳綱羌腔舡薑襁講鋼降鱇介价個凱塏愷愾慨改槪漑疥皆盖箇芥蓋豈鎧開喀客坑更粳羹醵倨去居巨拒据據擧渠炬祛距踞車遽鉅鋸乾件健巾建愆楗腱虔蹇鍵騫乞傑杰桀儉劍劒檢瞼鈐黔劫怯迲偈憩揭擊格檄激膈覡隔堅牽犬甄絹繭肩見譴遣鵑抉決潔結缺訣兼慊箝謙鉗鎌京俓倞傾儆勁勍卿坰境庚徑慶憬擎敬景暻更梗涇炅烱璟璥瓊痙硬磬竟競絅經耕耿脛莖警輕逕鏡頃頸驚鯨係啓堺契季屆悸戒桂械棨溪界癸磎稽系繫繼計誡谿階鷄古叩告呱固姑孤尻庫拷攷故敲暠枯槁沽痼皐睾稿羔考股膏苦苽菰藁蠱袴誥賈辜錮雇顧高鼓哭斛曲梏穀谷鵠困坤崑昆梱棍滾琨袞鯤汨滑骨供公共功孔工恐恭拱控攻珙空蚣貢鞏串寡戈果瓜科菓誇課跨過鍋顆廓槨藿郭串冠官寬慣棺款灌琯瓘管罐菅觀貫關館刮恝括适侊光匡壙廣曠洸炚狂珖筐胱鑛卦掛罫乖傀塊壞怪愧拐槐魁宏紘肱轟交僑咬喬嬌嶠巧攪敎校橋狡皎矯絞翹膠蕎蛟較轎郊餃驕鮫丘久九仇俱具勾區口句咎嘔坵垢寇嶇廐懼拘救枸柩構歐毆毬求溝灸狗玖球瞿矩究絿耉臼舅舊苟衢謳購軀逑邱鉤銶駒驅鳩鷗龜國局菊鞠鞫麴君窘群裙軍郡堀屈掘窟宮弓穹窮芎躬倦券勸卷圈拳捲權淃眷厥獗蕨蹶闕机櫃潰詭軌饋句晷歸貴鬼龜叫圭奎揆槻珪硅窺竅糾葵規赳逵閨勻均畇筠菌鈞龜橘克剋劇戟棘極隙僅劤勤懃斤根槿瑾筋芹菫覲謹近饉契今妗擒昑檎琴禁禽芩衾衿襟金錦伋及急扱汲級給亘兢矜肯企伎其冀嗜器圻基埼夔奇妓寄岐崎己幾忌技旗旣朞期杞棋棄機欺氣汽沂淇玘琦琪璂璣畸畿碁磯祁祇祈祺箕紀綺羈耆耭肌記譏豈起錡錤飢饑騎騏驥麒緊佶吉拮桔金喫儺喇奈娜懦懶拏拿癩羅蘿螺裸邏那樂洛烙珞落諾酪駱亂卵暖欄煖爛蘭難鸞捏捺南嵐枏楠湳濫男藍襤拉納臘蠟衲囊娘廊朗浪狼郎乃來內奈柰耐冷女年撚秊念恬拈捻寧寗努勞奴弩怒擄櫓爐瑙盧老蘆虜路露駑魯鷺碌祿綠菉錄鹿論壟弄濃籠聾膿農惱牢磊腦賂雷尿壘屢樓淚漏累縷陋嫩訥杻紐勒肋凜凌稜綾能菱陵尼泥匿溺多茶丹亶但單團壇彖斷旦檀段湍短端簞緞蛋袒鄲鍛撻澾獺疸達啖坍憺擔曇淡湛潭澹痰聃膽蕁覃談譚錟沓畓答踏遝唐堂塘幢戇撞棠當糖螳黨代垈坮大對岱帶待戴擡玳臺袋貸隊黛宅德悳倒刀到圖堵塗導屠島嶋度徒悼挑掉搗桃棹櫂淘渡滔濤燾盜睹禱稻萄覩賭跳蹈逃途道都鍍陶韜毒瀆牘犢獨督禿篤纛讀墩惇敦旽暾沌焞燉豚頓乭突仝冬凍動同憧東桐棟洞潼疼瞳童胴董銅兜斗杜枓痘竇荳讀豆逗頭屯臀芚遁遯鈍得嶝橙燈登等藤謄鄧騰喇懶拏癩羅蘿螺裸邏樂洛烙珞絡落諾酪駱丹亂卵欄欒瀾爛蘭鸞剌辣嵐擥攬欖濫籃纜藍襤覽拉臘蠟廊朗浪狼琅瑯螂郞來崍徠萊冷掠略亮倆兩凉梁樑粮粱糧良諒輛量侶儷勵呂廬慮戾旅櫚濾礪藜蠣閭驢驪麗黎力曆歷瀝礫轢靂憐戀攣漣煉璉練聯蓮輦連鍊冽列劣洌烈裂廉斂殮濂簾獵令伶囹寧岺嶺怜玲笭羚翎聆逞鈴零靈領齡例澧禮醴隷勞怒撈擄櫓潞瀘爐盧老蘆虜路輅露魯鷺鹵碌祿綠菉錄鹿麓論壟弄朧瀧瓏籠聾儡瀨牢磊賂賚賴雷了僚寮廖料燎療瞭聊蓼遼鬧龍壘婁屢樓淚漏瘻累縷蔞褸鏤陋劉旒柳榴流溜瀏琉瑠留瘤硫謬類六戮陸侖倫崙淪綸輪律慄栗率隆勒肋凜凌楞稜綾菱陵俚利厘吏唎履悧李梨浬犁狸理璃異痢籬罹羸莉裏裡里釐離鯉吝潾燐璘藺躪隣鱗麟林淋琳臨霖砬立笠粒摩瑪痲碼磨馬魔麻寞幕漠膜莫邈万卍娩巒彎慢挽晩曼滿漫灣瞞萬蔓蠻輓饅鰻唜抹末沫茉襪靺亡妄忘忙望網罔芒茫莽輞邙埋妹媒寐昧枚梅每煤罵買賣邁魅脈貊陌驀麥孟氓猛盲盟萌冪覓免冕勉棉沔眄眠綿緬面麵滅蔑冥名命明暝椧溟皿瞑茗蓂螟酩銘鳴袂侮冒募姆帽慕摸摹暮某模母毛牟牡瑁眸矛耗芼茅謀謨貌木沐牧目睦穆鶩歿沒夢朦蒙卯墓妙廟描昴杳渺猫竗苗錨務巫憮懋戊拇撫无楙武毋無珷畝繆舞茂蕪誣貿霧鵡墨默們刎吻問文汶紊紋聞蚊門雯勿沕物味媚尾嵋彌微未梶楣渼湄眉米美薇謎迷靡黴岷悶愍憫敏旻旼民泯玟珉緡閔密蜜謐剝博拍搏撲朴樸泊珀璞箔粕縛膊舶薄迫雹駁伴半反叛拌搬攀斑槃泮潘班畔瘢盤盼磐磻礬絆般蟠返頒飯勃拔撥渤潑發跋醱鉢髮魃倣傍坊妨尨幇彷房放方旁昉枋榜滂磅紡肪膀舫芳蒡蚌訪謗邦防龐倍俳北培徘拜排杯湃焙盃背胚裴裵褙賠輩配陪伯佰帛柏栢白百魄幡樊煩燔番磻繁蕃藩飜伐筏罰閥凡帆梵氾汎泛犯範范法琺僻劈壁擘檗璧癖碧蘗闢霹便卞弁變辨辯邊別瞥鱉鼈丙倂兵屛幷昞昺柄棅炳甁病秉竝輧餠騈保堡報寶普步洑湺潽珤甫菩補褓譜輔伏僕匐卜宓復服福腹茯蔔複覆輹輻馥鰒本乶俸奉封峯峰捧棒烽熢琫縫蓬蜂逢鋒鳳不付俯傅剖副否咐埠夫婦孚孵富府復扶敷斧浮溥父符簿缶腐腑膚艀芙莩訃負賦賻赴趺部釜阜附駙鳧北分吩噴墳奔奮忿憤扮昐汾焚盆粉糞紛芬賁雰不佛弗彿拂崩朋棚硼繃鵬丕備匕匪卑妃婢庇悲憊扉批斐枇榧比毖毗毘沸泌琵痺砒碑秕秘粃緋翡肥脾臂菲蜚裨誹譬費鄙非飛鼻嚬嬪彬斌檳殯浜濱瀕牝玭貧賓頻憑氷聘騁乍事些仕伺似使俟僿史司唆嗣四士奢娑寫寺射巳師徙思捨斜斯柶査梭死沙泗渣瀉獅砂社祀祠私篩紗絲肆舍莎蓑蛇裟詐詞謝賜赦辭邪飼駟麝削數朔索傘刪山散汕珊産疝算蒜酸霰乷撒殺煞薩三參杉森渗芟蔘衫揷澁鈒颯上傷像償商喪嘗孀尙峠常床庠廂想桑橡湘爽牀狀相祥箱翔裳觴詳象賞霜塞璽賽嗇塞穡索色牲生甥省笙墅壻嶼序庶徐恕抒捿敍暑曙書栖棲犀瑞筮絮緖署胥舒薯西誓逝鋤黍鼠夕奭席惜昔晳析汐淅潟石碩蓆釋錫仙僊先善嬋宣扇敾旋渲煽琁瑄璇璿癬禪線繕羨腺膳船蘚蟬詵跣選銑鐥饍鮮卨屑楔泄洩渫舌薛褻設說雪齧剡暹殲纖蟾贍閃陝攝涉燮葉城姓宬性惺成星晟猩珹盛省筬聖聲腥誠醒世勢歲洗稅笹細說貰召嘯塑宵小少巢所掃搔昭梳沼消溯瀟炤燒甦疏疎瘙笑篠簫素紹蔬蕭蘇訴逍遡邵銷韶騷俗屬束涑粟續謖贖速孫巽損蓀遜飡率宋悚松淞訟誦送頌刷殺灑碎鎖衰釗修受嗽囚垂壽嫂守岫峀帥愁戍手授搜收數樹殊水洙漱燧狩獸琇璲瘦睡秀穗竪粹綏綬繡羞脩茱蒐蓚藪袖誰讐輸遂邃酬銖銹隋隧隨雖需須首髓鬚叔塾夙孰宿淑潚熟琡璹肅菽巡徇循恂旬栒楯橓殉洵淳珣盾瞬筍純脣舜荀蓴蕣詢諄醇錞順馴戌術述鉥崇崧嵩瑟膝蝨濕拾習褶襲丞乘僧勝升承昇繩蠅陞侍匙嘶始媤尸屎屍市弑恃施是時枾柴猜矢示翅蒔蓍視試詩諡豕豺埴寔式息拭植殖湜熄篒蝕識軾食飾伸侁信呻娠宸愼新晨燼申神紳腎臣莘薪藎蜃訊身辛辰迅失室實悉審尋心沁沈深瀋甚芯諶什十拾雙氏亞俄兒啞娥峨我牙芽莪蛾衙訝阿雅餓鴉鵝堊岳嶽幄惡愕握樂渥鄂鍔顎鰐齷安岸按晏案眼雁鞍顔鮟斡謁軋閼唵岩巖庵暗癌菴闇壓押狎鴨仰央怏昻殃秧鴦厓哀埃崖愛曖涯碍艾隘靄厄扼掖液縊腋額櫻罌鶯鸚也倻冶夜惹揶椰爺耶若野弱掠略約若葯蒻藥躍亮佯兩凉壤孃恙揚攘敭暘梁楊樣洋瀁煬痒瘍禳穰糧羊良襄諒讓釀陽量養圄御於漁瘀禦語馭魚齬億憶抑檍臆偃堰彦焉言諺孼蘖俺儼嚴奄掩淹嶪業円予余勵呂女如廬旅歟汝濾璵礖礪與艅茹輿轝閭餘驪麗黎亦力域役易曆歷疫繹譯轢逆驛嚥堧姸娟宴年延憐戀捐挻撚椽沇沿涎涓淵演漣烟然煙煉燃燕璉硏硯秊筵緣練縯聯衍軟輦蓮連鉛鍊鳶列劣咽悅涅烈熱裂說閱厭廉念捻染殮炎焰琰艶苒簾閻髥鹽曄獵燁葉令囹塋寧嶺嶸影怜映暎楹榮永泳渶潁濚瀛瀯煐營獰玲瑛瑩瓔盈穎纓羚聆英詠迎鈴鍈零霙靈領乂倪例刈叡曳汭濊猊睿穢芮藝蘂禮裔詣譽豫醴銳隸霓預五伍俉傲午吾吳嗚塢墺奧娛寤悟惡懊敖旿晤梧汚澳烏熬獒筽蜈誤鰲鼇屋沃獄玉鈺溫瑥瘟穩縕蘊兀壅擁瓮甕癰翁邕雍饔渦瓦窩窪臥蛙蝸訛婉完宛梡椀浣玩琓琬碗緩翫脘腕莞豌阮頑曰往旺枉汪王倭娃歪矮外嵬巍猥畏了僚僥凹堯夭妖姚寥寮尿嶢拗搖撓擾料曜樂橈燎燿瑤療窈窯繇繞耀腰蓼蟯要謠遙遼邀饒慾欲浴縟褥辱俑傭冗勇埇墉容庸慂榕涌湧溶熔瑢用甬聳茸蓉踊鎔鏞龍于佑偶優又友右宇寓尤愚憂旴牛玗瑀盂祐禑禹紆羽芋藕虞迂遇郵釪隅雨雩勖彧旭昱栯煜稶郁頊云暈橒殞澐熉耘芸蕓運隕雲韻蔚鬱亐熊雄元原員圓園垣媛嫄寃怨愿援沅洹湲源爰猿瑗苑袁轅遠阮院願鴛月越鉞位偉僞危圍委威尉慰暐渭爲瑋緯胃萎葦蔿蝟衛褘謂違韋魏乳侑儒兪劉唯喩孺宥幼幽庾悠惟愈愉揄攸有杻柔柚柳楡楢油洧流游溜濡猶猷琉瑜由留癒硫紐維臾萸裕誘諛諭踰蹂遊逾遺酉釉鍮類六堉戮毓肉育陸倫允奫尹崙淪潤玧胤贇輪鈗閏律慄栗率聿戎瀜絨融隆垠恩慇殷誾銀隱乙吟淫蔭陰音飮揖泣邑凝應膺鷹依倚儀宜意懿擬椅毅疑矣義艤薏蟻衣誼議醫二以伊利吏夷姨履已弛彛怡易李梨泥爾珥理異痍痢移罹而耳肄苡荑裏裡貽貳邇里離飴餌匿溺瀷益翊翌翼謚人仁刃印吝咽因姻寅引忍湮燐璘絪茵藺蚓認隣靭靷鱗麟一佚佾壹日溢逸鎰馹任壬妊姙恁林淋稔臨荏賃入卄立笠粒仍剩孕芿仔刺咨姉姿子字孜恣慈滋炙煮玆瓷疵磁紫者自茨蔗藉諮資雌作勺嚼斫昨灼炸爵綽芍酌雀鵲孱棧殘潺盞岑暫潛箴簪蠶雜丈仗匠場墻壯奬將帳庄張掌暲杖樟檣欌漿牆狀獐璋章粧腸臟臧莊葬蔣薔藏裝贓醬長障再哉在宰才材栽梓渽滓災縡裁財載齋齎爭箏諍錚佇低儲咀姐底抵杵楮樗沮渚狙猪疽箸紵苧菹著藷詛貯躇這邸雎齟勣吊嫡寂摘敵滴狄炙的積笛籍績翟荻謫賊赤跡蹟迪迹適鏑佃佺傳全典前剪塡塼奠專展廛悛戰栓殿氈澱煎琠田甸畑癲筌箋箭篆纏詮輾轉鈿銓錢鐫電顚顫餞切截折浙癤竊節絶占岾店漸点粘霑鮎點接摺蝶丁井亭停偵呈姃定幀庭廷征情挺政整旌晶晸柾楨檉正汀淀淨渟湞瀞炡玎珽町睛碇禎程穽精綎艇訂諪貞鄭酊釘鉦鋌錠霆靖靜頂鼎制劑啼堤帝弟悌提梯濟祭第臍薺製諸蹄醍除際霽題齊俎兆凋助嘲弔彫措操早晁曺曹朝條棗槽漕潮照燥爪璪眺祖祚租稠窕粗糟組繰肇藻蚤詔調趙躁造遭釣阻雕鳥族簇足鏃存尊卒拙猝倧宗從悰慫棕淙琮種終綜縱腫踪踵鍾鐘佐坐左座挫罪主住侏做姝胄呪周嗾奏宙州廚晝朱柱株注洲湊澍炷珠疇籌紂紬綢舟蛛註誅走躊輳週酎酒鑄駐竹粥俊儁准埈寯峻晙樽浚準濬焌畯竣蠢逡遵雋駿茁中仲衆重卽櫛楫汁葺增憎曾拯烝甑症繒蒸證贈之只咫地址志持指摯支旨智枝枳止池沚漬知砥祉祗紙肢脂至芝芷蜘誌識贄趾遲直稙稷織職唇嗔塵振搢晉晋桭榛殄津溱珍瑨璡畛疹盡眞瞋秦縉縝臻蔯袗診賑軫辰進鎭陣陳震侄叱姪嫉帙桎瓆疾秩窒膣蛭質跌迭斟朕什執潗緝輯鏶集徵懲澄且侘借叉嗟嵯差次此磋箚茶蹉車遮捉搾着窄錯鑿齪撰澯燦璨瓚竄簒纂粲纘讚贊鑽餐饌刹察擦札紮僭參塹慘慙懺斬站讒讖倉倡創唱娼廠彰愴敞昌昶暢槍滄漲猖瘡窓脹艙菖蒼債埰寀寨彩採砦綵菜蔡采釵冊柵策責凄妻悽處倜刺剔尺慽戚拓擲斥滌瘠脊蹠陟隻仟千喘天川擅泉淺玔穿舛薦賤踐遷釧闡阡韆凸哲喆徹撤澈綴輟轍鐵僉尖沾添甛瞻簽籤詹諂堞妾帖捷牒疊睫諜貼輒廳晴淸聽菁請靑鯖切剃替涕滯締諦逮遞體初剿哨憔抄招梢椒楚樵炒焦硝礁礎秒稍肖艸苕草蕉貂超酢醋醮促囑燭矗蜀觸寸忖村邨叢塚寵悤憁摠總聰蔥銃撮催崔最墜抽推椎楸樞湫皺秋芻萩諏趨追鄒酋醜錐錘鎚雛騶鰍丑畜祝竺筑築縮蓄蹙蹴軸逐春椿瑃出朮黜充忠沖蟲衝衷悴膵萃贅取吹嘴娶就炊翠聚脆臭趣醉驟鷲側仄厠惻測層侈値嗤峙幟恥梔治淄熾痔痴癡稚穉緇緻置致蚩輜雉馳齒則勅飭親七柒漆侵寢枕沈浸琛砧針鍼蟄秤稱快他咤唾墮妥惰打拖朶楕舵陀馱駝倬卓啄坼度托拓擢晫柝濁濯琢琸託鐸呑嘆坦彈憚歎灘炭綻誕奪脫探眈耽貪塔搭榻宕帑湯糖蕩兌台太怠態殆汰泰笞胎苔跆邰颱宅擇澤撑攄兎吐土討慟桶洞痛筒統通堆槌腿褪退頹偸套妬投透鬪慝特闖坡婆巴把播擺杷波派爬琶破罷芭跛頗判坂板版瓣販辦鈑阪八叭捌佩唄悖敗沛浿牌狽稗覇貝彭澎烹膨愎便偏扁片篇編翩遍鞭騙貶坪平枰萍評吠嬖幣廢弊斃肺蔽閉陛佈包匍匏咆哺圃布怖抛抱捕暴泡浦疱砲胞脯苞葡蒲袍褒逋鋪飽鮑幅暴曝瀑爆輻俵剽彪慓杓標漂瓢票表豹飇飄驃品稟楓諷豊風馮彼披疲皮被避陂匹弼必泌珌畢疋筆苾馝乏逼下何厦夏廈昰河瑕荷蝦賀遐霞鰕壑學虐謔鶴寒恨悍旱汗漢澣瀚罕翰閑閒限韓割轄函含咸啣喊檻涵緘艦銜陷鹹合哈盒蛤閤闔陜亢伉姮嫦巷恒抗杭桁沆港缸肛航行降項亥偕咳垓奚孩害懈楷海瀣蟹解該諧邂駭骸劾核倖幸杏荇行享向嚮珦鄕響餉饗香噓墟虛許憲櫶獻軒歇險驗奕爀赫革俔峴弦懸晛泫炫玄玹現眩睍絃絢縣舷衒見賢鉉顯孑穴血頁嫌俠協夾峽挾浹狹脅脇莢鋏頰亨兄刑型形泂滎瀅灐炯熒珩瑩荊螢衡逈邢鎣馨兮彗惠慧暳蕙蹊醯鞋乎互呼壕壺好岵弧戶扈昊晧毫浩淏湖滸澔濠濩灝狐琥瑚瓠皓祜糊縞胡芦葫蒿虎號蝴護豪鎬頀顥惑或酷婚昏混渾琿魂忽惚笏哄弘汞泓洪烘紅虹訌鴻化和嬅樺火畵禍禾花華話譁貨靴廓擴攫確碻穫丸喚奐宦幻患換歡晥桓渙煥環紈還驩鰥活滑猾豁闊凰幌徨恍惶愰慌晃晄榥況湟滉潢煌璜皇篁簧荒蝗遑隍黃匯回廻徊恢悔懷晦會檜淮澮灰獪繪膾茴蛔誨賄劃獲宖橫鐄哮嚆孝效斅曉梟涍淆爻肴酵驍侯候厚后吼喉嗅帿後朽煦珝逅勛勳塤壎焄熏燻薰訓暈薨喧暄煊萱卉喙毁彙徽揮暉煇諱輝麾休携烋畦虧恤譎鷸兇凶匈洶胸黑昕欣炘痕吃屹紇訖欠欽歆吸恰洽翕興僖凞喜噫囍姬嬉希憙憘戱晞曦熙熹熺犧禧稀羲詰";
// ---------- EUC-KR(CP949) 글자 변환: 사이트가 euc-kr 이라 망가요미가 Latin-1 로 받은 본문을 한글로 되돌림 ----------
let KS_CACHE = null;

function ksTables() {
    if (KS_CACHE) return KS_CACHE;
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (const ch of KS_HANGUL_BITS) {
        const idx = abc.indexOf(ch);
        if (idx < 0) continue;
        value = (value << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >> bits) & 0xff);
        }
    }
    const ks = [];
    const ext = [];
    for (let i = 0; i < 11172; i++) {
        if (bytes[i >> 3] & (1 << (i & 7))) ks.push(0xac00 + i); else ext.push(0xac00 + i);
    }
    KS_CACHE = { ks, ext, rev: null };
    return KS_CACHE;
}

// CP949 확장 영역(0x81~0xC6)의 두 번째 바이트 순번 (KS X 1001 에 없는 한글 8822자가 유니코드 순서로 배치됨)
function extIndex(lead, trail) {
    let t;
    if (trail >= 0x41 && trail <= 0x5a) t = trail - 0x41;
    else if (trail >= 0x61 && trail <= 0x7a) t = trail - 0x61 + 26;
    else if (trail >= 0x81 && trail <= 0xfe) t = trail - 0x81 + 52;
    else return -1;
    if (lead >= 0x81 && lead <= 0xa0) return (lead - 0x81) * 178 + t;
    if (lead >= 0xa1 && lead <= 0xc6 && t < 84) return 32 * 178 + (lead - 0xa1) * 84 + t;
    return -1;
}

function decodeCp949Pair(lead, trail) {
    const tb = ksTables();
    if (trail >= 0xa1 && trail <= 0xfe) {
        if (lead >= 0xb0 && lead <= 0xc8) return String.fromCharCode(tb.ks[(lead - 0xb0) * 94 + trail - 0xa1]);
        let row = -1;
        if (lead >= 0xa1 && lead <= 0xac) row = lead - 0xa1;
        else if (lead >= 0xca && lead <= 0xfd) row = 12 + lead - 0xca;
        if (row >= 0) return KS_SYMBOL_ROWS[row * 94 + trail - 0xa1];
    }
    const e = extIndex(lead, trail);
    if (e >= 0 && e < tb.ext.length) return String.fromCharCode(tb.ext[e]);
    return null;
}

/** Latin-1 로 들어온 euc-kr 본문을 한글로 바꿈 (이미 한글이면 그대로) */
function fixEucKr(s) {
    s = String(s || "");
    if (/[가-힣]/.test(s) || !/[\u0081-þ]/.test(s)) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c > 0xff) return s;
        if (c >= 0x81 && c <= 0xfe && i + 1 < s.length) {
            const ch = decodeCp949Pair(c, s.charCodeAt(i + 1));
            if (ch !== null) {
                out += ch;
                i++;
                continue;
            }
        }
        out += s[i];
    }
    return out;
}

/** 검색어를 euc-kr(CP949) 로 퍼센트 인코딩 */
function encodeEucKr(text) {
    const tb = ksTables();
    if (!tb.rev) {
        const rev = {};
        tb.ks.forEach((cp, i) => { rev[cp] = [0xb0 + Math.floor(i / 94), 0xa1 + (i % 94)]; });
        for (let lead = 0x81; lead <= 0xc6; lead++) {
            for (let trail = 0x41; trail <= 0xfe; trail++) {
                const e = extIndex(lead, trail);
                if (e >= 0 && e < tb.ext.length) rev[tb.ext[e]] = [lead, trail];
            }
        }
        for (let i = 0; i < KS_SYMBOL_ROWS.length; i++) {
            const cp = KS_SYMBOL_ROWS.charCodeAt(i);
            if (cp === 0xfffd || rev[cp]) continue;
            const row = Math.floor(i / 94);
            rev[cp] = [row < 12 ? 0xa1 + row : 0xca + row - 12, 0xa1 + (i % 94)];
        }
        tb.rev = rev;
    }
    let out = "";
    for (const ch of String(text || "")) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) {
            out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : "%" + cp.toString(16).toUpperCase().padStart(2, "0");
        } else if (tb.rev[cp]) {
            out += tb.rev[cp].map((b) => "%" + b.toString(16).toUpperCase()).join("");
        }
    }
    return out;
}

// ---------- 앱 기본 User-Agent 사용 ----------
// 망가요미는 내장 웹뷰에서 Cloudflare 확인을 통과하면 쿠키와 그 웹뷰의 User-Agent 를 함께 저장하고,
// 요청에 User-Agent 가 없을 때만 그 값을 넣는다. 확장이 고정 User-Agent 를 보내면 통과 쿠키가 거부되므로
// 사이트(문서·API) 요청에서는 확장의 User-Agent 를 빼고 앱 값을 쓰게 한다. 영상·이미지 주소 요청은 그대로 둔다.
// ---------- 망가요미가 돌려준 필터에 우리 표식(param/_status)이 빠져 있어도 동작하게 ----------
// 앱은 필터를 이름·상태값만 남겨 돌려줄 수 있어서, 같은 이름의 원래 필터에서 param 을 다시 채우고 상태 줄은 뺀다.
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
    const lines = [`📡 주소: ${host}` + (autoOn === null || autoOn === undefined ? "" : ` · 자동 찾기 ${autoOn ? "켜짐" : "꺼짐"}`) + addrNoteText()];
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

const TWIN_NOTE = COMIC ? "" : "굿툰 작품이 모두 여기에도 있어요 — 회차도 같아서 한쪽이 막히면 다른 쪽에서 보세요";

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
        // 여러 화를 묶은 회차("14~18화")는 그 범위를 모두 있는 것으로 (2026-11-11, 나 혼자 소설 속 망나니)
        const m = /^\D{0,6}?(\d{1,5})(?:\.\d+)?(?:\s*[~～]\s*(\d{1,5}))?\s*(?:화|회|부|권|장|편|$|\s|\D)/.exec(String((c && c.name) || "").trim().replace(/(\d{1,5})\s*,\s*(\d{1,5})(\s*화)/g, (x, a, b, h) => (+b > +a && +b - +a <= 3 ? a + "~" + b + h : x)));
        if (!m) continue;
        const n = Number(m[1]);
        if (!(n > 0) || n > 20000) continue;
        nums[n] = true;
        const end = Number(m[2] || 0);
        if (end > n && end - n <= 50) for (let k = n + 1; k <= end; k++) nums[k] = true;
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
        // 2026-11-11: 정렬이 붙인 차례 번호("86 · 시즌2 43화")가 있으면 그 번호 먼저 (가비지타임: 43 을 읽어 "43.43. 86 · …" 로 꼬였음)
        const pos = /^\s*(\d+(?:\.\d+)?) · /.exec(core);
        if (pos) return parseFloat(pos[1]);
        const m = /(\d+(?:[.-]\d+)?)\s*(?:화|회|話)/.exec(core);
        if (m) return parseFloat(m[1].replace("-", "."));
        return read(title, core).ep;
    };
    DefaultExtension.prototype.getDetail = async function (url) {
        const d = await base.apply(this, arguments);
        const list = d && (d.episodes || d.chapters);
        if (!list || !list.length) return d;
        const title = String(d.name || "");
        // 2026-11-14: 여러 화를 묶은 회차("1~5화")가 있으면 앱이 묶음마다 "4화 누락"으로 셈(11toon 나의 히어로 아카데미아 "36화 누락됨")
        // → 그 작품만 오래된 회차부터 차례 번호 "N. " (진짜 빠진 회차는 설명 맨 위 ⚠️ 줄, 애니요미판과 같음)
        if (list.some((x) => { const m = /(\d{1,5})\s*[~～]\s*(\d{1,5})\s*화/.exec(String(x.name || "").replace(/(\d{1,5})\s*,\s*(\d{1,5})(\s*화)/g, (x, a, b, h) => (+b > +a && +b - +a <= 3 ? a + "~" + b + h : x))); return m && +m[2] > +m[1]; })) {
            for (let i = list.length - 1, n = 1; i >= 0; i--, n++) {
                const plain = String(list[i].name || "").replace(/^\s*\d+(?:\.\d+)?\.\s+/, "").replace(/^\s*\d+(?:\.\d+)? · /, "");
                list[i].name = `${n}. ${plain}`;
            }
            return d;
        }
        // 앱이 기억한 제목이 조금 달라 지워지지 않는 경우까지 보려고 제목을 지운 것·안 지운 것 둘 다 확인
        if (ok(list, title) && ok(list, "")) return d;
        // 2026-11-11: 이름 속 "Episode3"·"EP 2" 는 앱이 맨 앞 번호보다 먼저 회차 번호로 읽음(북코 난공블락 로맨스 "122화 Episode3. 수확철" 26개가 3화로 겹침)
        // → 겹칠 때만 "Episode#3" 으로 바꿔 앱이 맨 앞 "122화" 를 읽게 함
        for (const x of list) x.name = String(x.name || "").replace(/\b(folge|episode|episodio|ep\.?)(\s*)(?=\d)/gi, "$1$2#");
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
