# docs/samwoo — SAMWOO-ORCA 문서 허브

> 삼우 전용 문서는 전부 이 폴더에 모은다. 이 폴더 밖의 docs/·notes/ 문서는 upstream Orca 소유이므로 이동·수정하지 않는다.

## 문서 지도

| 문서 | 역할 |
|---|---|
| [SPEC.md](./SPEC.md) | **단일 진실** — 제품 결정·아키텍처·운영 상태·보안 경계·검증 기준 |
| [WAVES.md](./WAVES.md) | 실행 계획 — 웨이브별 상태·완료 커밋 추적 |
| [WORKSPACE-SHARING.md](./WORKSPACE-SHARING.md) | 워크스페이스 공유 서버 배포·통합 상세 |
| archive/ | 폐기된 과거 인수인계 문서 (참조 금지) |

## 저장소 전체에서 삼우 관련 위치

| 위치 | 내용 | 추적 |
|---|---|---|
| `docs/samwoo/` | 삼우 문서 허브 (이 폴더) | ✅ git |
| `_claude-proposals/` | Claude×Codex 협업 폴더 — NEXT-PROMPT, 웨이브 지시서, 디자인, 배포 체크리스트 (규약: 그 안의 README.md) | ❌ 미추적 |
| `server/samwoo-auth/` | 인증·워크스페이스·메신저·메일 서버 (VPS 배포 대상) | ✅ git |
| `src/shared/samwoo-service-endpoints.ts` | 서비스 주소 중앙 정의 | ✅ git |
| `src/**/samwoo-*`, `src/**/hermes-*`, `src/renderer/**/workspace-hub/` | 앱 커스텀 코드 (upstream과 격리) | ✅ git |
| `deploy/` | Windows 설치 키트 소스 (install.ps1은 비밀 포함 가능 — 열람 금지) | ✅ git |
| `outputs/` | 빌드 산출물 — 최신 키트만 루트, 과거분은 `outputs/archive/` | ❌ 미추적 |
| 루트 `WINDOWS-DOWNLOADS.md` | 공개 다운로드 안내 (외부 링크 대상이라 루트 고정) | ✅ git |
| 루트 `AGENTS.md` / `CLAUDE.md` | 에이전트 규칙 (도구 규약상 루트 고정) | ✅ git |

## 읽는 순서 (새 세션·새 에이전트)

1. 루트 `AGENTS.md` — 코딩 규칙
2. `docs/samwoo/SPEC.md` — 제품·아키텍처·기준
3. `docs/samwoo/WAVES.md` — 지금 어디까지 왔고 다음이 뭔지
4. 작업 지시는 `_claude-proposals/NEXT-PROMPT.txt`
