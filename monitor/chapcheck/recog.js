// 망가요미 lib/utils/chapter_recognition.dart (rawSeasonAndNumber) 를 그대로 옮긴 것
const unwanted = /\b(?:v|ver|vol|version|volume|season|staffel|saison|temporada|s|t)[^a-z]?[0-9]+/g;
const unwantedWS = /\s(?=extra|special|omake)/g;
const seasonKw = /\b(?:staffel|season|saison|temporada|s|t)\s*([0-9]+)/;
const epKw = /\b(?:folge|episode|episodio|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/;
const chNot = /(?<=ch\.) *([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
const bare = /([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
function dec(d, a) {
  if (d) return parseFloat(d);
  if (a) { if (a.includes('extra')) return 0.99; if (a.includes('omake')) return 0.98; if (a.includes('special')) return 0.97;
    const t = a.replace('.', ''); if (t.length === 1) { const n = t.charCodeAt(0) - 96; return n >= 10 ? 0 : n / 10; } }
  return 0;
}
function raw(title, ch) {
  const name = String(ch).toLowerCase().split(String(title).toLowerCase()).join('').trim().replace(/,/g, '.').replace(/-/g, '.').replace(unwantedWS, '');
  const sm = seasonKw.exec(name); const season = sm ? parseInt(sm[1], 10) : 0;
  const em = epKw.exec(name); if (em) return [season, parseFloat(em[1])];
  const st = name.replace(unwanted, '');
  const m = chNot.exec(st) || bare.exec(st);
  return [season, m ? parseFloat(m[1]) + dec(m[2], m[3]) : null];
}
module.exports = { raw, key: (t, c, s) => { const [se, ep] = raw(t, c); return ep == null || ep <= 0 ? null : `${se}::${ep}::${s || ''}`; } };
