# 작업 규칙 (Claude용)

- 사용자는 한국어로 대화하며 개발자가 아님. 답변은 한국어로, 쉽게.
- 사이트의 봇 차단·광고 확인·캡차·암호화·복사 방지를 우회하는 기능은 만들지 않음. 사이트를 직접 찾아 추가하지 않음.
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
