// 웹툰 확장 전체 작품 목록 받기 (2026-11-06 전체 비교 때 만든 것)
// 사용: node monitor/compare/crawl.js <확장키> <저장할.tsv>   (확장키: goodtoon mtoon blacktoon goraetoon toon11 toonkor wolftoon wolftoon_comic naverwebtoon)
// 결과: 한 줄에 "주소<TAB>제목". 망가요미 파일(mangayomi/*.js)을 그대로 돌려 받음 — 해외에서 막힌 사이트(뉴엑스툰 등)는 못 받음.
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..", "..");
const { loadExtension, request } = require(path.join(ROOT, "monitor", "runtime.js"));
const [key, out] = process.argv.slice(2);

// 사이트마다 "전체"를 받는 방법 (최신 목록이 일부만 주는 곳은 필터로 나눠 받음)
const T11_GENRES = ["BL", "러브코미디", "17", "판타지", "순정", "드라마", "학원", "게임", "SF", "스릴러", "먹방", "TS", "스포츠", "이세계", "추리", "일상", "라노벨", "백합", "시대", "애니화", "전생", "붕탁", "무협", "호러", "공포"];
const MT_CATES = ["판타지", "액션", "개그", "미스터리", "로맨스", "드라마", "무협", "스포츠", "일상", "학원", "성인", "BL", "SF", "시대극", "기타"];
const JOBS = {
    goodtoon: [null],                                   // 최신 목록 (사이트가 200쪽까지만 보여 줌)
    blacktoon: [null],
    wolftoon_comic: [null],
    goraetoon: [{ list: "ongoing" }, { list: "completed" }],
    wolftoon: [{ list: "/ing" }, { list: "/end" }],
    toonkor: ["웹툰", "망가", "단행본", "포토툰"].flatMap((s) => [{ section: s, list: s === "웹툰" ? "연재" : "" }, { section: s, list: "완결" }]),
    toon11: [{ list: 1 }, { list: 2 }].concat(T11_GENRES.flatMap((g) => [{ list: 1, sca: g }, { list: 2, sca: g }])), // 목록이 99쪽까지라 장르로 나눔
    mtoon: ["0", "1", "2", "3", "4", "5", "6", "7", "8"].map((w) => ({ wt_fin: "연재중", w }))
        .concat(MT_CATES.flatMap((c) => [{ wt_fin: "완결", cate: c }, { wt_fin: "연재중", cate: c }]))
};

async function naver() {
    // 네이버는 확장이 해외에서 막혀(403) 공개 자료 주소로 받음
    const H = { "User-Agent": "Mozilla/5.0", "Referer": "https://comic.naver.com/" };
    const get = async (u) => JSON.parse((await request("GET", u, H)).body);
    const M = new Map();
    const w = await get("https://comic.naver.com/api/webtoon/titlelist/weekday?order=user");
    for (const k in w.titleListMap) for (const t of w.titleListMap[k]) M.set(`/webtoon/list?titleId=${t.titleId}`, t.titleName);
    for (let p = 1; p < 500; p++) {
        const d = await get(`https://comic.naver.com/api/webtoon/titlelist/finished?page=${p}&order=UPDATE`);
        for (const t of d.titleList) M.set(`/webtoon/list?titleId=${t.titleId}`, t.titleName);
        if (!d.titleList.length || p >= ((d.pageInfo || {}).totalPages || p)) break;
    }
    return M;
}

async function crawl() {
    const e = loadExtension(path.join(ROOT, "mangayomi", `${key}.js`), {}).ext;
    e.warmCovers = async () => {}; // 표지 미리 받기는 비교에 필요 없음
    const M = new Map();
    for (const job of JOBS[key]) {
        let fn;
        if (key === "mtoon" && job) fn = (p) => e.listPage(e.listUrl(job, p));
        else if (!job) fn = (p) => (e.baseLatest || e.getLatestUpdates).call(e, p);
        else {
            const fl = JSON.parse(JSON.stringify(e.getFilterList()));
            for (const x of fl) {
                if (x.type_name !== "SelectFilter" || !(x.param in job)) continue;
                const v = job[x.param];
                const i = typeof v === "number" ? v : x.values.findIndex((o) => o.value === v);
                if (i < 0) throw new Error(`필터 값 없음 ${x.param}=${v}`);
                x.state = i;
            }
            fn = (p) => (e.baseSearch || e.search).call(e, "", p, fl);
        }
        let bad = 0;
        for (let p = 1; p <= 1500; p++) {
            let r;
            try {
                r = await Promise.race([fn(p), new Promise((_, j) => setTimeout(() => j(new Error("40초 넘음")), 40000))]);
            } catch (x) {
                console.log("오류", JSON.stringify(job), p, String(x.message).slice(0, 80));
                if (++bad > 2) break;
                continue;
            }
            const before = M.size;
            r.list.forEach((x) => M.set(x.link, x.name));
            if (!r.hasNextPage || !r.list.length) break;
            bad = M.size === before ? bad + 1 : 0;
            if (bad > 2) break;
        }
        console.log("끝", JSON.stringify(job), M.size);
    }
    return M;
}

(async () => {
    const M = key === "naverwebtoon" ? await naver() : await crawl();
    fs.writeFileSync(out, [...M].map(([l, t]) => `${l}\t${String(t).replace(/[\t\n]/g, " ")}`).join("\n") + "\n");
    console.log("저장", key, M.size);
    process.exit(0);
})();
