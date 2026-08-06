SAMWOO-ORCA 설치 안내
=====================

[배포 담당자용 — 배포 전 1회]
1. install.ps1 에는 Tailscale pre-auth 키가 이미 들어 있습니다 (만료 2026-10-20).
   - 이 폴더는 키가 포함돼 있으므로 사내 공유 경로에만 두세요.
   - 만료 후 재발급: https://login.tailscale.com/admin/settings/keys (samwooax 계정)
     "Generate auth key" → Reusable 체크 → 발급 키를 install.ps1 의 TS_AUTHKEY 에 교체
2. 최신 samwoo-orca-windows-setup.exe 를 이 폴더에 같이 넣으세요.
   - samwoo-internal-root-ca.cer 와 samwoo-internal-code-signing.cer 도
     반드시 같은 폴더에 유지하세요. 공개 인증서이며 개인키는 포함되지 않습니다.
   (tailscale-setup-amd64.msi / tailscale-setup-arm64.msi 는 없으면
    Windows 아키텍처에 맞게 자동 다운로드되므로 선택사항)
3. Git, Python 및 uv 오프라인 설치파일을 같은 폴더에 유지하세요.
   - Git for Windows 2.55.0.windows.3: x64 및 ARM64
   - Python 3.14.6: x64 및 ARM64
   - uv 0.12.0: x64 및 ARM64

[사용자용 — 새 PC 설치]
1. 이 폴더를 통째로 PC에 복사
2. install.bat 을 더블클릭
   - 이미 관리자 권한으로 실행된 경우에도 설치가 중지되지 않습니다.
   - 일반 권한에서 시작하면 시스템 구성 단계에만 관리자 권한 창이 뜹니다.
3. 설치가 끝나면 SAMWOO-ORCA가 자동 실행됩니다.

설치되는 것:
- SAMWOO-ORCA 앱 (현재 사용자 계정에 설치)
- Git for Windows 2.55.0.windows.3 (현재 사용자 계정에 설치)
- Python 3.14.6 및 uv 0.12.0 (현재 사용자 계정에 설치)
- Tailscale (사내 에이전트 서버 연결용, 로그인 불필요)
- OpenSSH 클라이언트 (Hermes 서버로 나가는 연결만 사용)
- 기존 OpenSSH 서버가 있으면 중지하고 Tailscale 인바운드 연결 차단

기존 설치가 있는 경우:
- 기존 Orca는 종료하거나 덮어쓰지 않고 SAMWOO-ORCA와 별도 유지
- Git은 기존 설치가 정상 동작하면 재사용
- Python/uv는 지정 버전이 맞으면 재사용
- Tailscale은 기존 samwooax 프로필을 재사용하고, 다른 프로필이 활성 상태면
  samwooax 프로필로 전환하거나 사내 키로 추가
- 기존 OpenSSH 서버는 비활성화하고 과거 Hermes 인바운드 키만 제거
- 프로젝트 파일은 사용자가 Orca에서 선택한 폴더 안에서만 로컬 처리

첫 실행 후 프로젝트를 열면 팀 에이전트 선택창이 뜹니다:
- Claude Code (채팅) / 총무인사(hr) / CS(cs) / 재경(finance) /
  전략기획(oliver) / 영업기획(planning) / 영업(sales) / 일반 터미널

문제가 있으면 관리자에게 문의하세요.
