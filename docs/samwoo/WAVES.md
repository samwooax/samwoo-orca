# SAMWOO-ORCA WAVES — 실행 계획 문서

> 역할 분담: **`docs/samwoo/SPEC.md` = 무엇을·왜 (제품 결정·아키텍처·상태·기준)** / **이 문서 = 어떻게·언제 (웨이브별 실행·상태 추적)**.
> 갱신 규칙: 웨이브 상태·완료 커밋은 코덱스가 작업 완료 시 갱신. 새 웨이브 추가·범위 변경은 Claude(검증자)가 반영.
> 완료된 웨이브의 상세 지시서는 `_claude-proposals/archive/`로 이동한다 (파일명 유지).
> 최종 갱신: 2026-08-09

## 웨이브 현황판

| Wave | 이름 | 상태 | 완료 커밋 |
|---|---|---|---|
| W1 | 기반 — 알림·연결 표시등·엔드포인트 중앙화 | ✅ 완료 | 2b0fd4eec, e1d93461e, ea63521ff |
| W2 | 구조 — 허브 페이지·메신저 팝아웃 창·UI | ✅ 완료 | f5d9455e9, 41c17119e, 7560f368c, 33669d21e, 3045382b5 (W2c) |
| W3a | 실시간 서버 — WAL·SSE·멱등·백업 | ✅ 완료 (배포 대기) | cda008945 |
| **W3b** | **실시간 클라이언트 — SSE 수신·전송 큐·프레즌스** | ✅ **구현 완료 (배포·실측 대기)** | c87cdf8d4 |
| W3c | VPS 배포·실측 (W4b 모듈 포함 통합 배포, 담당: 사용자+Claude) | 대기 | — |
| W4a | 봇 메일 첨부 파이프라인 (서버) | ✅ 완료 (배포 대기) | 478aa31dc |
| W4b | 봇 대화 맥락·검색 API + 스킬 배포 | ✅ 구현 완료 (통합 배포 대기) | 7289d7769 |
| W5 | 예약 자동화 — 위임 토큰·크론 등록 스킬 | 설계 대기 (W4b 후 Claude가 지시서 작성) | — |
| W6a | 프로필 멤버 디렉터리·메신저 실명 표시 | ✅ 구현 완료 (배포·실측 대기) | f4d4df553 |
| W6b | 허브 2단계 — 담당자·마감일·작업 항목 | ✅ 구현 완료 (배포·실측 대기) | — |
| W7 | 빌드 준비 — 핵심 테스트 배선·CI 범위·버전 | ✅ 완료 | 27fb634d4, v1.4.183 준비 |
| W8 | Windows 빌드·검증·공개 | ✅ 완료 | v1.4.183, run 31304436692 |

## 웨이브 상세

### W3b — 실시간 클라이언트 (구현 완료, 배포·실측 대기)
- 지시서: `_claude-proposals/waves/W3b-messenger-scale-client.md`
- 구현: main 프로세스 단일 SSE 수신·지수 백오프 재연결, 폴링 fallback, `clientMessageId` 전송 큐(pending→확정·자동 재시도·수동 재전송), `onlineLogins` 프레즌스 상태·표시
- 안전장치: SSE 이벤트의 `isAuthor`를 수신 사용자 기준으로 재계산하고, 연결이 끊기면 프레즌스 UI를 숨긴다.
- 검증: focused Vitest 18개, TypeScript, oxlint·React 규칙, max-lines, i18n 게이트 통과. 운영 `/events` 배포 후 1초 내 수신·2계정 프레즌스 실측은 W3c로 이월

### W3c — VPS 배포·실측 (코덱스 범위 아님)
- 체크리스트: `_claude-proposals/deploy/W3c-vps-deploy-checklist.md` (ThreadingHTTPServer 0순위, W3a·W4a·W4b 모듈과 Hermes 스킬 통합 반영, /events 확인, 백업 cron, 타임아웃 재실측, 실계정 첨부·메시지 요약·2계정 실측)

### W4b — 봇 대화 맥락·검색 (구현 완료, 통합 배포 대기)
- 지시서: `_claude-proposals/waves/W4b-hermes-message-context.md`
- 구현: 프로필 격리·LIKE 리터럴 이스케이프·안정적 커서를 적용한 `/profile-messages/search`, 온디맨드 조회 전용 `samwoo-messages` 스킬, 팀 채팅 세션 접근 안내
- 검증: 검색 경계 테스트를 포함한 Python 서버 테스트 65개, TypeScript, oxlint, i18n, max-lines 게이트 통과
- 배포: 서버 모듈과 Hermes 호스트의 mail·messages 스킬을 W3c에서 한 번에 반영하고 실계정 요약·타 프로필 차단을 확인한다.

### W5 — 예약 자동화 (지시서 미작성)
- 선행 설계: 예약 작업용 위임 토큰 (범위 제한: 메일 읽기+지정 워크스페이스 쓰기+메신저 전송, 폐기 가능, 장수명)
- 크론 등록/조회/삭제 스킬 + 등록 전 사용자 확인 가드레일 + 결과의 워크스페이스 저장·메신저 통지

### W6a — 프로필 멤버 디렉터리·메신저 실명 표시 (구현 완료, 배포·실측 대기)
- 지시서: `_claude-proposals/waves/W6a-profile-directory-real-names.md`
- 구현: VPS 런타임 CSV 이중 원천·mtime 캐시, 토큰 프로필 기반 `/profile-members/list`, 메시지·답장·채널·알림·프레즌스 표시명 fallback
- 경계: login 식별과 기존 Hermes 프로필·에이전트 표기는 유지하며 실명은 메신저에서만 사용한다. 직원 명단은 Public 저장소에 두지 않는다.
- 검증: Python 서버 전체 72개, focused Vitest 16개, TypeScript 3종, oxlint·React 규칙, max-lines, i18n 게이트 통과. 실제 VPS CSV·핫 리로드·2계정 실측은 W3c로 이월

### W6b — 허브 2단계 (구현 완료, 배포·실측 대기)
- 담당자: `/profile-members/list` 기반 login 복수 선택 팝오버, 프로필 격리 중앙 저장, 소유자·기여자 변경 권한, 목록·상세 표시와 변경 이력을 구현했다. 신규 할당은 SSE로 OS 알림과 워크스페이스·Dock/작업표시줄 배지에 반영하며, 직원 실명은 기존 결정대로 메신저에서만 사용한다.
- 마감일: 중앙 공유 메타데이터 저장, 소유자·기여자 변경 권한, 날짜·감사 정보 검증, 상세 패널 지정·해제와 목록·보드 표시, 지난 날짜 강조를 구현했다.
- 작업 항목: 공유별 중앙 테이블, 소유자·기여자 변경 권한, 생성·완료 체크와 작업별 프로필 멤버 1명 지정·해제, 상세 패널 15초 갱신과 목록·보드 진행률을 구현했다.
- 빌드·운영 실측은 대기한다.
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

## 폐기·보류
- 완료·폐기 지시서는 전부 `_claude-proposals/archive/`에 있음 — 참조 금지 (이력 보존용)
- 메신저 첨부 — 제품 결정으로 보류 (SPEC 13절)
- 협업 폴더 구조·규약: `_claude-proposals/README.md`
