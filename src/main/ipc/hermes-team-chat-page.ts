import { HERMES_TEAM_CHAT_CLIENT_SCRIPT } from './hermes-team-chat-client-script'
import { TEAM_CHAT_MODELS } from './hermes-team-chat-models'
import { HERMES_TEAM_CHAT_STYLE } from './hermes-team-chat-page-style'

const TEAM_CHAT_PAGE = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SAMWOO-ORCA Chat</title>
  <style>__ORCA_CHAT_STYLE__</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="identity">
        <div class="title" id="bot-name">팀 에이전트</div>
        <div class="subtitle" id="bot-subtitle">SAMWOO 팀 에이전트</div>
      </div>
      <div class="topbar-spacer"></div>
      <button class="ghost-button" id="new-chat" type="button" aria-label="새 대화">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
        </svg>
        새 대화
      </button>
    </header>
    <section class="messages" id="messages" aria-live="polite"></section>
    <div class="composer-wrap">
      <form class="composer" id="composer">
        <div class="attachment-list" id="attachment-list"></div>
        <textarea id="input" rows="1" placeholder="메시지를 입력하세요…" aria-label="메시지"></textarea>
        <div class="composer-actions">
          <input id="file" type="file" multiple accept=".txt,.md,.csv,.json,.yaml,.yml,.log" />
          <button class="icon-button" id="attach" type="button" aria-label="텍스트 파일 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
          <div class="composer-actions-right">
            <label class="picker-wrap">
              <span class="picker-label">추론 수준</span>
              <select class="picker" id="effort" aria-label="추론 수준"></select>
            </label>
            <label class="picker-wrap">
              <span class="picker-label">모델</span>
              <select class="picker" id="model" aria-label="모델"></select>
            </label>
            <button class="icon-button send" id="send" type="submit" aria-label="보내기">
              <svg class="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="m5 12 7-7 7 7M12 19V5"/>
              </svg>
              <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" hidden>
                <rect x="7" y="7" width="10" height="10" rx="1"/>
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  </main>
  <script>__ORCA_CHAT_CLIENT_SCRIPT____ORCA_CHAT_SCRIPT_CLOSE__
</body>
</html>`

export function getHermesTeamChatPage(token: string): string {
  // Why: replacement callbacks keep JavaScript `$` sequences from being interpreted as replace patterns.
  return TEAM_CHAT_PAGE.replace('__ORCA_CHAT_STYLE__', () => HERMES_TEAM_CHAT_STYLE)
    .replace('__ORCA_CHAT_CLIENT_SCRIPT__', () => HERMES_TEAM_CHAT_CLIENT_SCRIPT)
    .replace('__ORCA_CHAT_SCRIPT_CLOSE__', () => ['<', '/script>'].join(''))
    .replace('__ORCA_CHAT_MODELS__', JSON.stringify(TEAM_CHAT_MODELS))
    .replace('__ORCA_CHAT_TOKEN__', token)
}
