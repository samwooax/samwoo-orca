# SAMWOO-ORCA WAVES — 실행 계획 문서

> 역할 분담: **`docs/samwoo/SPEC.md` = 무엇을·왜 (제품 결정·아키텍처·상태·기준)** / **이 문서 = 어떻게·언제 (웨이브별 실행·상태 추적)**.
> 갱신 규칙: 웨이브 상태·완료 커밋은 코덱스가 작업 완료 시 갱신. 새 웨이브 추가·범위 변경은 Claude(검증자)가 반영.
> 완료된 웨이브의 상세 지시서는 `_claude-proposals/archive/`로 이동한다 (파일명 유지).
> 최종 갱신: 2026-08-10

## 웨이브 현황판

| Wave | 이름 | 상태 | 완료 커밋 |
|---|---|---|---|
| W1 | 기반 — 알림·연결 표시등·엔드포인트 중앙화 | ✅ 완료 | 2b0fd4eec, e1d93461e, ea63521ff |
| W2 | 구조 — 허브 페이지·메신저 팝아웃 창·UI | ✅ 완료 | f5d9455e9, 41c17119e, 7560f368c, 33669d21e, 3045382b5 (W2c) |
| W3a | 실시간 서버 — WAL·SSE·멱등·백업 | ✅ 배포 완료 | cda008945 |
| **W3b** | **실시간 클라이언트 — SSE 수신·전송 큐·프레즌스** | ✅ **배포 완료·2계정 실측 대기** | c87cdf8d4 |
| W3c | VPS 배포·실측 (W4b 모듈 포함 통합 배포, 담당: 사용자+Claude) | 서버 배포 완료·GUI 실측 진행 | 운영 배포 2026-08-09 |
| W4a | 봇 메일 첨부 파이프라인 (서버) | ✅ 배포 완료·실계정 실측 대기 | 478aa31dc |
| W4b | 봇 대화 맥락·검색 API + 스킬 배포 | ✅ 배포 완료·실계정 실측 대기 | 7289d7769 |
| W5 | 무인 예약 — 위임 토큰·VPS 크론 | 설계 대기 (앱 종료 중 실행 전용) | — |
| W6a | 프로필 멤버 디렉터리·메신저 실명 표시 | v1.4.188 UI 보완·VPS 반영 완료, GUI 실측 대기 | f4d4df553, 0262f692d, 663d6c626, run 31346008860 |
| W6b | 허브 2단계 — 담당자·마감일·작업 항목 | v1.4.188 UI 보완·VPS 반영 완료, GUI 실측 대기 | 30e8ef9b8, 086c4a4fd, 0262f692d, 663d6c626, run 31346008860 |
| W7 | 빌드 준비 — 핵심 테스트 배선·CI 범위·버전 | ✅ 완료 | 27fb634d4, v1.4.183 준비 |
| W8 | Windows 빌드·검증·공개 | ✅ 완료 | v1.4.183, run 31304436692 |
| W9 | v1.4.184 긴급 대체 릴리스 — 팝아웃 크래시 수정·W6b | ✅ 완료 | 3a2594771, 30e8ef9b8, 086c4a4fd, 5701ac030, run 31310610748 |
| W10 | v1.4.185 one-click·전체 사용자 Windows 설치 | ✅ 완료 | 01b99d44c, f9b1e8396, f1c2353d5, run 31312994734 |
| W11 | 로그인 식별자 정규화·릴리스 UI 정리 | ✅ v1.4.186·VPS 반영 완료, GUI 실측 대기 | 0262f692d, 5fc6b6224, edff354cf, run 31318757576 |
| W12 | 예약 지시 — 인앱 스케줄러·우측 사이드탭 | ✅ v1.4.188 토큰 분리 보완·GUI 실측 대기 | 12ffde36d, 5eb6dd155, 663d6c626, run 31346008860 |

## 웨이브 상세

### W3b — 실시간 클라이언트 (배포 완료, 2계정 실측 대기)
- 지시서: `_claude-proposals/waves/W3b-messenger-scale-client.md`
- 구현: main 프로세스 단일 SSE 수신·지수 백오프 재연결, 폴링 fallback, `clientMessageId` 전송 큐(pending→확정·자동 재시도·수동 재전송), `onlineLogins` 프레즌스 상태·표시
- 안전장치: SSE 이벤트의 `isAuthor`를 수신 사용자 기준으로 재계산하고, 연결이 끊기면 프레즌스 UI를 숨긴다.
- 검증: focused Vitest 18개, TypeScript, oxlint·React 규칙, max-lines, i18n 게이트 통과. 운영 `/events` 배포와 단일 클라이언트 온라인 수신은 확인됐고 1초 내 수신·2계정 프레즌스 실측은 W3c에 남아 있다.

### W3c — VPS 배포 완료·GUI 실측 진행
- 2026-08-09 `ThreadingHTTPServer`, W3a·W4a·W4b·W6a·W6b 서버 모듈과 Hermes 스킬을 통합 반영했다. `/events`와 작업 항목 라우트, WAL 동시 응답, 백업·cron을 운영에서 확인했다.
- 남은 실측: 2계정 SSE·프레즌스, 메신저 실명, 담당자·마감일·작업 항목, 메일 첨부와 봇 메시지 조회. 실명·담당자 실패 원인은 메일 주소와 짧은 아이디가 섞인 login으로 확정했고 W11에서 수정했으며, `1.4.186` 앱과 VPS 반영 뒤 재검증한다.

### W4b — 봇 대화 맥락·검색 (배포 완료, 실계정 실측 대기)
- 지시서: `_claude-proposals/waves/W4b-hermes-message-context.md`
- 구현: 프로필 격리·LIKE 리터럴 이스케이프·안정적 커서를 적용한 `/profile-messages/search`, 온디맨드 조회 전용 `samwoo-messages` 스킬, 팀 채팅 세션 접근 안내
- 검증: 검색 경계 테스트를 포함한 Python 서버 테스트 65개, TypeScript, oxlint, i18n, max-lines 게이트 통과
- 배포: 서버 모듈과 Hermes 호스트의 mail·messages 스킬을 2026-08-09 반영했다. 실계정 요약·타 프로필 차단 확인은 남아 있다.

### W5 — 무인 예약 (지시서 미작성·착수 안 함)
- 범위는 앱이 꺼져 있어도 실행돼야 하는 서버 예약에 한정한다. 앱 실행 중 예약은 W12가 담당하며 중복 구현하지 않는다.
- 선행 설계: 예약 작업용 위임 토큰(메일 읽기+지정 워크스페이스 쓰기+메신저 전송으로 범위 제한, 폐기 가능, 장수명)과 VPS 크론 격리.
- 크론 등록/조회/삭제 스킬, 등록 전 사용자 확인 가드레일, 결과의 워크스페이스 저장·메신저 통지가 필요하다.

### W6a — 프로필 멤버 디렉터리·메신저 실명 표시 (VPS 반영 완료·GUI 실측 대기)
- 지시서: `_claude-proposals/waves/W6a-profile-directory-real-names.md`
- 구현: VPS 런타임 CSV 이중 원천·mtime 캐시, 토큰 프로필 기반 `/profile-members/list`, 메시지·답장·채널·알림·프레즌스 표시명 fallback
- 경계: login 식별과 기존 Hermes 프로필·에이전트 표기는 유지하며 실명은 메신저에서만 사용한다. 직원 명단은 Public 저장소에 두지 않는다.
- 검증: Python 서버 전체 72개, focused Vitest 16개, TypeScript 3종, oxlint·React 규칙, max-lines, i18n 게이트 통과. W11 서버 배포와 DB 마이그레이션 뒤 VPS `role-map.csv` fallback 18명을 확인했다. 운영 CSV 핫 리로드와 2계정 실명 GUI 실측만 남았다.

### W6b — 허브 2단계 (VPS 반영 완료·GUI 실측 대기)
- 담당자: `/profile-members/list` 기반 login 복수 선택 팝오버, 프로필 격리 중앙 저장, 소유자·기여자 변경 권한, 목록·상세 표시와 변경 이력을 구현했다. 신규 할당은 SSE로 OS 알림과 워크스페이스·Dock/작업표시줄 배지에 반영하며, 직원 실명은 기존 결정대로 메신저에서만 사용한다.
- 마감일: 중앙 공유 메타데이터 저장, 소유자·기여자 변경 권한, 날짜·감사 정보 검증, 상세 패널 지정·해제와 목록·보드 표시, 지난 날짜 강조를 구현했다.
- 작업 항목: 공유별 중앙 테이블, 소유자·기여자 변경 권한, 생성·완료 체크와 작업별 프로필 멤버 1명 지정·해제, 상세 패널 15초 갱신과 목록·보드 진행률을 구현했다.
- 서버 라우트와 W11 정규화·기존 DB 마이그레이션의 VPS 반영을 완료했다. 합성 세션 API는 통과했으며 담당자·마감일·작업 항목의 2계정 GUI 실측만 남았다.
- 디자인 확정본: `_claude-proposals/workspace-hub-design.png`, `assignee-picker-preview.png`

### W7 — 빌드 준비 (완료)
- 핵심 IPC 등록 테스트에 SSE mock·호출 검증을 연결하고 W2~W6a 신규 테스트 15개를 Windows 워크플로에 전수 포함했다.
- 저장소 버전을 `1.4.183`으로 올렸으며 최신 공개 릴리스 표기는 배포 전까지 `v1.4.182`로 유지한다.
- 검증: Windows 지정 Vitest 57개 파일, TypeScript 3종, oxlint·React 규칙, 신뢰성·max-lines·스킬 번들·i18n 게이트, Python 서버 72개 통과.
- 다음 단계: W3c VPS 배포·실측 후 CI draft 빌드를 수동 실행한다.

### W8 — Windows 빌드·검증·공개 (완료)
- Actions run `31304436692`에서 지정 통합 테스트, Python 서버 테스트, 앱 빌드, 사내 인증서 서명과 Windows NSIS 패키징을 통과했다.
- draft 자산 3종과 `latest.yml` 버전·EXE SHA-512 및 GitHub SHA-256 digest, Authenticode signer·publisher 검증을 확인했다.
- 모든 공개 게이트 통과 후 `v1.4.183`을 공개했으며 공개 `latest.yml`이 버전 `1.4.183`을 반환하는 것을 확인했다.
- 후속 실측: 기존 `v1.4.182` 앱의 업데이트 버튼으로 다운로드·무인 설치·재실행 경로를 확인한다.

### W9 — v1.4.184 긴급 대체 릴리스 (완료)
- 메신저 팝아웃의 Tooltip 컨텍스트 누락 크래시를 수정하고 회귀 테스트를 추가했으며, W6b 담당자·마감일·작업 항목 구현과 Windows CI 테스트 배선을 포함했다.
- Actions run `31310610748`에서 Windows 지정 Vitest 73개 파일 275개 테스트, Python 서버 테스트 83개, TypeScript 3종, oxlint·React 규칙, 신뢰성·max-lines·스킬 번들·i18n 게이트와 서명 NSIS 패키징을 통과했다.
- draft 자산 3종을 확인하고 `latest.yml` 버전 `1.4.184`, EXE 실제 SHA-512 일치, 내부 코드서명 설정·서명 자산 검증 단계 성공을 확인했다.
- `v1.4.184`를 공개 최신 릴리스로 전환하고 공개 업데이트 피드가 `1.4.184`를 반환함을 확인했다. 대체된 `v1.4.183`은 draft로 전환했다.
- VPS 배포·2계정 실측은 W3c 범위로 남아 있으며 이번 Windows 릴리스에 포함된 서버 기능이 운영 반영됐음을 뜻하지 않는다.

### W10 — v1.4.185 one-click·전체 사용자 Windows 설치 (완료)
- Windows NSIS를 마법사 없는 one-click·전체 사용자 설치로 전환하고 설치 완료 후 자동 실행을 활성화했다. assisted 전용 NSIS 헤더·완료 훅은 one-click에서 제외하고 실제 제거 시에만 daemon host를 정리하는 `${isUpdated}` 가드는 유지했다.
- 사내 설치 키트는 Git·Python·uv 오프라인 파일이 없을 때 고정 공식 URL에서 자동 다운로드해 SHA-256을 검증하며, 신규 per-machine 경로와 기존 per-user 경로를 모두 확인한다.
- 최초 run `31312564030`은 assisted 전용 `$MultiUser.InstallModePage.CurrentUser` 참조로 NSIS 컴파일에 실패했다. `f1c2353d5`에서 define·header를 함께 assisted 범위로 옮기고 위치 회귀 테스트를 추가했다.
- Actions run `31312994734`에서 통합 검사, 앱 빌드, one-click/perMachine NSIS 컴파일·내부 서명, 자산 검증과 draft 업로드를 통과했다.
- 자산 3종, `latest.yml` 버전 `1.4.185`, EXE 실제 SHA-512 일치와 `isAdminRightsRequired: true`를 확인한 뒤 공개했다. 공개 최신 피드의 `1.4.185` 반환을 확인했고 `v1.4.184`는 공개 상태를 유지했다.
- 전체 사용자 설치·업데이트는 Windows 정책상 UAC 승인을 요구할 수 있으므로 UAC 없는 완전 무인으로 표현하지 않는다. 실제 Windows 10 신규 설치와 1.4.184→1.4.185 업데이트 UI 실측은 사용자 확인이 필요하다.

### W11 — 로그인 식별자 정규화 (v1.4.186·VPS 반영 완료·GUI 실측 대기)
- 메일 주소 전체와 짧은 아이디가 세션 login에 섞여 CSV 실명, SSE 프레즌스, 메시지 본인 판정과 워크스페이스 담당자 매칭이 깨지는 운영 원인을 확인했다.
- 서버 세션 결합·복원, CSV 디렉터리와 앱 로그인 저장·localStorage 복원·비교 경로를 도메인 제외 소문자 login으로 통일했다. 담당자 피커에는 정규 login 기준의 `나` 표시를 추가했다.
- 기존 SQLite의 세션, 공유·감사 필드, 담당자, 작업 항목, 댓글, 메시지와 읽음 커서를 테이블별 완료 마커로 한 번만 마이그레이션한다. UNIQUE 충돌은 메시지 최신 생성값, 읽음 최신 커서, 담당자 최신 지정 시각을 보존한다.
- 검증: Windows 지정 Vitest 75개 파일 289개 테스트(로컬 소켓 1건은 샌드박스 밖 재검증), Python 87개, TypeScript 3종, 전체 oxlint·신뢰성·max-lines·스킬·i18n 게이트 통과.
- 릴리스 UI 정리: 프로필 채팅 탭을 앱 표시명으로 통일하고 탭 높이를 사이드바와 같은 36px로 맞췄다. 인증 서버 상태 점은 각 프로필 탭으로 옮겼으며, 채팅 권한 안내와 사이드바 하단의 중복 워크스페이스 버튼을 제거했다. 허브 재선택 복귀와 24px 허브 도구 모음도 함께 반영했다.
- 모델: 신규·무효 저장 상태의 팀 채팅 fallback과 운영 Hermes 11개 프로필의 기본 모델을 GPT-5.6 Terra로 통일했다. 운영의 기존 sticky 프로필 `oliver`는 유지했다.
- 후속 UI 검증: focused Vitest 13개 파일 112개 테스트, TypeScript 3종, oxlint·React 규칙, i18n 3종, max-lines ratchet과 diff 무결성 검사를 통과했다.
- 릴리스: Actions run `31318757576`에서 Windows 통합 검사, Python 서버 테스트, 앱 빌드, 내부 서명 NSIS 패키징과 자산 검증을 통과했다. 공개 `latest.yml`의 버전 `1.4.186`, EXE 크기 `185686944`, SHA-512와 GitHub 자산 digest 일치를 확인했다.
- 운영 확인: `v1.4.186` 서버 모듈 재배포·서비스 재시작, 기존 DB 7개 영역 무손실 마이그레이션, 합성 인증 세션 API와 `role-map.csv` 18명 로드를 완료했다.
- 남은 단계: 앱 업데이트 후 재로그인, 2계정 메신저·프레즌스·워크스페이스 GUI 실측.

### W12 — 예약 지시 (v1.4.187 공개 완료·GUI 실측 대기)

- 범위: 자연어 지시를 시각·요일로 등록해 앱 실행 중 팀 봇에게 자동 전송. 우측 사이드바 `예약` 탭에서 등록·중지·삭제·지금 실행.
- 서버 변경 없음. 기존 `sendHermesTeamChat` 경로를 그대로 쓰되 메일 토큰은 있을 때만 전달한다. 일반 예약은 메일 토큰 없이 실행하고, 메일 작업은 실행 시 유효한 세션이 필요하다.
- 신규: `src/shared/samwoo-schedule.ts`(발생 시각 계산·판정), `samwoo-schedule-store.ts`(localStorage), `samwoo-schedule-runner.ts`(30초 틱·중복 실행 방지), `SamwooSchedulePanel.tsx`, `samwoo-schedule-day-picker.tsx`, `useSamwooScheduleRunner.ts`.
- 부수 수정: 프로젝트 루트가 없는 턴은 로컬 명령 승인 모달을 띄우지 않고 거절 결과를 반환한다(`hermes-local-project-tool-loop.ts`).
- 검증: W12 핵심 6개 테스트 파일 41개, RPC·라우팅 포함 focused 8파일 87개, TypeScript 3종, 전체 oxlint·React 규칙, max-lines·신뢰성·스킬 번들·i18n 게이트와 Python 서버 87개가 통과했다. ko/en 33키를 추가했다.
- 릴리스: `5eb6dd155`에서 버전 `1.4.187`을 반영했다. Actions run `31341733681`의 통합 검사·내부 서명 NSIS·자산 검증을 통과했고 공개 `latest.yml`의 버전·크기·SHA-512 일치를 확인했다.
- 후속 보완: `663d6c626`에서 일반 예약은 메일 토큰 없이 실행하고 토큰이 있을 때만 팀 채팅에 전달하도록 분리했다. `v1.4.188`, Actions run `31346008860`으로 공개했다.
- 남은 단계: 실제 앱의 예약 등록·재시작 catch-up·지금 실행 GUI 실측.

## 폐기·보류
- 완료·폐기 지시서는 전부 `_claude-proposals/archive/`에 있음 — 참조 금지 (이력 보존용)
- 메신저 첨부 — 제품 결정으로 보류 (SPEC 13절)
- 협업 폴더 구조·규약: `_claude-proposals/README.md`
