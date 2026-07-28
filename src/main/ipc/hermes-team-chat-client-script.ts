export const HERMES_TEAM_CHAT_CLIENT_SCRIPT = String.raw`
  "use strict"
  const models = __ORCA_CHAT_MODELS__
  const params = new URLSearchParams(location.search)
  const profile = params.get("profile") || "default"
  const label = params.get("label") || profile
  const host = params.get("host") || ""
  const cwd = params.get("cwd") || ""
  const mailtoken = params.get("mailtoken") || ""
  const token = "__ORCA_CHAT_TOKEN__"
  const requestedTheme = params.get("theme")
  const theme = requestedTheme === "light" || requestedTheme === "dark"
    ? requestedTheme
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  document.documentElement.dataset.theme = theme

  const elements = {
    messages: document.getElementById("messages"),
    input: document.getElementById("input"),
    form: document.getElementById("composer"),
    send: document.getElementById("send"),
    model: document.getElementById("model"),
    effort: document.getElementById("effort"),
    attach: document.getElementById("attach"),
    file: document.getElementById("file"),
    attachments: document.getElementById("attachment-list"),
    newChat: document.getElementById("new-chat")
  }
  document.getElementById("bot-name").textContent = label
  document.getElementById("bot-subtitle").textContent = "SAMWOO 팀 에이전트 · " + profile
  document.title = label + " - SAMWOO-ORCA"

  const storageKey = "samwoo-team-chat:" + profile
  const settingsKey = storageKey + ":settings"
  let messages = readJson(storageKey, [])
  let settings = readJson(settingsKey, { model: "gpt-5.5", effort: "medium" })
  let attachments = []
  let busy = false
  let controller = null
  let requestId = ""

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null")
      return value === null ? fallback : value
    } catch {
      return fallback
    }
  }
  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-80)))
    localStorage.setItem(settingsKey, JSON.stringify(settings))
  }
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }
  function renderMarkdown(value) {
    const codeBlocks = []
    const tick = String.fromCharCode(96)
    const fencedCode = new RegExp(tick + "{3}(?:[\\w-]+)?\\n?([\\s\\S]*?)" + tick + "{3}", "g")
    const inlineCode = new RegExp(tick + "([^" + tick + "\\n]+)" + tick, "g")
    let html = escapeHtml(value).replace(fencedCode, function (_all, code) {
      const index = codeBlocks.push("<pre><code>" + code.trimEnd() + "</code></pre>") - 1
      return "\n@@CODE" + index + "@@\n"
    })
    html = html
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(inlineCode, "<code>$1</code>")
    html = html.split(/\n{2,}/).map(function (block) {
      if (/^<(h[1-3]|pre)/.test(block) || /^@@CODE/.test(block)) return block
      return "<p>" + block.replaceAll("\n", "<br>") + "</p>"
    }).join("")
    return html.replace(/@@CODE(\d+)@@/g, function (_all, index) {
      return codeBlocks[Number(index)] || ""
    })
  }
  function iconCopy() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
  }
  function render() {
    elements.messages.replaceChildren()
    if (!messages.length && !busy) {
      const empty = document.createElement("div")
      empty.className = "empty"
      empty.innerHTML = '<div class="empty-mark">SW</div><div class="empty-title">' +
        escapeHtml(label) + '</div><div class="empty-copy">업무 내용을 입력하면 바로 대화를 시작합니다.</div>'
      elements.messages.appendChild(empty)
      return
    }
    messages.forEach(function (message) {
      const item = document.createElement("article")
      item.className = "message " + message.role + (message.error ? " error" : "")
      const body = document.createElement("div")
      body.className = "body" + (message.role === "assistant" ? " markdown" : "")
      if (message.role === "assistant") body.innerHTML = renderMarkdown(message.content)
      else body.textContent = message.content
      item.appendChild(body)
      if (message.role === "assistant" && !message.error) {
        const actions = document.createElement("div")
        actions.className = "message-actions"
        const copy = document.createElement("button")
        copy.type = "button"
        copy.className = "icon-button copy-button"
        copy.setAttribute("aria-label", "응답 복사")
        copy.innerHTML = iconCopy()
        copy.addEventListener("click", function () { void navigator.clipboard.writeText(message.content) })
        actions.appendChild(copy)
        item.appendChild(actions)
      }
      elements.messages.appendChild(item)
    })
    if (busy) {
      const working = document.createElement("div")
      working.className = "working"
      working.innerHTML = '<span class="spinner"></span><span>' + escapeHtml(label) + " 응답 작성 중</span>"
      elements.messages.appendChild(working)
    }
    elements.messages.scrollTop = elements.messages.scrollHeight
  }
  function selectedModel() {
    return models.find(function (model) { return model.id === settings.model }) || models[5]
  }
  function renderPickers() {
    elements.model.replaceChildren()
    models.forEach(function (model) {
      const option = document.createElement("option")
      option.value = model.id
      option.textContent = model.label
      elements.model.appendChild(option)
    })
    if (!models.some(function (model) { return model.id === settings.model })) settings.model = "gpt-5.5"
    elements.model.value = settings.model
    const model = selectedModel()
    elements.effort.replaceChildren()
    model.efforts.forEach(function (effort) {
      const option = document.createElement("option")
      option.value = effort
      option.textContent = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }[effort]
      elements.effort.appendChild(option)
    })
    elements.effort.parentElement.hidden = !model.efforts.length
    if (model.efforts.length && !model.efforts.includes(settings.effort)) settings.effort = "medium"
    elements.effort.value = settings.effort
  }
  function renderAttachments() {
    elements.attachments.replaceChildren()
    attachments.forEach(function (file, index) {
      const chip = document.createElement("div")
      chip.className = "attachment"
      chip.innerHTML = "<span>" + escapeHtml(file.name) + '</span><button type="button" aria-label="첨부 제거">×</button>'
      chip.querySelector("button").addEventListener("click", function () {
        attachments.splice(index, 1)
        renderAttachments()
      })
      elements.attachments.appendChild(chip)
    })
  }
  function setBusy(value) {
    busy = value
    elements.model.disabled = value
    elements.effort.disabled = value
    elements.attach.disabled = value
    elements.newChat.disabled = value
    elements.send.classList.toggle("stop", value)
    elements.send.querySelector(".send-icon").hidden = value
    elements.send.querySelector(".stop-icon").hidden = !value
    elements.send.setAttribute("aria-label", value ? "에이전트 중지" : "보내기")
    render()
  }
  async function cancel() {
    if (!busy) return
    controller.abort()
    await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Orca-Token": token },
      body: JSON.stringify({ requestId: requestId })
    }).catch(function () {})
  }
  async function send() {
    const text = elements.input.value.trim()
    if ((!text && !attachments.length) || busy) return
    const outgoingAttachments = attachments.slice()
    const displayText = text || outgoingAttachments.map(function (file) { return file.name }).join(", ")
    const history = messages.filter(function (message) { return !message.error })
    messages.push({ role: "user", content: displayText })
    elements.input.value = ""
    elements.input.style.height = "auto"
    attachments = []
    renderAttachments()
    requestId = crypto.randomUUID()
    controller = new AbortController()
    setBusy(true)
    try {
      const response = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orca-Token": token },
        signal: controller.signal,
        body: JSON.stringify({
          requestId: requestId, profile: profile, host: host, cwd: cwd, mailtoken: mailtoken,
          model: settings.model, effort: settings.effort, message: text,
          history: history, attachments: outgoingAttachments
        })
      })
      const data = await response.json()
      if (data.ok) messages.push({ role: "assistant", content: data.reply })
      else messages.push({ role: "assistant", content: "오류: " + (data.error || "응답을 받지 못했습니다"), error: true })
    } catch (error) {
      if (error.name !== "AbortError") {
        messages.push({ role: "assistant", content: "연결 오류: " + String(error), error: true })
      }
    } finally {
      setBusy(false)
      saveState()
      elements.input.focus()
    }
  }

  elements.form.addEventListener("submit", function (event) {
    event.preventDefault()
    if (busy) void cancel()
    else void send()
  })
  elements.input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    }
  })
  elements.input.addEventListener("input", function () {
    elements.input.style.height = "auto"
    elements.input.style.height = Math.min(elements.input.scrollHeight, 160) + "px"
  })
  elements.model.addEventListener("change", function () {
    settings.model = elements.model.value
    renderPickers()
    saveState()
  })
  elements.effort.addEventListener("change", function () {
    settings.effort = elements.effort.value
    saveState()
  })
  elements.attach.addEventListener("click", function () { elements.file.click() })
  elements.file.addEventListener("change", async function () {
    const selected = Array.from(elements.file.files || []).slice(0, 5)
    for (const file of selected) {
      if (file.size <= 96000) attachments.push({ name: file.name, content: await file.text() })
    }
    elements.file.value = ""
    renderAttachments()
  })
  elements.newChat.addEventListener("click", function () {
    messages = []
    localStorage.removeItem(storageKey)
    render()
    elements.input.focus()
  })
  renderPickers()
  renderAttachments()
  render()
  elements.input.focus()
`
