---
name: samwoo-mail
description: "삼우에레코 직원의 회사 메일을 읽고 보낸다. 사용자가 '메일 확인/요약/읽어줘', '메일 보내줘/답장', '안 읽은 메일', '받은편지함' 등 이메일 관련 요청을 할 때 사용한다. 로그인한 본인 계정의 메일만 접근한다."
---

# 회사 메일 (읽기 / 발송)

사용자가 자기 회사 메일을 다루려 할 때 이 스킬을 쓴다. 메일 접근은 인증 서버가 대신 처리하며, 봇은 오르카가 프로세스 환경에 주입한 `MAILTOKEN`만 사용한다.

## 준비 — 메일토큰 확인

- 셸 환경변수 `MAILTOKEN`이 비어 있으면 "메일 기능은 앱에서 다시 로그인한 뒤 이용해 주세요."라고 안내하고 중단한다.
- 토큰 값을 출력하거나, 사용자에게 보여주거나, 채팅·명령 인수·JSON 본문에 직접 삽입하지 않는다.
- 모든 요청은 셸이 확장하는 `Authorization: Bearer $MAILTOKEN` 헤더로 인증한다.

## 사용법 — 인증 서비스 호출

인증 서비스 주소: `http://100.116.18.119:8823`

### 받은편지함 목록

```sh
test -n "$MAILTOKEN" && curl -sS -m 30 -X POST http://100.116.18.119:8823/mail/list \
  -H "Authorization: Bearer $MAILTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":15}'
```

응답의 `messages`를 번호·보낸 사람·제목·날짜 순서로 정리한다.

### 메일 본문 읽기

목록에서 받은 숫자형 `uid`만 사용한다.

```sh
test -n "$MAILTOKEN" && curl -sS -m 30 -X POST http://100.116.18.119:8823/mail/read \
  -H "Authorization: Bearer $MAILTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uid":"<uid>"}'
```

### 메일 발송

발송 전에 받는 사람·제목·본문을 사용자에게 보여주고 명시적인 확인을 받는다.

```sh
test -n "$MAILTOKEN" && curl -sS -m 30 -X POST http://100.116.18.119:8823/mail/send \
  -H "Authorization: Bearer $MAILTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"받는사람@도메인","subject":"제목","body":"본문"}'
```

## 규칙

- 프로젝트 루트에서 메일 설정 파일이나 Python 스크립트를 찾지 않는다. 메일 처리는 중앙 인증 서비스가 담당한다.
- HTTP 401 또는 `invalid or expired session`이면 앱에서 로그아웃 후 다시 로그인하도록 안내한다.
- HTTP 404이면 메일 API가 서버에 배포되지 않은 상태라고 안내한다.
- 개인정보·민감 내용은 사용자가 명시적으로 요청한 범위에서만 다룬다.
- 메일은 사용자 확인 없이 발송하지 않는다.
