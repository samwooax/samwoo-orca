# SAMWOO-ORCA — 작업 인수인계 (VS Code 이어서 작업용)

> 마지막 정리: 2026-07-31. 이 문서 하나로 프로젝트 전체 상태·남은 작업·이어가는 법을 파악할 수 있습니다.

---

## 0. 한 줄 요약

오픈소스 AI 개발환경 **Orca**를 삼우에레코 사내용으로 리브랜딩·확장한 데스크톱 앱.
직원이 **그룹웨어 계정으로 로그인 → 직무별 팀 AI 봇(Hermes)과 채팅 → 로컬 파일 작업**까지 됨.
**남은 것: 메일(읽기/발송) 기능** — 앱/스킬은 절반 됐고, 자격증명 처리 부분이 안전장치에 막혀 미완.

---

## 1. 리포 위치 & 빌드

- **리포**: `~/samwoo-orca` (git, 원격 `origin` = `github.com/samwooax/samwoo-orca`, **비공개**)
- **GitHub 소유 계정**: samwooax. 로컬 `gh` CLI는 이전 소유자 dhun827 계정으로도 협업 권한 사용 가능.
- **Node**: 24 필요. 이 맥엔 시스템 node가 22라, 빌드 시 스크래치패드에 받아둔 node24를 PATH 앞에 둠.
  - 예: `export PATH="/private/tmp/.../scratchpad/node24/bin:$PATH"` (세션마다 경로 다름) → 없으면 `nvm use 24` 또는 node24 재설치
- **패키지 매니저**: pnpm 10.24.0

### 빌드 명령
```bash
cd ~/samwoo-orca
pnpm install --frozen-lockfile            # 최초 1회
pnpm run typecheck                         # 타입 검사
# macOS DMG (로컬 테스트용):
pnpm run build:desktop && pnpm exec electron-builder --config config/electron-builder.config.cjs --mac dmg --arm64
# Windows exe: GitHub Actions에서 (로컬 크로스빌드 불가, 네이티브 모듈 때문)
gh workflow run build-samwoo-windows.yml
```
- Husky pre-commit 훅이 pnpm을 못 찾아 실패 → 커밋 시 `git commit --no-verify` 사용.
- Windows 빌드 워크플로: `.github/workflows/build-samwoo-windows.yml` (다른 원본 워크플로는 다 삭제함).

---

## 2. 아키텍처

```
[직원 PC (Win/Mac)]  SAMWOO-ORCA 앱 + 로컬 채팅서버(loopback:47821) + 로컬 파일 브리지
        │  (Tailscale WireGuard 암호화)
[Tailscale 테일넷: samwooax 계정]
        │
[Hostinger VPS  187.127.120.88 / tailnet: server-host 100.116.18.119]
   ├─ Hermes 팀봇 컨테이너  hermes-new-container = 100.68.242.83  (hr,cs,finance,oliver,planning,sales)
   ├─ Hermes 메인 컨테이너  hermes-container = 100.84.94.42       (dh,hk,ih...)
   ├─ Auth 서비스           :8823  (SMTP 로그인검증 + 직무매핑)
   └─ NextCloud             (배포 파일 호스팅)
        │
[그룹웨어 다우오피스/TIMS  play.samwooeleco.com]  SMTP 587 / IMAP 993
```

**⚠️ 테일넷 주의**: 회사 노트북들은 원래 `samwoo.axtf` 테일넷에 있었음. 우리 서버는 `samwooax` 테일넷.
로그인/봇 연결이 되려면 **노트북이 samwooax 테일넷에 있어야 함**. (install.ps1이 samwooax 키로 합류시킴)
앱은 MagicDNS 이름 대신 **테일스케일 IP 직접 사용**(Windows에서 이름해석 실패 때문): auth=100.116.18.119, 봇=100.68.242.83.

---

## 3. 완료된 기능 (파일 위치)

| 기능 | 파일 |
|---|---|
| 리브랜딩(이름/아이콘/appId 분리) | `config/electron-builder.config.cjs`, `resources/` (icon.ico/icns/png, logo.svg), `src/main/startup/dev-instance-identity.ts` |
| 자동 업데이트 → 자체 리포로 분리 | `src/main/updater.ts`, `updater-prerelease-feed.ts`, `src/renderer/.../UpdateCard.tsx` |
| 그룹웨어 SMTP 로그인 게이트 | `src/renderer/src/components/SamwooLoginGate.tsx`, `src/renderer/src/lib/samwoo-auth-store.ts`, `src/main/ipc/samwoo-auth.ts`, `src/preload/index.ts`+`api-types.ts` |
| 직무 자동 매핑 → 팀봇 채팅 자동실행 | `src/renderer/src/lib/worktree-activation.ts` (offerOrAutoLaunch/maybeAutoLaunchChat/launchHermesProfile) |
| 팀봇 말풍선 채팅(로컬 서버+아웃바운드 SSH) | `src/main/ipc/hermes-chat-server.ts` (고정포트 47821, 토큰주입) |
| 시작 에이전트 피커 | `src/renderer/src/components/StartAgentPickerDialog.tsx`, `src/renderer/src/lib/start-agent-picker-store.ts` |
| 선택 프로젝트 로컬파일 접근 | `hermes-local-file-protocol.ts`, `hermes-local-project-files.ts`가 상대경로 요청을 로컬 검증·실행. 서버의 노트북 SSH 없음 |
| 터미널 자동생성 억제(로그인 사용자) | `src/renderer/src/components/Terminal.tsx` (getSamwooAuth().role 가드) |
| 기본값 굽기(피커·채팅 ON) | `src/shared/constants.ts` |

- 커밋 히스토리(main): `git log --oneline` 참고. 최근 8개가 이 프로젝트 작업.

---

## 4. 서버 측 구성 (VPS: `ssh root@187.127.120.88`)

### Auth 서비스
- 위치: `/opt/samwoo-auth/auth-server.py` (systemd: `samwoo-auth`, `:8823`, 0.0.0.0 바인딩)
- 직무매핑 CSV: `/opt/samwoo-auth/role-map.csv` (형식: `login,name,role`. 현재 `dhoon21,총무인사,hr` 시드)
- 관리: `systemctl restart samwoo-auth`, 로그: `journalctl -u samwoo-auth`
- 하는 일: SMTP(587)로 로그인 검증만 → 직무 반환. 비번 저장 안 함.

### 봇 접속 (팀봇 컨테이너)
- `ssh hermes@100.68.242.83` (Tailscale SSH, 키 불필요)
- 프로필: `/opt/data/profiles/<role>/` — SOUL.md(성격), skills/
- 공유 스킬: `/opt/data/skills/<category>/<skill>/SKILL.md`

### 로컬 파일 규칙
- 노트북 직접 SSH는 금지. 앱이 전달하는 `orca_local_files` 요청 형식만 사용.
- 앱은 현재 선택 프로젝트 안에서 list/read/write만 실행하고 삭제는 허용하지 않음.

### NextCloud (배포 호스팅)
- URL: `https://nextcloud-ebml.srv1808091.hstgr.cloud`, 계정: samwoo_ax
- 배포 폴더: `SAMWOO-ORCA설치/` (install.bat, install.ps1, samwoo-orca-windows-setup.exe, README.txt)
- 파일 갱신법(컨테이너 내부 복사 + 스캔):
  ```bash
  # VPS에서:
  docker cp <파일> nextcloud-ebml-nextcloud-1:/tmp/x
  docker exec nextcloud-ebml-nextcloud-1 sh -c 'cp /tmp/x /var/www/html/data/samwoo_ax/files/*ORCA*/<파일명> && chown www-data:www-data /var/www/html/data/samwoo_ax/files/*ORCA*/<파일명>'
  docker exec -u www-data nextcloud-ebml-nextcloud-1 php occ files:scan samwoo_ax
  ```

---

## 5. 원클릭 설치 키트 (`deploy/`)

- `deploy/install.bat` → `install.ps1` 호출 (관리자 권한 자동 승격)
- `deploy/install.ps1`: 앱설치 → Tailscale 설치·합류(pre-auth키, shields-up) → OpenSSH Client 설치 → 기존 sshd/인바운드 규칙 비활성화. **UTF-8 BOM 필수**.
- `deploy/install.ps1` 은 Tailscale pre-auth 키 포함 → `.gitignore` 처리됨. 템플릿만 커밋(`install.template.ps1` 있으면).

---

## 6. 남은 작업 ★ 메일(읽기/발송) 기능

### 목표
직원이 앱 로그인 시 넣은 그룹웨어 아이디/비번을 세션 동안 서버가 보관 → 봇이 그 자격증명으로 본인 메일 IMAP 읽기/SMTP 발송. (아웃룩과 동일, 각자 본인 메일만)

### 완료된 부분
- **메일 스킬 배포됨**: `/opt/data/skills/communication/samwoo-mail/SKILL.md` (봇이 auth 서비스 `/mail/*` 엔드포인트를 curl로 호출하도록 지시). 모든 팀봇 공유.
- **서버 메일 모듈 초안**: `/opt/samwoo-auth/mail_ext.py` (IMAP/SMTP 함수 + 세션 저장). ※ 사용자가 붙여넣어 생성했으면 존재, 아니면 아래 코드로 생성 필요.

### 안전장치에 막혀 미완인 부분 (VS Code에서 직접 하면 됨 — 로컬 판별기 없음)

**(A) 앱: 로그인 토큰을 봇 컨텍스트로 전달** — stash에 WIP 보존됨:
```bash
cd ~/samwoo-orca && git stash pop   # WIP 복원 (5개 파일: token 추가)
```
복원되는 변경: `SamwooAuth`/`SamwooLoginResult`에 `token?` 추가, 로그인 게이트에서 `token: result.token` 저장, `worktree-activation.ts`에서 chat URL에 `mailtoken` 추가.
추가로 **아직 안 된 3곳** (직접 수정):
1. `src/main/ipc/hermes-chat-server.ts` — `runHermesMessage` args에 `mailToken?: string` 추가하고 컨텍스트에 한 줄:
   ```ts
   if (args.mailToken) ctxParts.push(`메일토큰=${args.mailToken}`)
   ```
   그리고 `/api/send` 핸들러에서 `parsed.mailtoken`을 읽어 `runHermesMessage({..., mailToken})`로 전달.
2. 채팅 페이지 JS(`CHAT_HTML` 안): `const mailtoken = params.get('mailtoken') || ''` 추가하고 `body: JSON.stringify({ profile, host, message, cwd, mailtoken })`.

**(B) 서버: auth 서비스에 세션 + 메일 엔드포인트** — `/opt/samwoo-auth/auth-server.py` 수정:
- 로그인 성공 시 `token = new_session(working_user, password)` 만들어 응답에 `"token": token` 추가.
- `smtp_verify`가 성공한 username을 반환하도록(현재 True 반환 → working_user 반환으로).
- `POST /mail/list|/mail/read|/mail/send` 핸들러 추가 → `mail_ext.py`의 함수 호출 (token으로 세션 조회).
- 완성본 초안은 대화기록의 "auth-server.py 확장 버전" 참고(스크래치패드에도 있을 수 있음: `.../scratchpad/auth-server.py`).

**(C) SOUL.md 정리(선택)**: `/opt/data/profiles/hr/SOUL.md`의 노트북접근 규칙을 스킬로 옮기면 프로필마다 반복 안 해도 됨.

### 검증 (막힌 부분 완료 후)
- IMAP/SMTP 자체는 열려있음 확인됨(587 STARTTLS AUTH, 993 IMAPS). 실제 계정 로그인은 앱에서 테스트.
- Python imaplib/smtplib로 됨 (Himalaya 불필요).

### 대안 검토 결론 (막다른 길 아님)
- 다우오피스 OpenAPI엔 "메일 조회/발송" API가 없음(엔터프라이즈여도). SSO는 로그인용.
- 하지만 IMAP/SMTP를 **OAuth 토큰(XOAUTH2)**으로 인증하는 것도 가능 → 비번 없이도 됨(원하면 이 방향). 지금 구현은 "로그인 비번 재사용" 방향.

---

## 7. 알려진 이슈 / 팁

- Windows에서 MagicDNS 짧은이름 해석 실패 → 반드시 **테일스케일 IP** 사용(코드에 반영됨).
- install.ps1은 **UTF-8 BOM** 없으면 한국어 Windows에서 "missing catch or finally" 파싱에러.
- exe 재설치 시 "파일 사용중" → 작업관리자에서 SAMWOO-ORCA 종료 후.
- 노트북은 인바운드 SSH를 사용하지 않으며, 선택 프로젝트 파일 작업은 Orca 프로세스가 로컬 수행.
- 죽은 채팅탭 복원으로 "can't reach 127.0.0.1:포트" 났던 이슈 → 채팅서버 고정포트(47821)+토큰주입으로 해결됨.

---

## 8. 계정/접근 요약

- **VPS**: `ssh root@187.127.120.88` (포트22). 봇: `ssh hermes@100.68.242.83`.
- **Tailscale**: samwooax 계정. pre-auth 키는 `deploy/install.ps1` 안(gitignore됨). 만료 2026-10-20.
- **NextCloud**: samwoo_ax / `https://nextcloud-ebml.srv1808091.hstgr.cloud`
- **그룹웨어**: 다우오피스, `play.samwooeleco.com` (SMTP 587 / IMAP 993).
- **GitHub**: samwooax/samwoo-orca (비공개), Release: v1.4.147-samwoo.

## 9. 리포 소유권 이전 완료
- 2026-07-29에 `dhun827/samwoo-orca`를 `samwooax/samwoo-orca`로 이전 완료.
- 원격 주소와 앱 업데이트·릴리스 피드도 `samwooax/samwoo-orca`를 사용.

---

## 10. 이어서 하는 법 (요약)
1. VS Code로 `~/samwoo-orca` 열기.
2. `git stash pop` 으로 메일 WIP 복원.
3. §6-(A) 3곳 + §6-(B) 서버 수정 완료.
4. `pnpm run typecheck` → mac 빌드로 로컬 테스트 → Windows 빌드(Actions) → NextCloud 배포(§4).
5. 앱에서 로그인 후 "메일 목록 보여줘"로 검증.
