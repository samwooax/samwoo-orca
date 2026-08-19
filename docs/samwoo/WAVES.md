# SAMWOO-ORCA WAVES — 실행 계획 문서

> 역할 분담: **`docs/samwoo/SPEC.md` = 무엇을·왜 (제품 결정·아키텍처·상태·기준)** / **이 문서 = 어떻게·언제 (웨이브별 실행·상태 추적)**.
> 갱신 규칙: 웨이브 상태·완료 커밋은 코덱스가 작업 완료 시 갱신. 새 웨이브 추가·범위 변경은 Claude(검증자)가 반영.
> 완료된 웨이브의 상세 지시서는 `_claude-proposals/archive/`로 이동한다 (파일명 유지).
> 최종 갱신: 2026-08-19

## 웨이브 현황판

| Wave    | 이름                                                         | 상태                                                              | 완료 커밋                                                              |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| W1      | 기반 — 알림·연결 표시등·엔드포인트 중앙화                    | ✅ 완료                                                           | 2b0fd4eec, e1d93461e, ea63521ff                                        |
| W2      | 구조 — 허브 페이지·메신저 팝아웃 창·UI                       | ✅ 완료                                                           | f5d9455e9, 41c17119e, 7560f368c, 33669d21e, 3045382b5 (W2c)            |
| W3a     | 실시간 서버 — WAL·SSE·멱등·백업                              | ✅ 배포 완료                                                      | cda008945                                                              |
| **W3b** | **실시간 클라이언트 — SSE 수신·전송 큐·프레즌스**            | ✅ **배포 완료·2계정 실측 대기**                                  | c87cdf8d4                                                              |
| W3c     | VPS 배포·실측 (W4b 모듈 포함 통합 배포, 담당: 사용자+Claude) | 서버 배포 완료·GUI 실측 진행                                      | 운영 배포 2026-08-09                                                   |
| W4a     | 봇 메일 첨부 파이프라인 (서버)                               | ✅ 배포 완료·실계정 실측 대기                                     | 478aa31dc                                                              |
| W4b     | 봇 대화 맥락·검색 API + 스킬 배포                            | ✅ 배포 완료·실계정 실측 대기                                     | 7289d7769                                                              |
| W5      | 무인 예약 — 프로필별 Hermes Cron                             | W13 PC 로컬 예약으로 대체                                         | 운영 이력 보존                                                         |
| W6a     | 프로필 멤버 디렉터리·메신저 실명 표시                        | v1.4.189 읽지 않은 인원·Windows 알림·VPS 반영 완료, GUI 실측 대기 | f4d4df553, 0262f692d, 663d6c626, 452a5612a, run 31358937097            |
| W6b     | 허브 2단계 — 담당자·마감일·작업 항목                         | v1.4.189 빈 공유 방지 반영 완료, GUI 실측 대기                    | 30e8ef9b8, 086c4a4fd, 0262f692d, 663d6c626, 452a5612a, run 31358937097 |
| W7      | 빌드 준비 — 핵심 테스트 배선·CI 범위·버전                    | ✅ 완료                                                           | 27fb634d4, v1.4.183 준비                                               |
| W8      | Windows 빌드·검증·공개                                       | ✅ 완료                                                           | v1.4.183, run 31304436692                                              |
| W9      | v1.4.184 긴급 대체 릴리스 — 팝아웃 크래시 수정·W6b           | ✅ 완료                                                           | 3a2594771, 30e8ef9b8, 086c4a4fd, 5701ac030, run 31310610748            |
| W10     | v1.4.185 one-click·전체 사용자 Windows 설치                  | ✅ 완료                                                           | 01b99d44c, f9b1e8396, f1c2353d5, run 31312994734                       |
| W11     | 로그인 식별자 정규화·릴리스 UI 정리                          | ✅ v1.4.186·VPS 반영 완료, GUI 실측 대기                          | 0262f692d, 5fc6b6224, edff354cf, run 31318757576                       |
| W12     | 예약 지시 — 인앱 스케줄러·우측 사이드탭                      | W5 Hermes Cron으로 대체                                           | 12ffde36d, 5eb6dd155, 663d6c626, run 31346008860                       |
| W13     | PC 로컬 예약 — 프로젝트 결과 저장                            | v1.4.192 draft·원클릭 r24 완료, Windows 실측 대기                 | 85683e7e5, run 31452996632                                             |
| W14     | Hermes 로컬 도구 경계·결과 보존 및 v1.4.193 공개             | ✅ 완료                                                           | f8e7a16c7, 8fc10570d, run 31581558831                                  |
| W15     | Hermes PDF/XLSX/PPTX 로컬 문서 도구                          | v1.4.216 공개·설치본 사용자 실측 대기                             | fdaf99a27, c525a4d1c, 1074bd27e, run 32210279875                       |

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

### W5 — 무인 예약 (구현·운영 틱커 실측 완료, 앱 GUI 실측 대기)

- W12의 localStorage·30초 렌더러 타이머를 실행 원장에서 제외하고, 우측 예약 탭이 프로필별 Hermes Cron 작업을 직접 등록·조회·중지·재개·즉시 실행·삭제하도록 전환했다.
- 5~59분, 1~24시간, 지정 요일·시각 반복을 지원한다. 원격 작업을 다시 읽어 Job ID가 확인돼야 성공 처리하며 다음 실행·최근 상태·오류와 서버 heartbeat를 표시한다.
- qn6c에는 활성 Hermes Cron의 `every 1m` bootstrap 작업과 `samwoo-profile-cron-tick.sh`를 배포했다. 자동 실행 run 완료, heartbeat 갱신, 프로필별 병렬 tick, `ai_center`의 `every 5m` 반복 생성·조회·삭제를 실측했다.
- 기존 로컬 예약은 같은 ID의 원격 작업으로 자동 이관하며, 등록 실패 항목은 새로고침 때 재시도하고 원격 작업이 없어도 로컬 항목을 삭제할 수 있다.
- 사용자 메일 비밀번호·장수명 위임 토큰은 저장하지 않는다. 따라서 임시 메일 세션이 필요한 메일 예약은 무인 실행을 보장하지 않으며 별도 제한 권한 설계가 필요하다.

### W6a — 프로필 멤버 디렉터리·협업 UI 실명 표시 (VPS 반영 완료·GUI 실측 대기)

- 지시서: `_claude-proposals/waves/W6a-profile-directory-real-names.md`
- 구현: VPS 런타임 CSV 이중 원천·mtime 캐시, 토큰 프로필 기반 `/profile-members/list`, 메시지·답장·채널·알림·프레즌스 표시명 fallback
- 경계: login 식별과 기존 Hermes 프로필·에이전트 표기는 유지하며 실명은 메신저와 워크스페이스 협업 UI에서만 사용한다. 직원 명단은 Public 저장소에 두지 않는다.
- 검증: Python 서버 전체 72개, focused Vitest 16개, TypeScript 3종, oxlint·React 규칙, max-lines, i18n 게이트 통과. W11 서버 배포와 DB 마이그레이션 뒤 VPS `role-map.csv` fallback 18명을 확인했다. 운영 CSV 핫 리로드와 2계정 실명 GUI 실측만 남았다.

### W6b — 허브 2단계 (VPS 반영 완료·GUI 실측 대기)

- 담당자: `/profile-members/list` 기반 login 복수 선택 팝오버, 프로필 격리 중앙 저장, 소유자·기여자 변경 권한, 목록·상세 표시와 변경 이력을 구현했다. 신규 할당은 SSE로 OS 알림과 워크스페이스·Dock/작업표시줄 배지에 반영한다. 담당자·변경자·댓글 작성자는 CSV 직원명으로 표시하되 식별과 권한 판정은 login을 유지한다.
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

### W12 — 예약 지시 (W5 Hermes Cron으로 대체)

- 범위: 자연어 지시를 시각·요일로 등록해 앱 실행 중 팀 봇에게 자동 전송. 우측 사이드바 `예약` 탭에서 등록·중지·삭제·지금 실행.
- 서버 변경 없음. 기존 `sendHermesTeamChat` 경로를 그대로 쓰되 메일 토큰은 있을 때만 전달한다. 일반 예약은 메일 토큰 없이 실행하고, 메일 작업은 실행 시 유효한 세션이 필요하다.
- 신규: `src/shared/samwoo-schedule.ts`(발생 시각 계산·판정), `samwoo-schedule-store.ts`(localStorage), `samwoo-schedule-runner.ts`(30초 틱·중복 실행 방지), `SamwooSchedulePanel.tsx`, `samwoo-schedule-day-picker.tsx`, `useSamwooScheduleRunner.ts`.
- 부수 수정: 프로젝트 루트가 없는 턴은 로컬 명령 승인 모달을 띄우지 않고 거절 결과를 반환한다(`hermes-local-project-tool-loop.ts`).
- 검증: W12 핵심 6개 테스트 파일 41개, RPC·라우팅 포함 focused 8파일 87개, TypeScript 3종, 전체 oxlint·React 규칙, max-lines·신뢰성·스킬 번들·i18n 게이트와 Python 서버 87개가 통과했다. ko/en 33키를 추가했다.
- 릴리스: `5eb6dd155`에서 버전 `1.4.187`을 반영했다. Actions run `31341733681`의 통합 검사·내부 서명 NSIS·자산 검증을 통과했고 공개 `latest.yml`의 버전·크기·SHA-512 일치를 확인했다.
- 후속 보완: `663d6c626`에서 일반 예약은 메일 토큰 없이 실행하고 토큰이 있을 때만 팀 채팅에 전달하도록 분리했다. `v1.4.188`, Actions run `31346008860`으로 공개했다.
- 대체: 기존 30초 로컬 runner는 앱 루트에서 제거됐고 W5의 서버 Hermes Cron이 실행 원장이다. 과거 구현 파일은 저장 데이터 호환을 위해 남아 있지만 앱에서 실행되지 않는다.

### W13 — PC 로컬 예약·프로젝트 결과 저장

- W5 서버 Cron 등록을 중단하고 앱 루트의 30초 예약 runner를 다시 연결했다. Orca가 실행·로그인된 동안에만 due 작업을 실행하며 앱 종료 중 놓친 작업은 재생하지 않는다.
- 예약 등록 시 선택한 로컬 프로젝트 ID·경로를 저장하고 팀 봇의 작업 경로로 전달한다. 응답은 main IPC 권한 검증을 거쳐 프로젝트의 `SAMWOO-예약결과/<예약 ID>/` 아래 Markdown으로 저장한다.
- 이전 버전의 `remoteJobId`가 있는 항목은 서버 작업 삭제가 확인될 때까지 로컬 실행·수정·삭제하지 않아 중복 실행과 고아 작업을 막는다.
- 서버 Hermes Cron 코드와 기존 API는 구버전 호환·운영 이력 때문에 보존하지만 신규 앱 예약은 사용하지 않는다.
- v1.4.192 Windows CI run `31452996632`에서 통합 검사·내부 코드서명 NSIS·자산 검증과 draft 업로드를 통과했다. 오프라인 Git·Python·uv·Tailscale과 수정 설치기를 포함한 원클릭 키트 `r24`도 내부 SHA-256 및 ZIP 무결성을 확인했다.

### W14 — Hermes 로컬 도구 경계·결과 보존 및 v1.4.193 공개

- 잘못되거나 혼합된 로컬 도구 envelope를 프로토콜 오류로 처리하고, 도구 실행 8라운드 뒤 최종 응답 전용 경계를 적용했다.
- 구조화된 실행 결과를 보존하도록 수정하고 `f8e7a16c7`, `8fc10570d`를 대상 브랜치에 통합했다.
- Actions run `31581558831` 재시도에서 테스트·빌드·서명·릴리스 자산 생성을 완료했다. 최초 시도는 Windows runner 인증서 오류로 Checkout 단계에서 중단됐다.
- `v1.4.193`을 최신 공개 릴리스로 배포했으며 `latest.yml`의 버전 `1.4.193`, 설치 파일 크기 `185709928`, 관리자 권한 요구 설정을 확인했다.

## 폐기·보류

- 완료·폐기 지시서는 전부 `_claude-proposals/archive/`에 있음 — 참조 금지 (이력 보존용)
- 메신저 첨부 — 제품 결정으로 보류 (SPEC 13절)
- 협업 폴더 구조·규약: `_claude-proposals/README.md`

### W15 — Hermes PDF/XLSX/PPTX 로컬 문서 도구

- `samwoo/upstream-v1.4.168`의 `v1.4.201` 릴리스 후보까지 text file bridge와 분리된 document protocol을 통합했다. native picker의 PDF/XLSX/PPTX/이미지는 main-owned artifact ID로만 전달한다.
- PDF text layer, XLSX 문자열 셀, PPTX 슬라이드 문단을 분할 추출한다. XLSX/PPTX 번역은 source text·SHA-256을 검증하고 구조·style·media를 유지한 신규 파일로만 저장한다.
- binary parsing은 30초·memory/ZIP/XML 상한이 있는 worker thread에서 실행한다. PDF.js worker asset이 배포 bundle에 포함되는 것을 확인했다.
- Windows local host에서는 bundled Python 3.13 worker를 integrity·engine probe한 뒤 Excel Artifact v1 `create`/`modify`/`validate`를 광고한다. durable idempotency receipt, output lock, cancellation, private staging·atomic commit을 main이 소유하고 SSH/Runtime에는 광고하지 않는다.
- 서버의 `excel-artifact` Skill discovery는 계속 비활성이다. Orca가 trusted capability와 로컬 protocol 지침을 Team Chat system context에 직접 주입하므로 서버 Tool이나 사용자 PC absolute path 권한은 필요하지 않다.
- PPTX 일반 생성·편집과 PDF 생성·페이지 편집을 같은 self-contained worker에 추가했다. 사용자는 Python/pip/package를 설치하지 않는다. LibreOffice preview와 OCR, 안전하게 보존할 수 없는 active content는 여전히 미지원이다.
- focused Vitest 13개 파일 81개 통과(1개 skip), TypeScript 3종, native/type-aware/React 품질 검사, max-lines·reliability·localization 3종, Electron production bundle을 통과했다. frozen worker의 XLSX/PPTX/PDF 실제 생성과 XLSX 구조 검증, PPTX chart·PDF 재개방, package signing 뒤 manifest 재생성 계약도 통과했다.
- Actions run `31684130573`에서 Windows package/sign과 draft 업로드가 성공했다. 설치본은 231,716,992바이트이며 GitHub SHA-256, `latest.yml` SHA-512·크기·관리자 권한 플래그, SAMWOO 내부 Authenticode 서명을 재검증했다. worker build source와 `.venv`는 app.asar에서 제외하고 실행용 worker 한 벌만 ordinary resource로 포함했다.
- v1.4.194 GUI 실측에서 PDF.js의 Node canvas runtime 누락으로 `DOMMatrix is not defined`가 발생했고 정적 PDF import 때문에 XLSX/PPTX 요청도 함께 실패하는 것을 확인했다. PDF lazy-load, 플랫폼별 `@napi-rs/canvas`, 명시적 `pdf.worker.mjs` 경로를 추가했으며 생산 번들 worker에서 XLSX와 PDF 실제 추출을 통과했다.
- Actions run `31686946817`에서 생산 번들 XLSX/PDF 실제 추출, Windows package/sign, draft 업로드가 성공했다. 설치본 241,432,768바이트의 GitHub SHA-256, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했고, 깨진 v1.4.194 미공개 draft는 삭제했다.
- v1.4.195 GUI 실측에서 Team Chat 탭이 활성인 동안 Explorer 파일 선택이 Native Chat용 `@상대경로`만 입력하고 실제 첨부를 만들지 않아, 문서 worker가 `@`가 포함된 존재하지 않는 project path를 조회하는 회귀를 확인했다. `b6ce7fd75`에서 Explorer 선택은 main이 local project root와 파일을 검증한 뒤 기존 attachment/artifact pipeline으로 직접 전달하도록 수정했다.
- Actions run `31868556602`에서 수정 포함 v1.4.196 Windows package/sign과 draft 업로드가 성공했다. 설치본 241,434,888바이트의 GitHub SHA-256, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했고, 회귀가 있는 v1.4.195 미공개 draft는 삭제했다.
- v1.4.196 GUI 실측에서 Explorer 첨부와 XLSX `inspect`는 성공했지만 Hermes가 후속 `extract`에 `limit:500`을 사용했고 strict parser의 200 상한 때문에 envelope 전체가 거부됐다. `81adb6770`에서 양의 초과값은 200으로 낮춰 실행하고 `nextCursor` 페이지네이션을 prompt에 명시했다. 0·음수·비정수와 다른 malformed 요청은 계속 거부한다.
- Actions run `31871806940`에서 v1.4.197 Windows package/sign과 draft 업로드가 성공했다. 설치본 241,428,792바이트의 GitHub SHA-256, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했고, 회귀가 있는 v1.4.196 미공개 draft는 삭제했다.
- v1.4.197 GUI 실측에서 XLSX 구조와 문자열은 읽지만 숫자·증감률·수식 결과가 추출되지 않고, 첫 turn 종료 뒤 artifact가 삭제되어 후속 질문이 같은 첨부를 다시 읽지 못하는 회귀를 확인했다. `463c01f4a`에서 typed cell extraction과 conversation-scoped artifact 재사용을 추가했다.
- Actions run `31874259265`에서 v1.4.198 Windows package/sign과 draft 업로드가 성공했다. 설치본 241,428,344바이트의 GitHub SHA-256 `330d1137dbd720d9a03ed7b92ef98571f54d740e6cd7005206a04ed610e152bd`, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했고, 회귀가 있는 v1.4.197 미공개 draft는 삭제했다.
- v1.4.198 GUI 실측에서 Hermes의 `create_pdf` 요청은 `pages[].elements`에 6쪽 한국어 본문을 정상 제공했지만 worker가 legacy `title/text`만 읽어 빈 페이지만 만들었다. 첫 한글 output은 Windows redirected stdin 코드페이지 때문에 staging path가 깨져 main의 cleanup 대상과 달라졌다. `63fad0b08`에서 strict PDF element spec·실제 렌더링, worker UTF-8 JSONL, ASCII staging, 페이지별 text 재추출과 `textCharacterCount` gate를 추가하고 번역 operation의 정확한 `expectedSha256` field를 prompt에 명시했다.
- 당시 `murataoverview` 6쪽 요청을 source worker에 그대로 재생해 6쪽·Pypdf 추출 3,552자와 PDF.js 전 페이지 한국어 재추출을 확인했다. PyInstaller frozen worker도 한글 파일명 생성→PDF.js 재추출을 통과했고, 빈 결과는 최종 commit 전 실패하며 staging만 제거하는 회귀 테스트를 추가했다.
- Actions run `31889692619`에서 v1.4.199 Windows 통합 검사, 번들 워커 한글 PDF 생성·재추출, package/sign과 draft 업로드가 성공했다. 설치본 241,453,112바이트의 GitHub SHA-256 `c5c74f7f873b53e5a578092740728b88a23dd13564c57f711839e876db8009c9`, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했다.
- v1.4.199 GUI 재실측에서 PDF extract는 성공했지만 Hermes message `4833`의 6쪽 `create_pdf` 응답 끝에 닫는 중괄호가 하나 더 있어 JSON parse 전에 거부됐다. delimiter 하나만 교정하면 번역문이 일부 text element 높이를 넘어 다음 단계에서도 실패하는 것을 확인했다. `cc680547f`에서 malformed envelope를 operation 실행 전 최대 두 번 모델에 교정시키고, PDF font/line-height를 원래 비율로 6pt까지 자동 맞춤한다. 해당 실제 응답은 6쪽·전 페이지 text·worker 4,909자로 생성됐고 반복 malformed 응답은 세 번째에 실행 없이 실패하는 테스트를 통과했다.
- Actions run `31891310064`에서 v1.4.200 Windows 통합 검사, 긴 한국어 본문의 번들 worker 자동 맞춤·재추출, package/sign과 draft 업로드가 성공했다. 설치본 241,454,176바이트의 GitHub SHA-256 `f628bd2b3533d21b13954ea949a3b0ee5696186488bbdce4c3db8bfe6e491c72`, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했다.
- v1.4.200 GUI에서 PDF→XLSX 후속 요청은 Hermes message `4847`이 `output.overwrite`를 생략하고 `validation.requiredSheets/requiredCells`, `preservationPolicy:new_workbook`, column/row/autofilter 별칭을 사용해 worker schema에서 거부됐다. 필드를 정규화한 뒤에는 schema가 허용한 단일 열 `range:"A"`를 XlsxWriter가 거부하는 두 번째 결함도 확인했다.
- `5d3ff1a9a`에서 정확한 v1 JSON 예시와 안전한 요청 정규화, 단일 열 `A:A` 렌더링, `fitToWidth/fitToHeight`, schema 오류의 sanitized 구조 반환을 추가했다. 같은 실제 6.8KB 요청을 frozen worker에 재생해 25행·3열 XLSX atomic commit과 OOXML 검증을 통과했고, openpyxl 재개방과 Orca 재추출 73셀에서 제목·유의사항을 확인했다.
- Actions run `31894410900`에서 v1.4.201 Windows 통합 검사, frozen worker의 visible PDF/XLSX 생성·재추출, package/sign과 draft 업로드가 성공했다. 설치본 241,457,680바이트의 GitHub·로컬 SHA-256 `365f780ebd64168e9f6ed29911d64e00779357819bd8a1150dc2c8f092f54cbd`, `latest.yml` SHA-512·크기·관리자 권한 플래그와 SAMWOO 내부 Authenticode 서명을 재검증했다.
- v1.4.201 설치본 GUI에서 "이 파일 번역해서 pdf랑 엑셀로 만들어 줘" 요청의 PDF extract는 성공했지만, GPT-5.6 Terra가 message `4853/4855/4857` 세 응답 모두 마지막 page 객체 뒤에 잉여 `}` 하나(`"}]}}]}}]}` tail)를 동일하게 재출력해 v1.4.200의 모델 교정 2회가 수렴하지 않고 `invalid local document envelope`로 종료되는 것을 서버 원문으로 확정했다.
- v1.4.202(`0f9ca9580`)에서 `hermes-local-envelope-json-repair.ts`를 신설해 4개 envelope 파서(file/document/command/Excel)가 구조적으로 불가능한 닫는 delimiter를 greedy 제거해 파싱하게 했고, Actions run `31896992503`의 package/sign·draft 업로드까지 성공했다. 그러나 공개 전 적대적 검토(3개 관점·검증 8 agent)에서 greedy 제거가 `[1}2]`→`[12]`처럼 스칼라 토큰을 접합해 없던 값을 만들 수 있고, 다의적 payload에서 임의의 재구성 해석을 고를 수 있음을 실코드 재현으로 확인해 v1.4.202 draft는 공개 보류했다.
- v1.4.203에서 교정을 강화했다: 닫는 delimiter 정확히 한 개를 삭제하는 후보 중 다음 토큰이 구조 문자인 위치만 고려하고(스칼라 접합 원천 차단), 파싱 가능한 복원 결과가 유일할 때만 채택하며(다의성 fail-closed), 후보 탐색은 64MB 작업 예산으로 제한한다. 잘린 JSON·문자열·값·필드는 바꾸지 않고 교정 후에도 기존 schema 검증을 그대로 통과해야 실행하며, host가 못 고치는 malformed는 기존 모델 교정 2회·세 번째 fail-closed 경로를 유지한다. 검토가 지적한 시험 공백(3개 파서 배선 고정, Excel 1MiB 게이트 선행 고정, 모델 교정 소진 경로의 truncated payload)도 회귀 테스트로 보강했다.
- 실제 실패 응답 3건을 parser·tool loop에 그대로 재생해 강화된 교정에서도 모두 유일 복원됨을 확인했고, message `4853`을 frozen worker로 실행해 6쪽 한국어 PDF(pypdf 4,313자·전 페이지 text layer·PDF.js 재추출)와 후속 round의 실제 message `4847` Excel envelope로 `murataoverview_ko.xlsx`(25행×3열·문자열 73셀·openpyxl 재개방·Orca 재추출 유의사항 확인)까지 순차 생성했다.
- 검증: CI 지정 Vitest 106개 파일 488개, TypeScript 3종, native/type-aware oxlint, reliability·max-lines·skill·localization 게이트, Python 서버 88개, frozen worker 재빌드와 production bundle smoke 통과.
- Actions run `31898326884`에서 v1.4.203 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,455,664바이트의 GitHub·로컬 SHA-256 `726b478d750168d39d0ccfea79e6c45c307768e4aa9d29b9c9edb4f3356ffffd`, `latest.yml` 버전 `1.4.203`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid, thumbprint `81316CB47930717E9EB6949430BD80C2F4E6166D`)을 독립 검증했다.
- v1.4.203 설치본 GUI 실측에서 murataoverview의 PDF extract→한국어 PDF 생성→XLSX 생성→PPTX 생성 순차 흐름이 정상 동작함을 실제 대화(message 4858~4871)로 확인했다. delimiter 교정 대상 재발 없이 첫 시도에 성공한 회차도 있었다.
- 같은 실측에서 대용량 ERP XLSX 첨부 2건이 새로 실패했다: `수주대비출고미납_260517.xlsx`(2.1MB, 시트 XML 16.8MB·415,176셀)는 in-process parser의 XML당 16MiB 상한으로 `worksheet Sheet1 is missing or too large`, `2026 거래명세서 품목조회 (~260531).xlsx`(1.5MB, 시트 XML 10.6MB·241,394셀)는 DOM·셀 map이 worker thread 256MB heap을 초과해 `JS heap out of memory`로 거부됐다.
- v1.4.204에서 `orca_xlsx_extraction.py`를 frozen worker에 추가하고 `hermes-local-document-xlsx-worker-extraction.ts`가 XLSX inspect/extract를 worker로 라우팅한다. worker는 ZIP 캡·압축 비율·macro/OLE/외부 relationship·DOCTYPE·SHA-256을 자체 검증한 뒤 openpyxl read-only 스트리밍으로 counts와 200셀 창을 반환하며(스캔 상한 800만 셀, 수식 cache는 필요 시 2차 스트리밍), main은 결과 shape를 재검증하고 capability가 없으면 기존 in-process parser로 fallback한다. 사용자에게 파일 분할·CSV 변환을 요구하지 않는다.
- 실제 실패 envelope 2건(message 4873·4877)을 artifact store와 frozen worker를 포함한 실제 tool loop에 재생해 415,176셀·241,394셀 inspect와 200셀 창 extract(nextCursor 포함)를 확인했고, 실측 1,827,148셀(66MB XML) 파일도 44초에 스캔됐다. typed 워크북(문자·천단위 숫자·백분율·날짜·불리언·수식 cache)으로 worker 경로와 in-process 경로의 valueType·text·numberFormat 일치도 검증했다.
- 검증: CI 지정 Vitest 107개 파일 495개, TypeScript 3종, native/type-aware oxlint, reliability·max-lines·skill·localization 게이트, frozen worker 재빌드와 production bundle smoke 통과.
- Actions run `31901626176`에서 v1.4.204 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,493,312바이트의 GitHub·로컬 SHA-256 `e32b278dff1217f0671cf51c5c57abba3568d50dd083b9d9b7736bbb51a47f47`, `latest.yml` 버전 `1.4.204`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid, thumbprint `81316CB47930717E9EB6949430BD80C2F4E6166D`)을 독립 검증했다. 계산 cache가 없는 수식(원문 유지)과 시트 경계를 넘는 cursor 창도 실증으로 확인했다.
- 관리자 GUI 실측(대용량 XLSX 분석 포함) 후 2026-08-16 `v1.4.204`를 공개 최신 릴리스로 전환했다. 공개 `latest.yml`이 버전 `1.4.204`·크기 `241493312`·`isAdminRightsRequired: true`를 반환하고 `/releases/latest`가 v1.4.204를 가리키는 것을 확인했다. 공개 보류된 v1.4.198~v1.4.203 draft는 이력 보존을 위해 삭제하지 않았고 draft 상태를 유지한다.
- v1.4.204 GUI 실측(session `25cff537`)에서 차트 포함 대시보드 생성이 message `4915`의 차트 별칭(`chartType`·공유 `categories`·series `{sheet,range}`·`position` 누락)으로 schema 거부, message `4917`은 수식 26개의 누락 시트 참조로 `formula.references` 검증 거부됐다. v3에서 성공했지만 모델이 차트를 포기한 결과였다.
- v1.4.205에서 차트 canonical 예시·수식 시트 참조 규칙을 prompt에 추가하고, 관측된 차트 별칭만 정규화(`chartType`→`type`, 공유 `categories` 배분, series `{sheet,range}`→`values`)했다. 충돌 값·x/y inch 좌표·`position` 누락은 계속 worker가 거부한다. `formula.references` 실패는 오탈 셀 주소·누락 시트명 상위 5개를 오류 메시지에 포함한다.
- 실제 message `4915` 별칭이 canonical 형식으로 정규화됨을 확인했고, `4919` spec에 `4915` 차트(+position)를 더한 요청으로 native chart 2개 포함 workbook commit을 확인했다.
- v1.4.205 draft(run `31920075943`) 공개 전 적대적 검토(10 agent)에서 확인된 결함 7건을 v1.4.206에서 수정했다: `_SHEET_REF` 정규식이 `=SUM(시트!범위)`를 시트명 "SUM(시트"로 오파싱해 **시트가 모두 있어도 검증 실패**하던 기존 결함을 openpyxl Tokenizer RANGE operand 추출로 교체(비수식 참조 텍스트는 기존 경로 유지), 검증 메시지의 셀 주소·시트명 항목별 절단으로 result schema 2048자 한도 파괴 차단, 누락 시트명 casefold 중복 제거, normalizer의 미소비 공유 `categories` 무단 삭제 제거(worker 거부로 회귀), 차트 create의 픽셀 width/height를 `set_size`로 실제 적용, 프롬프트에 subtype/legend/color 선택 필드 명시.
- 실제 message `4917`을 수정된 frozen worker에 재생한 결과 **71개 수식 전부 정상 파싱·completed·committed** — production에서 거부된 26건은 전부 정규식 오탐이었음을 확정했다. 진짜 누락 시트 케이스는 `(first: Summary!A1, Summary!A2); missing sheets: 누락데이터` 형식으로 실패함을 확인했다. 한글 unquoted 시트 참조(`=국가데이터!A1`) 감지도 새로 지원된다.
- 검증: CI 지정 Vitest 107개 파일 496개, TypeScript 3종, oxlint 3종, reliability·max-lines·localization, frozen worker 재빌드와 production bundle smoke 통과.
- Actions run `31921086693`에서 v1.4.206 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,496,856바이트의 GitHub·로컬 SHA-256 `311c5d34409350684f12a8db43ee4b631a471c25df405f377418abadb6f4532f`, `latest.yml` 버전 `1.4.206`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid, thumbprint `81316CB47930717E9EB6949430BD80C2F4E6166D`)을 독립 검증했다. 공개 보류된 v1.4.205 draft는 삭제하지 않았다.
- v1.4.206 GUI 실측(message 4928~4932, '시각화 참고 디자인' 대시보드)에서 `formats[0].fill`(색 문자열)·`freezePane`(셀 주소) schema 거부 2회 뒤 모델이 fill과 freeze를 포기한 채 성공하는 기능 손실을 확인했다. 재생 결과 숨은 3번째 결함도 드러났다: Data 시트 표 헤더의 중복 열 이름('지표' 2회) 때문에 XlsxWriter가 표를 경고만 내고 조용히 버려 `spec.tables`/`spec.autofilters` 검증이 모호한 메시지로 실패했다.
- v1.4.207에서 세 층을 함께 수정했다: ① main normalizer가 `fill` 색 문자열→`{color}` 객체, freezePane 셀 주소→`{row,column}` 개수를 정규화, ② worker의 모든 schema 거부 오류에 실패 지점의 기대 형태(허용 key·타입·enum, 240자 상한)를 자체 스키마에서 요약해 첨부 — 미래의 어떤 필드 오류든 한 라운드 교정이 가능해짐, ③ 표의 중복 열 이름과 셀 주소형 표 이름(XlsxWriter 무단 드롭 부류)을 spec 단계에서 정확한 사유·필드 경로로 조기 거부하고 `spec.tables`/`spec.autofilters` 실패 메시지에 어긋난 표·범위를 명시. prompt에는 formats/freezePane/merges/표 규칙의 정확한 형태를 추가했다.
- 실제 message `4928`을 재생해 raw 요청은 `Table 'CountryKPI' declares the duplicate column name '지표'` 조기 거부로, 헤더만 교정한 변형은 표 2·freeze 3·차트 2 포함 완주로 확인했다. 4915/4917/4919 재생과 CI 지정 Vitest 107개 파일 497개, TypeScript 3종, oxlint 3종, reliability·max-lines·localization, frozen worker 재빌드·production bundle smoke도 통과했다.
- Actions run `31927457875`에서 v1.4.207 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,506,552바이트의 GitHub·로컬 SHA-256 `7ada00a25ac39f57dd5d88dd653a941284a3d51dc34f9860901c3faaa0fc9de4`, `latest.yml` 버전 `1.4.207`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid)을 독립 검증했다. schema 힌트는 required(`position*` 표기)·type 목록·범위 초과 오류에서도 유효함을 실증했다.
- 알려진 낮은 위험 엣지: `showHeaderRow:false` 표에 첫 행 중복 값이 있으면 XlsxWriter가 여전히 표를 드롭하지만, 강화된 `spec.tables` 검증이 누락 표를 이름·범위로 지목해 조용히 지나가지 않는다. 다음 사이클에서 build 경로가 headerless 표에 columns 이름을 넘기지 않도록 수정 예정.
- v1.4.207 GUI 실측(message 4940~4944)에서 같은 요청이 `invalid or unsupported Excel Artifact envelope`로 실패했다. 원문 분석 결과 세 응답 모두 완전한 envelope 뒤에 꼬리 `}` 하나가 붙었고, flat 객체에서는 단일 삭제 다의성 규칙이 교정을 거부했다. 재생 과정에서 두 개의 추가 결함도 드러났다: 표 이름 pattern이 ASCII 전용이라 Excel이 허용하는 한글 표 이름(`국가별_증감_원본`)을 거부했고, 모델이 병합 범위(A5:D5·F5:I5) 내부 셀에 KPI 값·수식을 선언해 병합 시 소실→`spec.cells` 검증이 개수만 보고하며 실패했다.
- v1.4.208에서 세 결함을 수정했다: ① 완전한 JSON 값 + 순수 닫는 delimiter 꼬리는 값을 건드리지 않고 꼬리만 버리는 교정 규칙 추가(내부 결함은 기존 유일 복원 유지), ② 표·named range 이름 pattern을 유니코드 허용으로 확장(xlsxwriter·openpyxl 왕복 실증)하고 schema 힌트에 pattern 표시, ③ 병합 범위 안 anchor 아닌 셀의 내용 선언을 `Cell B5 declares content inside merged range A5:D5...` 형식으로 spec 단계 조기 거부. prompt에 병합 anchor 규칙을 추가했다.
- 실제 message `4940`을 재생해 꼬리 `}` 자동 제거→한글 표 이름 수용→중복 헤더 '구분' 정밀 거부→병합 삼킴 정밀 거부의 전체 체인을 확인했고, 헤더·병합만 교정한 변형은 한글 표 1개·차트 2개 포함 전체 검증 통과로 완주했다. 4915/4917/4919/4928 재생 회귀 없음. CI 지정 Vitest 107개 파일 497개, TypeScript 3종, oxlint 3종, reliability·max-lines·localization, frozen worker 재빌드·production bundle smoke 통과.
- v1.4.208 draft(run `31930565173`) 공개 전 적대적 검토(11 agent, 전부 실증 확인)에서 결함 7건을 확인해 v1.4.209에서 수정했다: TRUE/FALSE 이름의 표·named range가 검증을 통과하지만 **실제 Excel이 파일을 열지 못하는** 결함(실 Excel COM 실증), 유니코드 확장이 허용한 전각 숫자 셀 주소형 이름(`A１`)과 기존 RC형 이름(`R1C1`)을 XlsxWriter가 무단 드롭하는 결함 — 예약 이름 가드(TRUE/FALSE·R/C·A1형·RC형, 유니코드 `\d`)를 표·named range 양쪽에 적용해 조기 거부. hyperlink/comment만 있는 셀의 병합 삼킴 감지 추가, modify에서 기존 병합 내부 셀 기록 시 generic AttributeError 대신 정밀 오류(서식만은 허용), 역순 병합 범위 정규화, 병합 검사 작업량 상한(200만 비교), `spec.named_ranges` 실패 시 어긋난 이름 명시.
- 검토가 수용으로 판정한 항목: 꼬리 delimiter 교정이 내부-삭제 대안 해석보다 완전한 값 우선을 택하는 트레이드오프는 의도된 설계로 확인(37,200건 fuzz에서 기존 교정 회귀 0건, schema 검증이 계속 gate).
- 수정 실증: TRUE/FALSE·`A１`·`R1C1`·`r2c10` 조기 거부, 정상 이름(`CountryKPI`·`국가별_증감_원본`·`표1`) 통과, hyperlink 병합 삼킴·역순 범위 거부, modify 서식만 허용·값은 정밀 거부. 실제 재생 4종(4915·4917/4919·4928·4940 체인) 회귀 없음, CI 지정 Vitest 107개 파일 497개·전 게이트·frozen worker 재빌드·bundle smoke 통과.
- Actions run `31931592709`에서 v1.4.209 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,511,296바이트의 GitHub·로컬 SHA-256 `1e616371d96406ff23a40da9a906efb84326e40ec83efb6bf9a7dc7f10c3674c`, `latest.yml` 버전 `1.4.209`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid)을 독립 검증했다.
- v1.4.209 GUI 실측(message 4950~4956)에서 대시보드가 **세 번째 시도에 처음으로 완주**됐다(차트·연동 수식 포함 commit). 중간 실패 2건 분석: ① conditionalFormats의 OOXML식 별칭(`type:"cellIs"`, 숫자 `formula`)이 schema에서 거부 — 힌트("type string")로 모델이 회복했으나 프롬프트에 형태 안내가 없었음, ② 선언된 빈 문자열 `""` 셀을 엔진이 빈 셀(None)로 쓰면서 `spec.cells` 검증이 "1 cell differ" 개수만 보고 — 모델이 E1을 추측 제거로 회복.
- v1.4.210에서 마무리했다: conditionalFormats 별칭 정규화(`cellIs`→`cell`, `value` 부재 시 숫자/불리언 `formula`→`value`)와 canonical 예시 prompt 추가, `_literal_matches`에 선언 `""`≡빈 셀 동치 추가, `spec.cells`/`spec.merges`/`spec.freeze_panes` 실패 메시지에 어긋난 셀·범위·시트를 선언값 vs 기록값과 함께 명시(각 5개 상한·절단).
- 실제 message `4950`(1차 시도)을 수정된 worker에 재생한 결과 **재시도 없이 첫 시도에 completed·committed**(차트 2개) — GUI에서 3라운드 걸린 요청이 1라운드로 단축된다. 재생 5종 회귀 없음, CI 지정 Vitest 107개 파일 498개·전 게이트·frozen worker 재빌드·bundle smoke 통과.
- Actions run `31937633784`에서 v1.4.210 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다. 설치본 241,519,664바이트의 GitHub·로컬 SHA-256 `14d58a21963d5b0c67fa5e6c6e95407f0f7446e8846d739d4932b122691c05a7`, `latest.yml` 버전 `1.4.210`·크기·SHA-512·`isAdminRightsRequired: true`와 SAMWOO 내부 Authenticode 서명(Valid)을 독립 검증했다.
- 관리자가 2026-08-16 `v1.4.210`을 공개 최신 릴리스로 전환했다. `/releases/latest`가 v1.4.210을 가리키고 공개 `latest.yml`이 버전 `1.4.210`·크기 `241519664`·`isAdminRightsRequired: true`를 반환함을 확인했다. v1.4.204는 공개 유지, v1.4.205~v1.4.209 draft는 이력 보존을 위해 삭제하지 않았다.
- v1.4.210 설치본에서 native picker나 Explorer로 선택한 PNG/JPEG가 main private artifact store에는 정상 입장했지만, 후속 SSH 전송이 붙여넣기 전용 `orca-paste-*.png` 임시 경로만 허용해 `허용되지 않은 이미지 첨부 경로`로 거부되는 회귀를 확인했다.
- `fdaf99a27`에서 선택형 이미지는 private path를 노출하지 않고 `(artifactId, conversationId, requestId)`로 `artifactStore.read()`해 hash·size를 재검증한 뒤 전송하도록 수정했다. 붙여넣기 이미지의 기존 temp-root·파일명·누적 크기 제한은 그대로 유지하고 JPEG 원격 확장자는 `.jpg`로 보존했다.
- 회귀 테스트를 포함한 focused Vitest 5개 파일 26개, TypeScript 3종, oxlint 3종, max-lines·reliability·localization 게이트를 통과했다. Actions run `31944744288`에서 v1.4.211 Windows 통합 검사, frozen worker 빌드, package/sign과 draft 업로드가 성공했다.
- 설치본 241,514,072바이트의 GitHub·로컬 SHA-256 `949dc6d694fdcc63b56bc864dfb8a437df95c68700ddf63dd236072822fd9248`, `latest.yml` 버전 `1.4.211`·크기·SHA-512·`isAdminRightsRequired: true`, blockmap 자산과 SAMWOO 내부 Authenticode 서명(Valid, thumbprint `81316CB47930717E9EB6949430BD80C2F4E6166D`)을 독립 검증했다.
- 관리자가 2026-08-16 `v1.4.211`을 공개 최신 릴리스로 전환했다. 비인증 GitHub `/releases/latest` API와 공개 update manifest가 `v1.4.211`을 반환하고 설치기·blockmap·`latest.yml` 세 자산 URL이 모두 HTTP 200이며, 공개 설치기 streaming SHA-256·크기와 manifest SHA-512가 draft 검증값과 일치함을 확인했다.
- 현재 stable-semver 서명 릴리스 절차로 대체된 `samwoo-windows-<SHA>` unsigned prerelease 16개와 대응 태그를 삭제해 미사용 자산 48개·3,008,066,937바이트를 정리했다. 회귀·검증 이력으로 명시된 draft 14개와 공개 stable 릴리스는 보존했다.
- v1.4.212의 exact `ai_center` ACP local-files rollout이 native file/terminal을 켜는 대신 Excel Artifact capability와 outer tool loop를 함께 꺼, 번들 openpyxl/XlsxWriter가 정상이어도 원격 XLSX skill이 패키지 없는 사용자 `py.exe`로 우회하는 회귀를 만들었다. v1.4.215의 LibreOffice 시각 preview 변경과는 별개다.
- 2026-08-19 수정은 ACP native file/terminal을 유지하면서 native-local project에만 Excel Artifact capability·prompt·결과 roundtrip을 같은 persistent ACP session에 복구한다. WSL/SSH/Runtime은 차단하고 Excel envelope 외 legacy Orca envelope는 fail-closed한다. Team Chat 진입 때 bundle probe를 background prewarm하며, 첨부 block과 project Office preview가 수정 입력용 SHA-256을 제공한다. 사용자 Python·pip·직접 soffice는 사용하지 않는다.
- native picker는 HTML/HTM과 예약 binary 확장자를 제외한 임의 strict UTF-8·NUL-free 파일을 96KB 한도에서 받고, 같은 handle의 bounded read로 교체·증가 race를 방어한다. Word `.doc`/`.docx`는 미지원임을 거절 안내에 명시한다.
- UI는 최종 transport/agent turn 결과와 중간 tool attempt를 분리해 `응답 완료 · 중간 오류 기록 있음`, `응답 실패`, `응답 중단`으로 표시한다. Hermes 관련 41개 test file 219건(1건 skip), Node/Web/CLI typecheck, changed-file native/type-aware lint, localization 3종, reliability·max-lines gate가 통과했다. 전체 `pnpm test`는 로컬 Corepack 환경에서 native-runtime bootstrap이 전역 `pnpm.cmd`를 찾지 못해 test 진입 전에 중단됐고 패키지 GUI 실측은 남아 있다.
- Actions run `32210279875`가 신규 회귀 테스트를 포함한 Windows 통합 검사, 앱·frozen worker 빌드, LibreOffice 포함 내부 서명 NSIS 패키징과 자산 검증을 통과했다. `v1.4.216` 설치기 978,921,032바이트·SHA-256 `d191d278a0c12d4ec1b5b634a9b85676dd3c57eca45234ada5b4abb7ff20cc36`, blockmap과 `latest.yml`을 공개했고 latest tag·manifest 버전·대상 commit `480356154`를 확인했다. 설치본 GUI smoke는 사용자가 후속 수행한다.
