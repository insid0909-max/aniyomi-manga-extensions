# 웹툰 확장 비교 자료

날짜별 폴더에 그날 받은 확장별 작품 목록(`확장키.tsv`)과 `요약.md`.

다시 비교하기:
```
for k in goodtoon mtoon blacktoon goraetoon toon11 toonkor wolftoon wolftoon_comic naverwebtoon; do
  node monitor/compare/crawl.js $k monitor/compare/날짜/$k.tsv &
done; wait
node monitor/compare/analyze.js monitor/compare/날짜
```
(monitor/runtime.js 가 쓰는 linkedom 이 필요: `npm i --no-save linkedom`. 큰 사이트는 3~10분, 해외에서 막힌 사이트는 못 받음. 2026-11-06 Claude 작업 환경에선 node 로 comic.naver.com 이 막혀 네이버는 python 으로 같은 주소를 받았음)
