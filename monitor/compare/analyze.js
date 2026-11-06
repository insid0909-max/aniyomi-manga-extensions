// 받은 목록(tsv)들로 겹침 표 만들기
// 사용: node monitor/compare/analyze.js <폴더>   (폴더 안 *.tsv → 요약표를 화면에 출력)
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const NAMES = { goodtoon: "굿툰", mtoon: "머니툰", blacktoon: "블랙툰", goraetoon: "고래툰", toon11: "11툰", toonkor: "툰코", wolftoon: "늑대웹툰", wolftoon_comic: "늑대만화", naverwebtoon: "네이버" };
// 제목 비교: 띄어쓰기·기호 빼고, [완전판]·[무삭제] 같은 꼬리표 뺌
const norm = (t) => t.normalize("NFC").replace(/\[(19세 ?)?완전판\]|\(완전판\)|\[무삭제\]|\[개정판\]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const T = {};
const count = {};
for (const k of Object.keys(NAMES)) {
    const f = path.join(dir, `${k}.tsv`);
    if (!fs.existsSync(f)) continue;
    const rows = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
    count[k] = rows.length;
    T[k] = new Set(rows.map((r) => norm(r[1] || "")).filter(Boolean));
}
const K = Object.keys(T);
const pct = (a, b) => Math.round((100 * [...T[a]].filter((x) => T[b].has(x)).length) / T[a].size);
console.log("| 확장 | 목록 | 제목 | 다른 데 없는 작품 |\n|---|---|---|---|");
for (const k of K) {
    const others = new Set(K.filter((o) => o !== k).flatMap((o) => [...T[o]]));
    console.log(`| ${NAMES[k]} | ${count[k]} | ${T[k].size} | ${[...T[k]].filter((x) => !others.has(x)).length} |`);
}
console.log("\n행 = 이 확장 작품 중 열 확장에도 있는 %\n\n| | " + K.map((k) => NAMES[k]).join(" | ") + " |\n|---|" + K.map(() => "---").join("|") + "|");
for (const a of K) console.log(`| ${NAMES[a]} | ` + K.map((b) => (a === b ? "-" : pct(a, b))).join(" | ") + " |");
