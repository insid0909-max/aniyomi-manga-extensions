const mangayomiSources = [{
    "id": 870214001,
    "name": "newxtoon 웹툰",
    "lang": "ko",
    "baseUrl": "https://newxtoon3.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.3.40",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "newxtoon.js"
}];

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const AUTO_HOST = /^(www\.)?newxtoon\d*\.com$/;
const AUTO_NUM = /newxtoon(\d+)/;
const AUTO_PROBE = "/";
const AUTO_MARKER = "뉴엑스툰";
// 최신 접속 주소 안내 페이지 (뉴엑스툰.com)
const AUTO_GUIDE = "https://xn--vg1b002axlc8ts.com/";

// newxtoon 웹툰 - Aniyomi 확장(NewXtoon.kt)과 같은 구조를 망가요미용으로 옮김
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
    // 회차 목록 묶음(/comics/{id}/chapters?page=N)은 간격 없이 동시에 받음 (17개 동시 요청도 모두 정상)
    if (/^\/comics\/\d+\/chapters$/.test(m[2])) return;
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
    const keyOf = (c, i, arr) => {
        // 이름 맨 앞 사이트 순번 ("0001 - 별을 품은 소드마스터 1화") 은 비교에서 뺌
        const name = String(c.name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "");
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

// 회차 이름 끝에 남은 화 수를 붙임 ("112화 · 남은 26화", 마지막 화는 "112화 · 마지막"). list: 최신 → 과거
// 읽는 화면 제목이 잘리지 않게 사이트 순번("0112 - ")과 맨 앞 작품 제목은 뺌. 설정 "회차 이름에 남은 화 표시"로 끌 수 있음
// 회차 이름의 숫자가 사이트 순서(과거 → 최신)대로 자꾸 줄거나 겹치면 이름 번호를 믿을 수 없는 작품
// ("제40장. … (1)·(2)·(3)" 과 "290화" 가 섞인 나노마신 등). list: 사이트 순서 (최신 → 과거)
function siteIndexNeeded(list, title) {
    if (!list || list.length < 10) return false;
    const t = String(title || "").trim();
    let prev = -Infinity, breaks = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        let n = String(list[i].name || "").trim().replace(/^\d{2,}(?:\s+[-–.:)\]]|[-–.:)\]]\s)\s*/, "");
        if (t && n.startsWith(t)) n = n.substring(t.length);
        const m = /\d+/.exec(n);
        if (!m) continue;
        const v = parseInt(m[0], 10);
        if (v <= prev) breaks++;
        prev = v;
    }
    return breaks >= Math.max(3, Math.floor(list.length / 20));
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
const ADDR_MARK = AUTO_MARKER;
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
        // 설치 중 등 설정을 읽을 수 없을 때는 기본 주소
        try {
            const prefs = new SharedPreferences();
            const manual = this.cleanUrl(prefs.get("domain"));
            const auto = this.cleanUrl(prefs.getString("auto_domain", ""));
            const n = (u) => { const x = /(\d+)(?!.*\d)/.exec(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\.[a-z]{2,6}$/i, "")); return x ? parseInt(x[1], 10) : 0; };
            if (manual) {
                // 직접 넣은 주소는 바로 씀. 단 자동 찾기로 그보다 번호가 큰 진짜 사이트 주소가 확인되면
                // (끊겨서 찾았거나 사이트 화면·안내에 새 주소가 적힌 경우) 그 주소로 바꾸고 설정 칸도 고침
                if (auto && auto !== manual && n(auto) > n(manual) && this.autoOn()) {
                    prefs.setString("domain", auto);
                    return auto;
                }
                return manual;
            }
            // 자동으로 찾은 주소가 확장 업데이트로 바뀐 기본 주소보다 옛 번호면 기본 주소를 씀
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
            if (ours && res.statusCode === 403 && base !== this.source.baseUrl && !this.cleanUrl(new SharedPreferences().get("domain"))) {
                new SharedPreferences().setString("auto_domain", "");
                const fb = this.source.baseUrl;
                const h = {};
                for (const k in headers || {}) h[k] = String(headers[k]).split(base).join(fb);
                const r2 = (post ? await this.client.post(fb + url.substring(base.length), h, body) : await this.client.get(fb + url.substring(base.length), h));
                if (r2.statusCode < 400) return r2;
            }
            if (ours && !post && res.statusCode === 200) notice = await noticeTarget(this, res.body, base, "/comics/");
            // 정상 화면에 적힌 더 새 주소(사이트가 새 주소로 넘겨 준 경우 포함)를 자동 주소로 기억
            if (ours && !post && !notice && res.statusCode === 200) {
                const self = await selfTarget(this, res.body, base, "/comics/");
                if (self) new SharedPreferences().setString("auto_domain", self);
            }
            if (!notice && (!ours || !(res.statusCode >= 500))) return res;
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
        for (let i = 1; i <= 40; i++) out.push(`https://newxtoon${i}.com`);
        return out;
    }

    /** 최신 접속 주소 안내 페이지(뉴엑스툰.com)에 적힌 주소 중 번호가 큰 것부터, 진짜 사이트면 사용 */
    async autoGuide(current) {
        let text = "";
        try {
            const r = await this.client.get(AUTO_GUIDE, {});
            text = String(r.body || "");
        } catch (e) {
            return null;
        }
        const num = u => parseInt((u.match(AUTO_NUM) || [0, "0"])[1], 10) || 0;
        const hosts = [...new Set((text.match(/newxtoon\d+\.com/gi) || []).map(h => "https://" + h.toLowerCase()))]
            .filter(h => h !== current).sort((a, b) => num(b) - num(a));
        for (const h of hosts) {
            try {
                const r = await this.client.get(h + AUTO_PROBE, { "Referer": h + "/" });
                if (r.statusCode === 200 && String(r.body || "").toLowerCase().includes(AUTO_MARKER)) return h;
            } catch (e) {
                // 다음 주소
            }
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

    path(u) {
        return (u || "").replace(/^https?:\/\/[^/]+/, "").split("#")[0];
    }

    async get(url, headers) {
        const res = await this.req(url, headers || this.hdr(url));
        return res.body;
    }

    // ---------- 목록 ----------
    listUrl(page, params) {
        const q = [];
        for (const k in params) if (params[k]) q.push(`${k}=${encodeURIComponent(params[k])}`);
        if (page > 1) q.push(`page=${page}`);
        return `${this.base}/comics` + (q.length ? "?" + q.join("&") : "");
    }

    parseList(html, page) {
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a[href]")) {
            const p = this.path(a.attr("href")).split("?")[0];
            if (!/^\/comics\/\d+$/.test(p) || seen[p]) continue;
            let img = null;
            for (const i of a.select("img")) {
                const s = i.attr("src") || "";
                if (s && s.indexOf("/platforms/logos/") < 0 && !s.endsWith(".svg")) { img = i; break; }
            }
            let name = (img ? (img.attr("alt") || "") : "").replace(/ 표지$/, "").trim();
            if (!name) {
                const label = a.attr("aria-label") || "";
                name = label.lastIndexOf(", ") > 0 ? label.substring(0, label.lastIndexOf(", ")) : label;
            }
            if (!name) name = a.text.trim();
            if (!name) continue;
            seen[p] = true;
            list.push({ name, imageUrl: img ? this.abs(img.attr("src") || img.attr("data-src")) : "", link: p });
        }
        let maxPage = 0;
        for (const a of doc.select("a[href*='page=']")) {
            const m = (a.attr("href") || "").match(/[?&]page=(\d+)/);
            if (m) maxPage = Math.max(maxPage, parseInt(m[1]));
        }
        const hasNextPage = list.length > 0 && (doc.selectFirst("a[rel=next]") != null || maxPage > page);
        return { list, hasNextPage };
    }

    async basePopular(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "popular" })), page);
    }

    async baseLatest(page) {
        return this.parseList(await this.get(this.listUrl(page, { sort: "latest" })), page);
    }

    async baseSearch(query, page, filters) {
        if (query && query.trim()) {
            let url = `${this.base}/search?q=${encodeURIComponent(query.trim())}`;
            if (page > 1) url += `&page=${page}`;
            return this.parseList(await this.get(url), page);
        }
        const params = {};
        for (const f of filters || []) {
            if (f.type_name === "SelectFilter" && f.param) params[f.param] = f.values[f.state].value;
        }
        return this.parseList(await this.get(this.listUrl(page, params)), page);
    }

    // ---------- 상세 + 회차 ----------
    parseDate(s) {
        const m = (s || "").match(/(\d{4})\.(\d{2})\.(\d{2})/);
        if (!m) return null;
        return String(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`).valueOf());
    }

    async getDetail(url) {
        const pageUrl = this.abs(url);
        const html = await this.get(pageUrl);
        const doc = new Document(html);
        const h1 = doc.selectFirst("h1#comic-title") || doc.selectFirst("h1");
        const strongs = doc.select("strong").map(e => e.text.trim());
        let status = 5;
        if (strongs.some(t => t === "완결")) status = 1;
        else if (strongs.some(t => t.startsWith("연재"))) status = 0;
        const genre = [];
        for (const a of doc.select("a[href*='category=']")) {
            const t = a.text.trim();
            if (t && genre.indexOf(t) < 0) genre.push(t);
        }

        const comicId = (this.path(url).match(/\/comics\/(\d+)/) || [])[1];
        const chapters = [];
        const seen = {};
        const add = (id, title, date) => {
            if (!id || seen[id]) return;
            seen[id] = true;
            chapters.push({ name: title || id, url: `/comics/${comicId}/chapters/${id}`, dateUpload: this.parseDate(date) });
        };
        // 1) 페이지에 들어있는 첫 묶음
        for (const row of doc.select("a.chapter-item[data-chapter-id]")) {
            const d = (row.text.match(/\d{4}\.\d{2}\.\d{2}/) || [""])[0];
            add(row.attr("data-chapter-id"), (row.selectFirst("span.truncate")?.text || "").trim(), d);
        }
        // 2) 나머지는 JSON 더보기 API (/comics/{id}/chapters?page=N)
        const nextAttr = doc.selectFirst("[data-chapter-next-page]")?.attr("data-chapter-next-page");
        let page = parseInt(nextAttr) || (chapters.length ? 2 : 1);
        const headers = {
            "Referer": pageUrl,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        };
        const fetchPage = async p => {
            try {
                return JSON.parse(await this.get(`${this.base}/comics/${comicId}/chapters?page=${p}`, headers));
            } catch (e) {
                return null;
            }
        };
        // 총 회차 수를 알면 남은 쪽을 6개씩 동시에 받음
        const plain = html.replace(/<[^>]+>/g, " ");
        const total = parseInt(((plain.match(/총\s*([\d,]+)\s*화/) || [])[1] || "").replace(/,/g, ""), 10);
        const size = parseInt(doc.selectFirst("[data-chapter-page-size]")?.attr("data-chapter-page-size"), 10) || 20;
        if (comicId && total > chapters.length) {
            const last = Math.ceil(total / size);
            for (let p = page; p <= last; p += 6) {
                const batch = [];
                for (let q = p; q < p + 6 && q <= last; q++) batch.push(fetchPage(q));
                for (const json of await Promise.all(batch)) {
                    for (const o of (json && json.chapters) || []) add(String(o.id), o.title, o.date);
                }
            }
            page = last + 1;
        }
        // 총 회차 수를 모르거나 덜 받은 경우: 순서대로 이어서
        for (let guard = 0; comicId && !(total > 0 && chapters.length >= total) && guard < 300; guard++) {
            let json;
            try {
                json = JSON.parse(await this.get(`${this.base}/comics/${comicId}/chapters?page=${page}`, headers));
            } catch (e) {
                break;
            }
            for (const o of json.chapters || []) add(String(o.id), o.title, o.date);
            if (!json.has_more) break;
            page = json.next_page > page ? json.next_page : page + 1;
        }

        return {
            name: h1 ? h1.text.trim() : "",
            imageUrl: doc.selectFirst("meta[property='og:image']")?.attr("content") || "",
            description: (doc.selectFirst("[data-comic-description]")?.text || "").trim(),
            author: (doc.selectFirst("a[href*='/search?q=']")?.text || "").trim(),
            genre,
            status,
            chapters: siteIndexNeeded(chapters, h1 ? h1.text.trim() : "")
                // 이름 번호가 뒤엉킨 작품(나노마신 등)은 사이트 순서 그대로, 이름 앞에 사이트 일련번호 ("107. 제40장. …")
                ? chapterPosition(chapters, h1 ? h1.text.trim() : "").map((c, i, a) => Object.assign({}, c, { name: `${a.length - i}. ${c.name}` }))
                : chapterPosition(orderChapters(chapters, h1 ? h1.text.trim() : "", true), h1 ? h1.text.trim() : "")
        };
    }

    // ---------- 이미지 ----------
    async getPageList(url) {
        const doc = new Document(await this.get(this.abs(url)));
        const urls = [];
        for (const img of doc.select("[data-reader-page] img")) {
            if (!(img.className || "").includes("reader-page") && !img.attr("data-reader-image")) continue;
            const u = this.abs(img.attr("src") || img.attr("data-src"));
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        if (!urls.length) throw new Error("이미지를 찾을 수 없습니다 (사이트 구조 변경 또는 접근 제한)");
        return urls.map(u => ({ url: u, headers: { "Referer": this.base + "/", "User-Agent": MOBILE_UA } }));
    }

    baseFilterList() {
        const sel = (name, param, pairs) => ({
            type_name: "SelectFilter", name, param, state: 0,
            values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] }))
        });
        return [
            { type_name: "HeaderFilter", name: "검색어를 입력하면 필터는 무시됩니다" },
            sel("분류", "category", [["전체", ""], ["일반만화", "일반만화"], ["BL·GL", "BL·GL"], ["성인만화", "성인"]]),
            sel("요일", "weekday", [["전체", ""], ["월", "월"], ["화", "화"], ["수", "수"], ["목", "목"], ["금", "금"], ["토", "토"], ["일", "일"]]),
            sel("장르", "genre", [["전체", ""], ["로맨스", "1"], ["드라마", "4"], ["판타지", "2"], ["로맨스판타지", "2739"], ["성장물", "2753"], ["액션", "3"], ["개그/코미디", "6"], ["무협/사극", "2743"], ["성인", "2782"], ["고수위", "2783"], ["학원/캠퍼스", "2745"], ["BL", "2788"]]),
            sel("연재 상태", "status", [["전체", ""], ["연재중", "연재중"], ["완결", "완결"]]),
            sel("플랫폼", "platform", [["전체", ""], ["카카오페이지", "kakao-page"], ["네이버", "naver"], ["레진코믹스", "lezhin"], ["리디", "ridi"], ["탑툰", "toptoon"], ["봄툰", "bomtoon"], ["미스터블루", "mrblue"], ["투믹스", "toomics"]]),
            sel("정렬", "sort", [["최신순", "latest"], ["인기순", "popular"]])
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
        const byUrl = await openByUrl(this, query, (p) => { const m = /^\/comics\/(\d+)/.exec(p); return m ? `/comics/${m[1]}` : null; });
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
            { type_name: "HeaderFilter", name: `현재 Popular: ${this.tabDescribe(TAB_KEY_POPULAR, base, "기본값 (사이트 인기 목록)")}` },
            { type_name: "HeaderFilter", name: `현재 Latest: ${this.tabDescribe(TAB_KEY_LATEST, base, "기본값 (사이트 최신 목록)")}` },
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
        return statusFilters("newxtoon", this.statusBase(), this.statusAuto()).concat(this.tabFilterList());
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
                summary: "비워두면 자동으로 찾은 주소 사용. 직접 넣으면 바로 그 주소를 쓰고, 더 새 주소가 확인되면 자동으로 바뀜 (예: https://newxtoon2.com)",
                value: "",
                dialogTitle: "도메인 주소",
                dialogMessage: "비워두면 자동"
            }
        }, {
            key: "auto_on",
            switchPreferenceCompat: {
                title: "도메인 자동 찾기",
                summary: "접속이 안 되면 newxtoon1~40.com 중 열리는 주소로 자동 변경",
                value: true
            }
        }];
    }
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

function notesFilters(key) {
    let list = [];
    try {
        list = (JSON.parse(new SharedPreferences().getString("notes_json", "") || "{}").items || {})[key] || [];
    } catch (e) {
        list = [];
    }
    return list.filter((n) => n && n.t).slice(0, 3)
        .map((n) => ({ type_name: "HeaderFilter", name: `📝 ${String(n.d || "").substring(5).replace("-", ".")} ${n.t}`, _status: true }));
}
