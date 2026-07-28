export const HERMES_TEAM_CHAT_STYLE = String.raw`
  :root {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #0a0a0a;
    --card: #ffffff;
    --card-foreground: #0a0a0a;
    --popover: #ffffff;
    --popover-foreground: #0a0a0a;
    --primary: #171717;
    --primary-foreground: #fafafa;
    --secondary: #f5f5f5;
    --secondary-foreground: #171717;
    --muted: #f5f5f5;
    --muted-foreground: #737373;
    --accent: #f5f5f5;
    --accent-foreground: #171717;
    --destructive: #e40014;
    --border: #e5e5e5;
    --input: #e5e5e5;
    --ring: #a1a1a1;
    --radius: 0.625rem;
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --background: #0a0a0a;
    --foreground: #fafafa;
    --card: #171717;
    --card-foreground: #fafafa;
    --popover: #171717;
    --popover-foreground: #fafafa;
    --primary: #e5e5e5;
    --primary-foreground: #171717;
    --secondary: #262626;
    --secondary-foreground: #fafafa;
    --muted: #262626;
    --muted-foreground: #a1a1a1;
    --accent: #404040;
    --accent-foreground: #fafafa;
    --destructive: #ff6568;
    --border: rgba(255, 255, 255, 0.07);
    --input: rgba(255, 255, 255, 0.15);
    --ring: #737373;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--background);
    color: var(--foreground);
    font: 14px/1.5 Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif;
    letter-spacing: 0.01em;
    overflow: hidden;
  }
  button, select, textarea { color: inherit; font: inherit; letter-spacing: inherit; }
  button, select { border: 0; }
  button:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .shell { display: flex; height: 100%; flex-direction: column; }
  .topbar {
    align-items: center;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex: 0 0 auto;
    gap: 10px;
    min-height: 44px;
    padding: 6px 16px;
  }
  .identity { min-width: 0; }
  .title { font-size: 13px; font-weight: 600; }
  .subtitle { color: var(--muted-foreground); font-size: 11px; }
  .topbar-spacer { flex: 1; }
  .ghost-button, .icon-button {
    align-items: center;
    background: transparent;
    border-radius: calc(var(--radius) * 0.8);
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
  }
  .ghost-button { font-size: 12px; gap: 6px; height: 28px; padding: 0 9px; }
  .icon-button { height: 32px; padding: 0; width: 32px; }
  .ghost-button:hover, .icon-button:hover { background: var(--accent); }
  .ghost-button:disabled, .icon-button:disabled { cursor: default; opacity: 0.45; }
  svg { height: 16px; width: 16px; }
  .messages {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 24px;
    overflow-y: auto;
    padding: 28px max(20px, calc((100% - 760px) / 2)) 128px;
    scrollbar-color: var(--muted-foreground) transparent;
    scrollbar-width: thin;
  }
  .empty {
    align-items: center;
    color: var(--muted-foreground);
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    min-height: 240px;
    text-align: center;
  }
  .empty-mark {
    align-items: center;
    background: var(--muted);
    border-radius: calc(var(--radius) * 1.4);
    color: var(--foreground);
    display: flex;
    font-weight: 700;
    height: 42px;
    justify-content: center;
    margin-bottom: 12px;
    width: 42px;
  }
  .empty-title { color: var(--foreground); font-weight: 600; margin-bottom: 4px; }
  .empty-copy { font-size: 12px; }
  .message { display: flex; width: 100%; }
  .message.user { justify-content: flex-end; }
  .message.user .body {
    background: var(--muted);
    border-radius: calc(var(--radius) * 1.4);
    max-width: 85%;
    padding: 9px 13px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .message.assistant { flex-direction: column; }
  .message.assistant .body { min-width: 0; overflow-wrap: anywhere; }
  .message.error .body { color: var(--destructive); }
  .message-actions { height: 24px; margin: 5px 0 -18px; opacity: 0; }
  .message.assistant:hover .message-actions,
  .message-actions:focus-within { opacity: 1; }
  .copy-button { color: var(--muted-foreground); height: 24px; width: 24px; }
  .markdown p { margin: 0 0 12px; }
  .markdown p:last-child { margin-bottom: 0; }
  .markdown pre {
    background: var(--muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 10px 0;
    overflow: auto;
    padding: 12px;
  }
  .markdown code {
    background: var(--muted);
    border-radius: calc(var(--radius) * 0.6);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    padding: 1px 4px;
  }
  .markdown pre code { background: transparent; padding: 0; }
  .markdown ul, .markdown ol { margin: 8px 0; padding-left: 24px; }
  .markdown h1, .markdown h2, .markdown h3 { line-height: 1.3; margin: 18px 0 8px; }
  .markdown h1 { font-size: 20px; }
  .markdown h2 { font-size: 17px; }
  .markdown h3 { font-size: 15px; }
  .working { align-items: center; color: var(--muted-foreground); display: flex; font-size: 12px; gap: 7px; }
  .spinner {
    animation: spin 0.9s linear infinite;
    border: 2px solid var(--border);
    border-radius: 50%;
    border-top-color: var(--foreground);
    height: 14px;
    width: 14px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .composer-wrap {
    background: linear-gradient(transparent, var(--background) 24%);
    bottom: 0;
    left: 0;
    padding: 28px max(20px, calc((100% - 760px) / 2)) 16px;
    position: fixed;
    right: 0;
  }
  .composer {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) * 1.4);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 8%, transparent);
    padding: 9px;
  }
  textarea {
    background: transparent;
    border: 0;
    display: block;
    max-height: 160px;
    min-height: 44px;
    outline: 0 !important;
    padding: 4px 6px 8px;
    resize: none;
    width: 100%;
  }
  textarea::placeholder { color: var(--muted-foreground); }
  .attachment-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px 7px; }
  .attachment {
    align-items: center;
    background: var(--secondary);
    border-radius: 999px;
    display: flex;
    font-size: 12px;
    gap: 5px;
    max-width: 220px;
    padding: 4px 8px;
  }
  .attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attachment button { background: transparent; cursor: pointer; padding: 0; }
  .composer-actions { align-items: center; display: flex; gap: 4px; }
  .composer-actions-right { align-items: center; display: flex; gap: 6px; margin-left: auto; }
  .picker {
    appearance: none;
    background: transparent;
    border-radius: calc(var(--radius) * 0.6);
    color: var(--muted-foreground);
    cursor: pointer;
    font-size: 12px;
    height: 24px;
    max-width: 160px;
    padding: 0 22px 0 7px;
  }
  .picker-wrap { position: relative; }
  .picker-wrap::after {
    color: var(--muted-foreground);
    content: "⌄";
    pointer-events: none;
    position: absolute;
    right: 7px;
    top: 1px;
  }
  .picker:hover { background: var(--accent); color: var(--accent-foreground); }
  .send {
    background: var(--primary);
    border-radius: 999px;
    color: var(--primary-foreground);
  }
  .send.stop { background: var(--secondary); color: var(--secondary-foreground); }
  .send:disabled { opacity: 0.45; }
  #file { display: none; }
  @media (max-width: 640px) {
    .messages { padding-left: 14px; padding-right: 14px; }
    .composer-wrap { padding-left: 14px; padding-right: 14px; }
    .subtitle { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`
