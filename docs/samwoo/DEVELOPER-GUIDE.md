# SAMWOO-ORCA 개발자 가이드

> 새로 합류한 개발자·에이전트가 이 저장소에서 안전하게 작업을 시작하기 위한 온보딩 문서다.
> 제품 결정·운영 상태·제한값은 [SPEC.md](./SPEC.md), 실행 경로·상태 소유권은 [../ARCHITECTURE.md](../ARCHITECTURE.md)가 단일 진실이며, 이 문서는 그 입구 역할만 한다. 내용이 충돌하면 SPEC과 ARCHITECTURE가 우선한다.

## 1. 이 프로젝트가 무엇인가

SAMWOO-ORCA는 **upstream Orca**(stablyai/orca — AI CLI 에이전트용 Electron IDE)를 fork하여 **삼우 사내 협업 기능**을 얹은 데스크톱 앱이다. 코드는 크게 두 층이다.

| 층 | 내용 | 위치 |
|---|---|---|
| upstream Orca | 에이전트 병렬 실행, Git worktree, 터미널, 편집기, 내장 브라우저, SSH/WSL | `src/` 대부분 |
| SAMWOO 커스텀 | 로그인·세션, Hermes AI 팀 채팅, 워크스페이스 공유(Nextcloud), 프로필 메신저, 회사 메일, Windows 사내 배포 | `src/**/samwoo-*`, `src/**/hermes-*`, `src/renderer/**/workspace-hub/`, `server/samwoo-auth/`, `deploy/` |

핵심 원칙: **SAMWOO 코드는 upstream 기능을 대체하지 않고 추가하며, upstream과 격리된 이름·경로를 쓴다.** 이는 upstream 버전 추종(rebase)을 계속 가능하게 하기 위함이다.

주 사용자는 비개발 직원 포함 사내 약 100명, 기준 배포 플랫폼은 Windows다. 단 upstream의 macOS·Linux·WSL·SSH 호환은 유지해야 한다.

## 2. 반드시 읽을 문서 (순서대로)

1. 루트 [AGENTS.md](../../AGENTS.md) — 코딩 규칙·크로스플랫폼 원칙
2. [SPEC.md](./SPEC.md) — 제품 결정·아키텍처·운영 상태·보안 경계·검증 기준
3. [WAVES.md](./WAVES.md) — 웨이브별 실행 현황과 다음 작업
4. [../ARCHITECTURE.md](../ARCHITECTURE.md) — 프로세스 경계·식별자·상태 소유권·불변 조건
5. UI 작업 시 [../STYLEGUIDE.md](../STYLEGUIDE.md) — 토큰은 `src/renderer/src/assets/main.css`, 컴포넌트는 `src/renderer/src/components/ui/`

## 3. 저장소 지도

| 경로 | 역할 |
|---|---|
| `src/main/` | Electron main — 권한 작업의 소유자. IPC, Store, Runtime, provider, PTY daemon, SSH |
| `src/main/ipc/` | renderer→main 권한 요청과 SAMWOO/Hermes 확장 IPC |
| `src/main/runtime/` | Runtime 상태 그래프와 RPC(웹·모바일·CLI가 붙는 경계) |
| `src/main/providers/` | 로컬·SSH 파일/Git/PTY 구현과 capability routing |
| `src/preload/` | renderer에 노출하는 typed IPC bridge (`window.api`) |
| `src/renderer/src/` | React + Zustand 데스크톱 UI. 권한 작업은 직접 못 하고 IPC로 요청만 한다 |
| `src/shared/` | main/renderer/CLI 공용 타입·schema. 특히 `execution-host.ts`, `workspace-scope.ts`, `samwoo-service-endpoints.ts` |
| `src/cli/` | `orca` CLI |
| `src/relay/` | SSH 대상 호스트에 업로드되는 relay 번들 |
| `server/samwoo-auth/` | 인증·워크스페이스·메신저·메일 **서버 확장 모듈**(VPS 배포 대상). 서버 본체는 저장소에 없다 |
| `deploy/` | Windows 설치 키트 소스. **`deploy/install.ps1`은 비밀 포함 가능 — 열람 금지** |
| `config/` | 빌드·패키징·lint·릴리스 스크립트 |
| `docs/samwoo/` | 삼우 문서 허브. **이 폴더 밖 docs/는 upstream 소유 — 이동·임의 수정 금지** (ARCHITECTURE·STYLEGUIDE는 규칙에 따라 갱신) |
| `_claude-proposals/` | Claude×Codex 협업 폴더(미추적). 작업 지시는 `NEXT-PROMPT.txt` |

## 4. 개발 환경 준비

- **Node 24** (`engines` 기준), 패키지 매니저는 **pnpm 10.24** (`packageManager` 필드 — `corepack enable`로 활성화 가능).
- `pnpm install` 후 `postinstall`이 native 의존성(node-pty 등)을 Electron용으로 재빌드한다.
- pnpm이 PATH에 없는 PC에서는 `corepack pnpm ...` 또는 `node_modules\.bin\vitest.CMD`·`tsc`·`oxlint` 직접 호출로 대신할 수 있다.
- Hermes 문서 도구를 만질 때만: frozen Python worker는 `resources/hermes-excel-artifact-worker/win32-x64/`(git-ignored)에 있으며 `node config/scripts/build-hermes-excel-artifact-worker.mjs`로 재빌드한다. bundle smoke는 electron-vite 빌드(`out/`)와 frozen worker가 **둘 다** 있어야 한다 — 동시에 재빌드하면 race로 실패한다.

### 실행

| 명령 | 용도 |
|---|---|
| `pnpm dev` | Electron 앱 개발 실행 (HMR) |
| `pnpm dev:web` | 웹 클라이언트 개발 서버 |
| `pnpm start` | 빌드 결과물 preview 실행 |

### 검사·테스트

| 명령 | 용도 |
|---|---|
| `pnpm tc` | TypeScript 검사 (node/cli/web 세 프로젝트) |
| `pnpm lint` | oxlint + 코드 품질·max-lines ratchet·i18n coverage 등 게이트 일괄 |
| `pnpm test` | vitest 단위·통합 테스트 |
| `pnpm test:e2e` | Playwright Electron e2e |
| `node config/scripts/audit-localization-coverage.mjs --check` | i18n coverage 게이트 (verify-localization-coverage.mjs가 아님) |

기능 변경은 최소한 **focused test + `tc` + oxlint + max-lines ratchet + i18n coverage**를 통과해야 한다(SPEC §16).

## 5. 아키텍처 핵심 — 이것만은 틀리지 말 것

상세는 ARCHITECTURE.md. 요약하면:

1. **Renderer는 화면만 소유한다.** 파일·프로세스·Git·SSH는 Electron main과 그 아래 provider의 소유다. 새 권한 기능은 main에 구현하고 preload IPC로 노출한다.
2. **AI 모델은 내장이 아니다.** Codex·Claude Code 등은 PTY 안의 외부 CLI 프로세스이며 Orca는 오케스트레이터다. Hermes 팀 채팅도 시스템 `ssh`로 원격 실행한다.
3. **상태 소유자가 계층마다 다르다.** 영속 설정·repo는 main `Store`, 화면 상태는 renderer Zustand, 원격 클라이언트 공개 상태는 `OrcaRuntimeService`, 로컬 셸·스크롤백은 PTY daemon, 원격 셸은 SSH relay. 기능을 붙일 때 올바른 소유자에 연결한다.
4. **식별자를 혼동하지 않는다.** 새 기능은 최소한 **execution host ID**(`local` / `ssh:<id>` / `runtime:<id>`)와 **workspace scope**(`worktree:<id>` / `folder:<id>`)를 함께 전달한다. 경로 문자열만 보고 "로컬 Git worktree"라고 가정하면 folder workspace·SSH·paired runtime 중 하나가 깨진다.
5. **relay는 두 종류다.** SSH 실행용 relay(`src/relay/`)와 모바일·웹용 cloud relay는 이름만 비슷한 별개 시스템이다.
6. **SAMWOO 서버는 저장소 밖 운영 의존성이다.** 서비스 주소는 반드시 `src/shared/samwoo-service-endpoints.ts` 중앙 정의를 거친다.

## 6. 코딩 규칙 요약 (AGENTS.md 전문 참조)

- **크로스플랫폼**: macOS·Linux·Windows 모두 지원. `e.metaKey` 하드코딩 금지(플랫폼 체크), 경로는 `path.join`, 단축키 라벨은 `⌘`/`Ctrl+` 분기. SAMWOO 코드도 특정 OS·경로 구분자를 가정하지 않는다.
- **SSH·folder workspace를 항상 고려한다.** 로컬 전용·git worktree 전용 가정 금지.
- **Git 호환**: 사용자 Git은 native/WSL/SSH마다 버전이 다르다. Git 2.25 baseline, 신기능은 fallback과 `GitCapabilityCache`. provider는 GitHub만이 아니다(GitLab 등).
- **주석은 비자명한 것만, 1줄로.** 코드 설명·리뷰어용 주석 금지.
- **`max-lines` disable·예외 추가 절대 금지.** 파일이 커지면 분할한다.
- **파일 이름은 구체적 도메인 개념으로.** `helpers`/`utils`/`common` 금지.
- **UI는 STYLEGUIDE 토큰·shadcn primitive만.** 새 색상·폰트 크기·그림자 tier 발명 금지.
- 타입 선언은 `.d.ts`보다 `.ts`.

## 7. SAMWOO 커스텀 작업 시 추가 규칙

- 비밀값(비밀번호·토큰·Tailscale key·서명 개인키)은 코드·문서·테스트 어디에도 커밋하지 않는다. 저장소는 **Public**이다.
- 테스트 픽스처·문서 예시에도 실존 직원 login·실명을 쓰지 않는다.
- 프로필·권한 판정은 항상 서버가 토큰으로 결정한다. renderer가 보낸 프로필을 신뢰하는 코드를 만들지 않는다.
- login 식별자는 "도메인 제외 소문자"가 정규 형태이며, 실명은 표시 전용이다.
- 서버(`server/samwoo-auth/`) 변경은 기존 폴링 API·구버전 앱을 깨지 않아야 하고, DB 마이그레이션은 기존 데이터를 보존하는 멱등 방식(`CREATE TABLE IF NOT EXISTS` + 추가 마이그레이션)이어야 한다.
- 새 BrowserWindow·React 루트를 추가하면 Provider 컨텍스트(Tooltip 등)를 창 루트에서 다시 감싸고, **패키지 빌드 기준 GUI 실행을 릴리스 전에 확인**한다. dev 실행만으로는 못 잡는다(`v1.4.183` 크래시 사례).
- 운영 확인 없이 "구현 완료"를 "배포 완료"로 표현하지 않는다. SPEC의 상태 표기(운영 확인/구현 완료/배포 대기/후속 구현)를 따른다.

## 8. 브랜치·릴리스 흐름

| 항목 | 값 |
|---|---|
| 로컬 작업 브랜치 | `samwoo-upstream-v1.4.168` |
| 원격(samwooax/samwoo-orca) 브랜치 | `samwoo/upstream-v1.4.168` |
| push 방법 | `git push origin samwoo-upstream-v1.4.168:refs/heads/samwoo/upstream-v1.4.168` — 원격에 동명 로컬 브랜치를 만들지 않는다 |

릴리스 절차(상세는 SPEC §10):

1. 기능 커밋(`fix:`/`feat:`) → `chore: prepare vX.Y.Z`(버전 올림) 순으로 커밋한다.
2. `.github/workflows/build-samwoo-windows.yml`을 **수동 실행** — Windows 2022 runner에서 테스트·빌드·사내 서명·자산 검증 후 **Draft 릴리스** 생성.
3. Actions 성공과 자산 해시를 확인하면 `docs: record vX draft verification` 커밋으로 기록한다.
4. 관리자가 설치본 GUI 실측 후 Public으로 공개한다. 설치된 앱은 공개 `latest.yml`을 보고 자동 업데이트한다.

**빌드·배포는 사용자의 명시적 지시가 있을 때만 실행한다.** NSIS 훅 수정 시 assisted 전용 변수·페이지는 `!ifndef ONE_CLICK` 안에만 둔다.

## 9. 빠른 참조 — 자주 하는 질문

- **서비스 주소가 어디 정의돼 있지?** → `src/shared/samwoo-service-endpoints.ts` (Tailscale IP 직접 사용, MagicDNS 실패 이력 때문)
- **로그인/세션 코드?** → 앱 쪽 `src/main/ipc/`의 samwoo 확장, 서버 쪽 `server/samwoo-auth/`
- **Hermes 채팅이 파일을 어떻게 읽지?** → 봇이 구조화 요청 반환 → main이 프로젝트 루트 안에서만 실행 후 회신(로컬 파일 브리지, SPEC §5.3). Hermes 서버는 노트북 파일에 직접 접근 불가.
- **워크스페이스 공유 파일은 어디 저장?** → Nextcloud `SAMWOO-Workspaces/<프로필>/<UUID>/`, 메타데이터·댓글·보드는 VPS SQLite.
- **왜 Tasks 사이드바가 없지?** → 의도적 렌더 제거(회귀 아님). 내부 구현·IPC는 보존한다.
- **핵심 코드 위치 전체 목록?** → ARCHITECTURE.md §20 "핵심 코드 인덱스"
