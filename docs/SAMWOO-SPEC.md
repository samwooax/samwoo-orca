# SAMWOO-ORCA SPEC — 단일 진실 문서

> 이 문서가 제품 결정·아키텍처·작업 대기열·검증 기준의 **단일 진실(source of truth)**이다.
> 코덱스(구현)와 Claude(설계·검증) 모두 작업 전 이 문서를 읽는다. 대화·지시서와 이 문서가 충돌하면 **이 문서가 우선**한다.
> 갱신 규칙: 제품 결정·설계 변경은 Claude가 반영하고, 구현 완료 기록(커밋 해시)은 코덱스가 작업 로그에 추가한다.
> 최종 갱신: 2026-08-08

## 1. 제품 성격 (모든 판단의 기준)

- 사내 전용 협업 도구: 공유 워크스페이스(Nextcloud) + 프로필 메신저 + Hermes AI 팀봇 + 메일 연동
- 사용자: 비개발 직원 다수 포함, 목표 동시 접속 ~100명
- 네트워크: Tailscale 폐쇄망, 서버 = VPS 1대(samwoo-auth, Python 표준 라이브러리만) + Hermes 봇 호스트
- upstream(Orca) 포크: 커스텀 코드는 samwoo-*, hermes-*, workspace-hub 파일에 격리. 공용 파일 수정 최소화
- 과설계 금지: Kafka·Redis·클러스터·풀 메일 클라이언트 등은 도입하지 않는다 (확장 트리거: 동시 300명↑ 시 PostgreSQL+멀티 워커 검토)

## 2. 확정된 제품 결정 (결정 로그)

| 날짜 | 결정 | 근거 |
|---|---|---|
| 08-08 | **Tasks(작업) 탭 사이드바 렌더 제거 확정** — 복원 금지, 코드·openTaskPage() 내부 경로는 보존 | GitHub 연동 미사용. 검증 게이트는 이를 "기능 차단"이 아닌 의도된 변경으로 판정할 것 |
| 08-08 | 워크스페이스 허브 = 메인 페이지 (다이얼로그 폐지) | 협업 단위가 워크스페이스이므로 승격 |
| 08-08 | 메신저 = 사이드바 독립 메뉴 + **전용 팝아웃 창** (다이얼로그 폐지) | 팀 채널이 워크스페이스에 종속되지 않음, 나란히 놓고 작업 |
| 08-08 | 메신저 첨부파일 기능 보류 | 파일 공유는 워크스페이스가 담당 |
| 08-08 | 프레즌스(온라인 표시) 포함, 타이핑 표시 후속 | SSE 연결로 저비용 구현 가능 |
| 08-08 | 실시간 = SSE (WebSocket 아님), 폴링은 fallback으로 유지 | 표준 라이브러리 서버에 이식 용이, 하위 호환 |
| 08-08 | 엔드포인트는 `src/shared/samwoo-service-endpoints.ts` 중앙화, Tailscale IP 직접 사용 | 관리 Windows PC에서 MagicDNS 해석 실패 이력 |
| 08-08 | 봇의 대화·메일 접근 = 사용자 토큰 온디맨드 조회 (프롬프트 상시 주입 금지) | 프로필 격리 자동 적용, 컨텍스트 비대화 방지 |
| 08-08 | 메일 첨부는 서버 내부 IMAP→Nextcloud 직행 (바이너리가 봇·앱 통과 금지) | 토큰 낭비·유출 방지 |
| 08-08 | 예약 자동화(5차)는 위임 토큰 설계 후 진행 | 세션 토큰 8h TTL로는 예약 실행 불가 |
| 08-08 | 담당자·마감일·작업 항목은 2단계 (멤버 목록 API 필요) | 서버 확장 필요, 1단계와 분리 |

## 3. 아키텍처 현황

- **인증/메신저/워크스페이스 API**: `http://100.116.18.119:8823` (Tailscale) — 정의는 `samwoo-service-endpoints.ts`
- **대화 DB**: VPS `/opt/samwoo-auth/workspace-shares.db` (SQLite WAL, busy_timeout=5000). 일일 백업 스크립트 `backup-workspace-db.sh` (14일 보관, cron 등록은 배포 시)
- **실시간**: `GET /events` SSE (프로필 격리, 하트비트 25s, 토큰 만료 시 expired 이벤트). 인프로세스 pub/sub = `profile_event_stream.py`
- **전송 멱등성**: `clientMessageId` + 부분 유니크 인덱스
- **파일 저장**: Nextcloud WebDAV (서버 경유, ETag 조건부 쓰기, 파일당 16MiB)
- **봇**: `hermes@100.68.242.83` SSH, 세션 토큰이 $MAILTOKEN으로 봇 셸에 전달됨
- **앱 알림**: 백그라운드 30초 폴링(SSE 도입 후 강등 예정) → OS 알림 + 독 뱃지. 첫 폴링 무음, 폴링당 최대 3건
- **주의(클라이언트 편에서 처리)**: SSE message 이벤트의 `isAuthor`는 발신자 기준 — 수신측은 authorLogin 비교로 재계산

## 4. 작업 로그 (완료 = 검증됨 + 커밋)

| 커밋 | 내용 |
|---|---|
| 2b0fd4eec | 엔드포인트 중앙화 + keep-alive/재시도 HTTP 클라이언트 |
| e1d93461e | 서버 쿼리 최적화 + 문서 IP 마스킹 |
| ea63521ff | 메신저 OS 알림·독 뱃지 + 서버 연결 상태 표시등 |
| cda008945 | 서버: WAL·락 제거·SSE·프레즌스·멱등 전송·백업 |
| 33669d21e | 파일 싱크 테스트 픽스처 수정 (transport 리팩터 여파) |
| f5d9455e9 | 워크스페이스 허브 1단계 (Tasks 탭 렌더 제거 포함) |
| 41c17119e | 메신저 팝아웃 창 + 채팅 UI 리디자인 |
| 7560f368c | React Doctor 채널 전환 상태 리셋 수정 |
| 478aa31dc | 메일 첨부 → 워크스페이스 서버 직행 파이프라인 |

## 5. 대기열 (순서 고정, 한 번에 하나)

1. **React Doctor 2건 수정** — ProfileMessengerWindow 채널 전환 effect 리셋 제거 (빌드 전 필수)
2. **4차: 메일 첨부 파이프라인** — `INSTRUCTIONS-mail-attachment-pipeline.md`
3. **클라이언트 편: SSE 수신·전송 큐·프레즌스** — `INSTRUCTIONS-messenger-scale-client.md` (실측 검증만 서버 배포 후)
4. **3차: 봇 대화 맥락 + 검색 엔드포인트** — `INSTRUCTIONS-hermes-message-context.md`
5. **5차: 예약 자동화** — 위임 토큰 설계 포함, 지시서 미작성 (4차 검증 후 Claude가 작성)
6. **2단계 허브**: 담당자·마감일·작업 항목 + `/profile/members` API — 지시서 미작성

보류/폐기: `INSTRUCTIONS-sidebar-board-nav.md`(허브로 대체), 메신저 첨부(결정 로그 참조)

## 6. 검증 기준 (감사·게이트 판정 시 준수)

- Tasks 탭 접근 제거 = **의도된 변경** (회귀 아님)
- upstream 포크 특성상 원래 실패하는 테스트(앱 ID·업데이트 URL 기대값, Windows 아이콘, askpass, CLI 설치 명령, dev 업데이트 설정)는 회귀로 판정하지 않는다
- 각 단계 완료 조건: 해당 지시서의 검증 항목 + TypeScript 3종 + oxlint + max-lines ratchet + i18n coverage
- 서버 변경 시: 기존 폴링 API 하위 호환 필수, 외부 Python 의존성 추가 금지
- lint disable 주석으로 게이트를 덮는 것 금지 — 패턴 자체를 고친다

## 7. 공통 금지 사항

- `max-lines` disable/예외 추가 금지
- 새 색상값·폰트 크기·그림자 발명 금지 — `main.css` 토큰 + shadcn 프리미티브만 (STYLEGUIDE.md)
- `deploy/install.ps1` 열람·출력·커밋 금지
- 크로스 플랫폼(macOS/Linux/Windows)·SSH 실행 환경 고려 (AGENTS.md)
- 사용자 변경 임의 reset/revert 금지, 빌드·배포는 명시 지시 시에만
- 봇 프롬프트에 대화·메일 원문 상시 주입 금지

## 8. 배포 대기 사항 (사용자가 시점 결정)

- VPS: 서버 편(WAL·SSE) + 4차(첨부) 모듈 업로드 + `/events` 라우팅 + ThreadingHTTPServer 확인 + 백업 cron — 절차는 `server/samwoo-auth/README.md`
- Hermes 호스트: 스킬 문서 배포 (3차·4차 이후)
- Windows 빌드: React Doctor 수정 후 가능. `.github/workflows/build-samwoo-windows.yml` 사용, 릴리스는 초안 → 해시 확인 후 공개
