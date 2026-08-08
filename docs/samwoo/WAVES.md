# SAMWOO-ORCA WAVES — 실행 계획 문서

> 역할 분담: **`docs/samwoo/SPEC.md` = 무엇을·왜 (제품 결정·아키텍처·상태·기준)** / **이 문서 = 어떻게·언제 (웨이브별 실행·상태 추적)**.
> 갱신 규칙: 웨이브 상태·완료 커밋은 코덱스가 작업 완료 시 갱신. 새 웨이브 추가·범위 변경은 Claude(검증자)가 반영.
> 완료된 웨이브의 상세 지시서는 `_claude-proposals/archive/`로 이동한다 (파일명 유지).
> 최종 갱신: 2026-08-09

## 웨이브 현황판

| Wave | 이름 | 상태 | 완료 커밋 |
|---|---|---|---|
| W1 | 기반 — 알림·연결 표시등·엔드포인트 중앙화 | ✅ 완료 | 2b0fd4eec, e1d93461e, ea63521ff |
| W2 | 구조 — 허브 페이지·메신저 팝아웃 창·UI | ✅ 완료 | f5d9455e9, 41c17119e, 7560f368c, 33669d21e |
| W3a | 실시간 서버 — WAL·SSE·멱등·백업 | ✅ 완료 (배포 대기) | cda008945 |
| **W3b** | **실시간 클라이언트 — SSE 수신·전송 큐·프레즌스** | ✅ **구현 완료 (배포·실측 대기)** | c87cdf8d4 |
| W3c | VPS 배포·실측 (W4b 모듈 포함 통합 배포, 담당: 사용자+Claude) | 대기 | — |
| W4a | 봇 메일 첨부 파이프라인 (서버) | ✅ 완료 (배포 대기) | 478aa31dc |
| W4b | 봇 대화 맥락·검색 API + 스킬 배포 | ✅ 구현 완료 (통합 배포 대기) | 7289d7769 |
| W5 | 예약 자동화 — 위임 토큰·크론 등록 스킬 | 설계 대기 (W4b 후 Claude가 지시서 작성) | — |
| W6 | 허브 2단계 — /profile/members·담당자·마감일·작업 항목 | 설계 대기 | — |

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

### W6 — 허브 2단계 (지시서 미작성)
- `/profile/members` API → 담당자 지정(팝오버 1개 재사용, 워크스페이스 복수·작업 항목 1명) → 마감일 → work_items 테이블
- 디자인 확정본: `_claude-proposals/workspace-hub-design.png`, `assignee-picker-preview.png`

## 폐기·보류
- 완료·폐기 지시서는 전부 `_claude-proposals/archive/`에 있음 — 참조 금지 (이력 보존용)
- 메신저 첨부 — 제품 결정으로 보류 (SPEC 13절)
- 협업 폴더 구조·규약: `_claude-proposals/README.md`
