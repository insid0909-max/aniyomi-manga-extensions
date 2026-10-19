# 작업 규칙 (Claude용)

- 사용자는 한국어로 대화하며 개발자가 아님. 답변은 한국어로, 쉽게.
- 사이트의 봇 차단·광고 확인·캡차·암호화·복사 방지를 우회하는 기능은 만들지 않음. 사이트를 직접 찾아 추가하지 않음.
- 개인정보: 기록(커밋)에 사용자 지메일을 넣지 않음. git config user.name "insid0909-max", user.email "266083559+insid0909-max@users.noreply.github.com" (세션마다 다시 설정). 합친 사람(committer) 칸은 깃허브가 계정 설정으로 정함 → 사용자가 깃허브 "Keep my email addresses private" 를 켬(2026-10-19). 합친 뒤 `git log -1 --format="%ae %ce" origin/기본가지` 로 지메일 없는지 확인.
- monitor 워크플로의 도메인 변경 자동 커밋은 허용됨.

## 새 확장앱(망가·웹툰·소설) 체크리스트 — 요청 없어도 기본 적용

사용자가 "빠진 기능"을 매번 말하지 않도록, 새 소스는 기존 앱(NewXtoon·Toon11·Blacktoon·Bookkor·Goodtoon·Jjaptoon·Wolftoon)과 같은 기능을 처음부터 넣는다.

### Aniyomi/Tachiyomi (Kotlin, src/main/kotlin/eu/kanade/tachiyomi/extension/ko/newxtoon)
- `SiteTools`: `SiteRateLimit`(이미지 요청 제외), 주소 붙여넣기 열기(UrlOpen)
- 도메인: 기본 도메인 + 설정 직접 입력 + 자동 찾기 스위치 + 자동 찾기, User-Agent 설정
- `ExtStatus`: 필터 맨 위 상태(도메인·최근 확인 시각) 표시, monitor/config.json에 사이트 등록
- `TabRules`: 인기/최신 탭을 필터 조합으로 지정
- 필터: 사이트의 원래 분류·정렬·장르 전부, 목록 카드/회차 날짜 표시
- 회차: 겹치지 않는 번호, 날짜(dateUpload)
- CI androidx stub 제약: `Preference(ctx)`/`isSelectable` 사용 금지
- 버전 올리기, ktlint 통과

### Mangayomi (mangayomi/*.js)
- 위 기능 동일 적용(도메인 자동 찾기, 필터, 날짜)
- 회차 이름은 회차 번호로 시작, `select().length` 사용(selectFirst는 비어도 truthy)
- 버전 올리기(인덱스 포함), `node --check` 통과

## 회차 정렬·번호 규칙 (사용자가 겪은 사례로 정한 것 — 바꾸지 말고 새 소스에도 적용)

공통 코드: Kotlin `SiteTools.kt`의 `ChapterOrder`·`SiteIndex`·`ChapterPosition`, JS는 각 파일의 `orderChapters`·`chapterPosition`(8개 파일 똑같이 유지).
고칠 때는 실제 사이트 회차 이름으로 Kotlin·JS 둘 다 테스트하고, 아래 사례가 계속 맞는지 확인.

1. 본편 = 회차가 가장 많은 묶음 → 맨 앞, 그다음 번호 없는 특별편, 다른 묶음, 번외, 외전. 프롤로그는 맨 앞.
2. 단위가 다르면 다른 묶음("1화"/"1권"), 번호가 안 겹치면 단위 없는 것도 본편("12화"/"13").
3. 이름 맨 앞 사이트 순번("0001 - ")은 무시 (Blacktoon).
4. 작품 제목은 통째로 지우고 비교 — 한 글자 단어도 ("시아버지가 다 따먹음 10화" 와 "9화" 는 같은 묶음, 늑대닷컴).
5. 번호 앞 "제"는 무시 ("제62화" = "62화").
6. 시즌 표시가 있으면 시즌 순서가 먼저: 표시 없음(시즌1) → "시즌2" → … , 본편은 첫 시즌에서 고름 ("죽지 않으려면").
7. newxtoon: 이름 숫자가 사이트 순서대로 자꾸 줄거나 겹치면(max(3, 5%) 이상) 이름 번호를 버리고 사이트 순서 그대로,
   오래된 회차부터 1..N 번호, 이름 앞에 "N. " (사이트와 같은 모양, 두 앱 같은 이름) — 나노마신("제40장 (1)(2)(3)" + "290화").
8. 회차 이름 뒤 "· 남은 N화"/"· 마지막" (설정으로 끌 수 있음). 이름이 바뀌면 다운로드한 회차를 앱이 못 찾을 수 있음을 알림.
9. 망가요미는 이름 맨 앞 숫자로 순서를 정함 → 본편 아닌 회차는 이름 앞에 이어지는 번호("111 · 시즌2 1화"). 소스 순서 정렬 없음.
10. 다른 묶음이라도 번호가 모두 본편의 빈 번호(본편 마지막 화보다 작고 안 겹침)면 본편 — 사이트가 이름을 잘못 적은 경우("화화화섹파들이 사실 가족이었다 21화", 늑대닷컴). 번외·외전·다른 시즌은 제외.
11. "2부 172화" 의 "2부"는 회차 번호가 아니라 부 표시(시즌처럼): 뒤에 다른 단위 번호가 있으면 그것이 회차, "N부"는 시즌 N. 다음 부·시즌이 본편 번호를 이어 가면(64화 → 2부 65화) 본편. 망가요미는 본편이라도 번호 앞에 다른 숫자가 있으면 "172 · 2부 172화"처럼 번호를 앞에 붙임 (블랙툰 낙향문사전).
12. 이름이 똑같은 회차(사이트에 같은 화가 여러 번 올라온 것)는 가장 최근 업로드 하나만 남김 — 11toon 주술회전 "1화"가 4번. 이름이 조금이라도 다르면 둘 다 둠.
13. "1~5화" 처럼 묶은 회차는 첫 화 번호(1). 단위가 다른 묶음("바키 1부 01권" 과 "66화")은 번호가 비어 있어도 본편에 합치지 않음. "2부 예고" 처럼 부 표시 뒤에 번호 없는 말만 있으면 그 부의 번호 없는 회차 (11toon 바키도).
14. 이름 맨 앞 사이트 순번은 구분 기호 앞이나 뒤에 빈칸이 있을 때만("0001 - ", "107. ") — 빈칸 없는 "259.1화"·"262-2화"·"129.5화" 는 회차 번호 (11toon 주술회전에서 "259.1화" 가 "1화" 로 보이던 문제).
15. 같은 단위 번호가 여러 개면 마지막 것이 회차 ("두 번 사는 랭커 1화 222화" 는 222화, 굿툰). 단 괄호 ( ) [ ] 안 번호는 설명이라 빼고 봄 ("143화 (외전 2화)" 는 143화 — 사이트처럼 외전도 본편 번호 순서, 블랙툰 말단 병사에서 군주까지). 굿툰 회차 이름의 글자 "&nbsp;" 는 빈칸으로.
16. 앞뒤 회차와 동떨어진 번호는 사이트가 잘못 적은 것: 앞뒤 번호가 서로 2 이하로 가깝고 이 회차는 둘과 10 넘게 차이 나면, 사이(맨 끝이면 바로 옆)의 안 쓰인 같은 단위 번호로 바로잡고 중복 정리(12번)에서도 지우지 않음. 망가요미는 "1 · 56화"처럼 번호를 앞에 붙임 (늑대닷컴 무직전생: 1화가 "56화"로 적혀 진짜 56화와 겹쳐 지워졌던 문제).
- 늑대닷컴 실제 회차 목록 확인: mangayomi_probe(fetch)로 `https://wfwf517.com/cl?toon=<번호>&s=n&pg=1` (웹툰은 /list?toon=, 쪽마다 pg=2,3…). 번호는 `/sh?q=<EUC-KR 검색어>` 결과에서.
- 사용자는 망가요미 변형 앱 "Mangayomi Glitch"(SNI 파편화·인증서 무시 설정 등)도 씀. 블랙툰 작품 데이터(webtoon_0/1.js, 큰 파일)는 정규식 대신 위치로 배열을 자르고(btArray), 실패하면 주소별 이유(HTTP 코드·형식 다름·글자 수)를 오류에 표시.
- 망가요미 JS 공통 appClient: 사이트 요청은 User-Agent 를 빼고 보냄(원래 망가요미가 웹뷰 UA를 넣어 클라우드플레어 쿠키가 통함). Glitch 는 UA 를 안 넣어 사이트가 연결을 끊음(블랙툰) → 연결 오류·403 이면 UA 넣어 다시 보내고 그 뒤로 계속 넣음(APP_NO_UA). 15개 파일(웹툰 10 + 애니 5: gogotv·tvchak·livesports2·anilife·ohli24) 모두 같은 코드 유지. 그래도 연결 오류면 `new Client({persistentConnection:false,noProxy:true,timeout:25,connectTimeout:10})`(APP_ALT, 연결 재사용 없는 별도 통신)로 한 번 더 — 애니24 재생에서 효과 확인된 방법.
- 굿툰 실제 회차 목록 확인: mangayomi_probe(fetch)로 `https://www.goodtoon007.com/manga/gt-<번호>/ajax/chapters/?t=1|https://www.goodtoon007.com/manga/gt-<번호>/` (번호는 `/?q=검색어` 결과에서).
- 11toon (2026.10 개편): 옛 /mb·/iapi 가 없어지고 게시판 구조. 안내 사이트 11toon1.com 의 "일일툰현재주소"(11toon148.com, spotv148.com)는 국내 휴대폰에서 막힘 → 사용자가 알려 준 국내 접속 주소 https://update.spotv24.com 을 기본, http://91.192.107.81:6600 을 예비로 씀(자동 찾기는 예비 주소 → 안내 사이트 순). 주소 설정 키를 바꿈(Kotlin pref_domain_v2, JS domain_v2·auto_domain_v2)해서 옛 저장 주소를 버림. 번호 주소가 아니라 주소 감시(monitor sites)에서는 뺌. 목록 `/bbs/board.php?bo_table=toon_c&tablename=인기만화`(type=upd 최신, is_over=1 완결, sca=장르, page=N), 작품 `bo_table=toons&is=<작품번호>&page=N`(회차 100개씩, .episode-title·.free-date yy.MM.dd), 회차 `bo_table=toons&wr_id=<회차번호>`(var img_list / 예비 img_list_2), 검색 `/bbs/ajax.search.php?search_key=`(JSON list·counts). 작품·회차 번호는 예전과 같아서 앱 안 주소는 옛 모양(/mb/content/info/{id}, /mb/content/image/{id}) 그대로 두고 요청할 때만 바꿈(서재·읽은 기록 유지). 실제 목록 확인은 mangayomi_probe(fetch)로 위 주소들.

## 지금까지 고친 것·배운 것 (다시 같은 실수 하지 않기)
- 네이버웹툰(NaverWebtoon.kt / naverwebtoon.js): 공식 무료 회차만(미리보기·유료 `charge` 제외), 19세 기본 숨김(WebView 로그인 필요), 그림은 모바일 회차 화면 `img.toon_image` + Referer m.comic.naver.com, 도메인 자동 찾기 없음(공식 고정 주소).
- 망가요미 목록 표지는 `getHeaders(url)`(UA + Referer)가 있어야 뜸 — 새 JS 소스에 반드시 넣기.
- 망가요미는 넘어간(리다이렉트) 최종 주소를 알려 주지 않음 → 정상 화면에 적힌 더 큰 번호의 같은 사이트 주소를 확인해 `auto_domain`에 저장(`selfTarget`/`familyTarget`, 늑대닷컴은 `WOLF_TRIED`), 실패한 주소는 30분간 다시 안 염. 앱 웹뷰에서 간 주소는 확장이 알 수 없음(앱 한계).
- 망가요미는 필터를 돌려줄 때 `_status` 표시를 지움 → 상태 줄은 글자로도 거를 것.
- 늑대닷컴 검색어는 EUC-KR 인코딩. GitHub 러너에서 접속 가능(실제 목록 확인용). newxtoon·후후티비 등은 Cloudflare로 러너 차단.
- 이미지가 늦게 뜨는 문의: 앱 설정(미리 불러올 페이지 수, 읽을 때 자동 다운로드)으로 안내, Custom hardware bitmap threshold는 속도와 무관.
- 회차 순서 문제는 위 "회차 정렬·번호 규칙"을 따르고, 실제 사이트 이름으로 두 앱 모두 테스트. 규칙을 바꾸면 예전 사례(21화 누락, 블랙툰 2부·말단 병사, 바키도, 주술회전, 두 번 사는 랭커, 시즌)를 모두 다시 돌려 볼 것.
- 11toon 열혈강호 "열혈강호 729"(729화)는 사이트가 한글을 자모로 풀어 적음(NFD, "화"도 없음) → 작품 제목이 안 빠지고 다른 묶음이 돼 맨 위 "마지막"으로 보임. 회차 이름·작품 제목을 NFC 로 모아 비교(Kotlin Normalizer, JS normalize). 총 316화인데 Missing 416 은 사이트에 1~17권 + 일부 화만 있어서(확장으로 못 채움).

## 아이콘
- 앱 아이콘은 src/main/res/mipmap-xxxhdpi/ic_launcher.png(192px, 사용자가 준 만화 칸 K 그림). 예전엔 build.yml 이 보라색 아이콘을 그렸지만 그 단계는 뺌. 망가요미 iconUrl 은 gh-pages/icon(APK 에서 꺼낸 그림)이라 빌드 후 같이 바뀜.
