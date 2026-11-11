// 회차 검사 도구 (2026-11-11, 사용자 "검사도구 넣고 돌려봐")
//
// 확장을 고치기 전·후에 돌려서 회차 번호가 꼬이지 않았는지 확인한다.
//   node monitor/chapcheck/chapcheck.js [확장이름...] [--n 30] [--save] [--file 확장=경로]
//   예) node monitor/chapcheck/chapcheck.js mtoon --n 120 --save
//       node monitor/chapcheck/chapcheck.js            (mangayomi/*.js 전부, 작품 30개씩)
// 필요: npm install --no-save linkedom@0.18 (monitor/runtime.js 와 같음)
//
// 검사하는 것 (망가요미 앱의 회차 번호 읽기 lib/utils/chapter_recognition.dart 를 그대로 옮긴 recog.js 로):
//   ① 겹침   : 앱이 같은 번호로 읽어 하나만 남기는 회차 (가장 큰 문제 — 회차가 사라져 보임)
//   ② 번호없음: 앱이 번호를 못 읽는 회차 (앱 경고)
//   ③ 임시번호: 확장이 번호를 못 읽어 붙인 소수점 번호 "55.5 · …" (후기·외전·공지는 정상)
//   ④ 빠짐   : 1 ~ 최대 번호 사이에 없는 정수 번호 (사이트에 진짜 없을 수도 있음)
//   ⑥ 제목남음: 회차 이름 앞에 작품 제목이 그대로 남은 회차 (제목 표기 차이로 못 뺀 것 — 2026-11-11 늑대닷컴 "…결심한다." ↔ "…결심한다 115화")
//   ⑦ 빠짐표시: 확장이 설명에 적은 "빠진 회차" 중 실제로는 목록에 있는 번호 (설명이 틀림)
//   ⑧ 번호덧붙임: 확장이 번호를 못 읽어 이름 앞에 "115. " 를 붙인 회차 (겹침 막기 — 대부분 이름 정리가 덜 된 신호)
//   ⑤ 바뀜   : --save 로 저장해 둔 지난 결과(snapshots/확장.json)와 회차 이름이 달라진 작품 (받아 둔 회차가 안 받은 것처럼 보이게 됨)
//
// 머니툰(mtoon)은 작품 화면을 웹뷰로 읽어 여기서 getDetail 을 못 돌림 → 사이트 목록(more.php)·작품 화면(list.php)을
// 직접 받아 확장의 회차 정리 코드(mtOrderChapters)에 넣어 검사한다.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadExtension, request } = require("../runtime.js");
const R = require("./recog.js");

const ROOT = path.join(__dirname, "..", "..");
const SNAP = path.join(__dirname, "snapshots");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt("--n", 30)) || 30;
const SAVE = args.includes("--save");
const names = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--n", "--file"].includes(args[i - 1])));
const EXTRA = /외전|번외|특별|후기|에필로그|프롤로그|공지|휴재|예고|요약|총집|안내|이벤트|QnA|Q&A|시즌\s*\d*\s*(?:완결|종료)|지난 이야기/i;
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`${what} ${ms / 1000}초 넘음`)), ms))]);

const plainTxt = (v) => String(v || "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
function analyse(title, chapters, description) {
    const seen = {};
    const dup = [];
    const none = [];
    const temp = [];
    const titled = [];
    const prefixed = [];
    const ints = new Set();
    const pt = plainTxt(title);
    for (const c of chapters) {
        const name = String(c.name || "");
        if (/^\d+(?:\.\d+)?\. /.test(name)) prefixed.push(name);
        const body = name.replace(/^\d+(?:\.\d+)?(?:\.| ·) /, "");
        if (pt.length >= 2 && plainTxt(body).startsWith(pt) && plainTxt(body).length > pt.length) titled.push(name);
        if (/^\d+\.\d+ · /.test(name) && !EXTRA.test(name)) temp.push(name); // 머니툰식 "55.5 · …" (다른 확장의 "534 · 485화" 는 원래 차례 번호라 뺌)
        const k = R.key(title, name, c.scanlator);
        if (k === null) { if (!EXTRA.test(name)) none.push(name); continue; }
        if (seen[k]) dup.push(`${seen[k]} = ${name}`);
        else seen[k] = name;
        const n = Number(k.split("::")[1]);
        if (Number.isInteger(n)) ints.add(n);
    }
    const max = Math.max(0, ...ints);
    const gaps = [];
    for (let i = 1; i <= max && max - ints.size < 200; i++) if (!ints.has(i)) gaps.push(i);
    // 확장이 설명에 적은 "빠진 회차: 108화, 109화 …" 중 목록 이름에 그 번호 "N화" 가 실제로 있는 것
    const wrongMissing = [];
    const ml = /빠진 회차[^:：]*[:：]\s*([^\n(]*)/.exec(String(description || ""));
    if (ml) for (const m of ml[1].matchAll(/(\d+(?:\.\d+)?)\s*화/g)) {
        const re = new RegExp(`(?:^|[^\\d.])${m[1].replace(".", "\\.")}\\s*화`);
        if (chapters.some((c) => re.test(String(c.name || "").replace(/ · (?:남은 \d+화|마지막)$/, "")))) wrongMissing.push(m[1] + "화");
    }
    return { n: chapters.length, dup, none, temp, gaps, titled, prefixed, wrongMissing };
}

// ---------- 머니툰: 사이트를 직접 받아 확장의 회차 정리 코드로 ----------
async function mtoonWorks(file) {
    // 웹뷰로 작품 화면을 읽는 mtRead07 만 "사이트에서 직접 받은 회차"로 바꿔 끼우고 나머지(회차 정리·번호 겹침 막기)는 확장 그대로 돌림
    const src = fs.readFileSync(file, "utf8") + "\nconst __CC = {}; DefaultExtension.prototype.__put = (u, d) => { __CC[u] = d; }; DefaultExtension.prototype.__base = mtBase11;\nmtRead07 = async function (url) { const d = __CC[url]; if (!d) throw new Error('검사 자료 없음'); return JSON.parse(JSON.stringify(d)); };\n";
    const tmp = path.join(os.tmpdir(), "chapcheck-mtoon.js");
    fs.writeFileSync(tmp, src);
    const ext = loadExtension(tmp, {}).ext;
    const listed = JSON.parse(fs.readFileSync(path.join(ROOT, "domains.json"), "utf8")).domains.mtoon.baseUrl;
    const base = String(listed || ext.__base()).replace(/\/+$/, "");
    const get = async (u, xhr) => {
        const r = await request("GET", u, Object.assign({ "User-Agent": UA, Referer: base + "/" }, xhr ? { "X-Requested-With": "XMLHttpRequest" } : {}));
        if (r.statusCode !== 200) throw new Error(`HTTP ${r.statusCode} ${u}`);
        return String(r.body || "");
    };
    const ids = new Map();
    const fin = ["연재중", "완결"];
    for (let c = 0; ids.size < N && c < 600; c += 30) {
        for (const f of fin) {
            const rows = JSON.parse(await get(`${base}/more.php?wt_fin=${encodeURIComponent(f)}&w=8&c=${c}`, true));
            for (const x of rows) if (ids.size < N) ids.set(String(x.wt_idx), String(x.wt_title));
        }
    }
    const out = [];
    for (const [id, title] of ids) {
        const link = `${base}/list.php?i=${id}`;
        try {
            const s = await get(link);
            const i = s.indexOf('<div class="list_data pc_w">');
            const body = s.slice(i, s.indexOf("</ul>", i));
            const re = /detail\.php\?wi=(\d+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;
            const ch = [];
            let m;
            while ((m = re.exec(body))) ch.push({ name: m[2].replace(/\s+/g, " ").trim(), url: `/detail.php?wi=${m[1]}`, dateUpload: "0" });
            ext.__put(link, { name: title, imageUrl: "", description: "", author: "", status: 5, genre: [], chapters: ch });
            const d = await ext.getDetail(link);
            out.push({ id, title, link, chapters: d.chapters || [], description: d.description || "" });
        } catch (e) {
            out.push({ id, title, link, err: String(e.message || e).slice(0, 120) });
        }
    }
    return out;
}

// ---------- 그 밖의 확장: 인기·최신 목록 → getDetail ----------
async function genericWorks(file) {
    const ext = loadExtension(file, {}).ext;
    if (ext.warmCovers) ext.warmCovers = async () => {};
    const works = new Map();
    for (const fn of ["getPopular", "getLatestUpdates"]) {
        for (let page = 1; page <= 3 && works.size < N; page++) {
            try {
                const r = await timeout(ext[fn](page), 40000, fn);
                for (const x of (r && r.list) || []) if (works.size < N && x.link && !works.has(x.link)) works.set(x.link, x.name);
                if (!r || !r.hasNextPage) break;
            } catch (e) {
                if (!works.size) throw new Error(`${fn}: ${String(e.message || e).slice(0, 100)}`);
                break;
            }
        }
    }
    const out = [];
    for (const [link, listTitle] of works) {
        try {
            const d = await timeout(ext.getDetail(link), 40000, "작품");
            out.push({ id: link, title: (d && d.name) || listTitle, link, chapters: (d && (d.chapters || d.episodes)) || [], description: (d && d.description) || "" });
        } catch (e) {
            out.push({ id: link, title: listTitle, link, err: String(e.message || e).slice(0, 120) });
        }
        await new Promise((s) => setTimeout(s, 200));
    }
    return out;
}

async function run(key) {
    // --file 확장=경로 : 고치기 전 파일 등 다른 파일로 검사 (예: --file wolftoon=/tmp/wolftoon_old.js)
    const alt = args.map((a, i) => (args[i - 1] === "--file" ? a : "")).find((a) => a.startsWith(key + "="));
    const file = alt ? alt.slice(key.length + 1) : path.join(ROOT, "mangayomi", key + ".js");
    const t0 = Date.now();
    let works;
    try {
        works = key === "mtoon" ? await mtoonWorks(file) : await genericWorks(file);
    } catch (e) {
        console.log(`\n■ ${key}: 목록을 못 받음 — ${String(e.message || e).slice(0, 140)}`);
        return { key, err: true };
    }
    const snapFile = path.join(SNAP, key + ".json");
    const old = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, "utf8")) : null;
    const snap = {};
    const sum = { works: 0, err: 0, dup: 0, none: 0, temp: 0, gapWorks: 0, changed: 0, titled: 0, wrong: 0, prefixed: 0 };
    const lines = [];
    for (const w of works) {
        if (w.err) { sum.err++; lines.push(`  ✗ ${w.title} — ${w.err}`); continue; }
        sum.works++;
        const a = analyse(w.title, w.chapters, w.description);
        snap[w.id] = { title: w.title, names: w.chapters.map((c) => c.name) };
        const bad = [];
        if (a.dup.length) { sum.dup++; bad.push(`겹침 ${a.dup.length} (${a.dup.slice(0, 2).join(" / ")})`); }
        if (a.none.length) { sum.none++; bad.push(`번호없음 ${a.none.length} (${a.none.slice(0, 2).join(" / ")})`); }
        if (a.temp.length) { sum.temp++; bad.push(`임시번호 ${a.temp.length} (${a.temp.slice(0, 2).join(" / ")})`); }
        if (a.titled.length) { sum.titled++; bad.push(`제목남음 ${a.titled.length} (${a.titled.slice(0, 2).join(" / ")})`); }
        if (a.wrongMissing.length) { sum.wrong++; bad.push(`빠짐표시 틀림 ${a.wrongMissing.length} (${a.wrongMissing.slice(0, 6).join(",")} — 목록에 있음)`); }
        if (a.prefixed.length) { sum.prefixed++; bad.push(`번호덧붙임 ${a.prefixed.length} (${a.prefixed.slice(0, 2).join(" / ")})`); }
        if (a.gaps.length) { sum.gapWorks++; bad.push(`빠짐 ${a.gaps.length} (${a.gaps.slice(0, 6).join(",")}${a.gaps.length > 6 ? "…" : ""})`); }
        const before = old && old.works && old.works[w.id];
        if (before) {
            const nowSet = new Set(snap[w.id].names);
            const changed = before.names.filter((x) => !nowSet.has(x));
            if (changed.length) {
                sum.changed++;
                const added = snap[w.id].names.filter((x) => !before.names.includes(x));
                bad.push(`바뀜 ${changed.length} (${changed[0]} → ${added[0] || "없어짐"})`);
            }
        }
        if (bad.length) lines.push(`  · ${w.title} [${w.chapters.length}화] ${bad.join(" | ")}`);
    }
    console.log(`\n■ ${key}: 작품 ${sum.works}개 (못 읽음 ${sum.err}) · 겹침 ${sum.dup} · 번호없음 ${sum.none} · 임시번호 ${sum.temp} · 빠짐 있는 작품 ${sum.gapWorks}` + (old ? ` · 지난번보다 이름 바뀐 작품 ${sum.changed}` : " · (저장된 지난 결과 없음)") + ` · 제목남음 ${sum.titled} · 빠짐표시 틀림 ${sum.wrong} · 번호덧붙임 ${sum.prefixed} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    for (const l of lines) console.log(l);
    if (SAVE) {
        fs.mkdirSync(SNAP, { recursive: true });
        fs.writeFileSync(snapFile, JSON.stringify({ at: new Date().toISOString().slice(0, 10), works: snap }, null, 1) + "\n");
    }
    return Object.assign({ key }, sum);
}

(async () => {
    const all = fs.readdirSync(path.join(ROOT, "mangayomi")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
    const keys = names.length ? names : all;
    const res = [];
    for (const k of keys) res.push(await run(k));
    console.log("\n=== 요약 ===");
    for (const r of res) console.log(r.err ? `${r.key}: 목록 못 받음` : `${r.key}: 작품 ${r.works} · 겹침 ${r.dup} · 번호없음 ${r.none} · 임시번호 ${r.temp} · 빠짐 ${r.gapWorks} · 바뀜 ${r.changed} · 제목남음 ${r.titled} · 빠짐표시 틀림 ${r.wrong} · 번호덧붙임 ${r.prefixed}`);
    process.exit(0);
})();
