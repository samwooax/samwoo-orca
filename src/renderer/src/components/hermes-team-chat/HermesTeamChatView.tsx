import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { NativeChatComposerActions } from '@/components/native-chat/NativeChatComposerActions'
import { useNativeChatFileReference } from '@/components/native-chat/use-native-chat-file-reference'
import { buildNativeChatFileReferenceInsertion } from '@/components/native-chat/native-chat-file-reference'
import type { NativeChatLiveSession } from '@/components/native-chat/use-native-chat-live-session'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  TEAM_CHAT_MODELS,
  resolveTeamChatEffort,
  resolveTeamChatModel,
  type TeamChatEffort,
  type TeamChatHistoryMessage,
  type TeamChatModelId
} from '../../../../shared/hermes-team-chat-models'
import type { HermesTeamChatRoute } from './hermes-team-chat-route'

type TeamChatAttachment = { name: string; content: string }
type StoredTeamChat = {
  messages: TeamChatHistoryMessage[]
  model: TeamChatModelId
  effort: TeamChatEffort
}

const EFFORT_CHOICES = ['low', 'medium', 'high', 'xhigh', 'max'] as const

function storageKey(route: HermesTeamChatRoute): string {
  return `samwoo-team-chat:${route.profile}:${route.cwd}`
}

function readStoredTeamChat(route: HermesTeamChatRoute): StoredTeamChat {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(route)) ?? ''
    ) as Partial<StoredTeamChat>
    const model = resolveTeamChatModel(parsed.model).id
    return {
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message): message is TeamChatHistoryMessage =>
              (message?.role === 'user' || message?.role === 'assistant') &&
              typeof message.content === 'string'
          )
        : [],
      model,
      effort: resolveTeamChatEffort(model, parsed.effort)
    }
  } catch {
    return { messages: [], model: 'gpt-5.5', effort: 'medium' }
  }
}

function nativeMessages(messages: TeamChatHistoryMessage[]): NativeChatMessage[] {
  return messages.map((message, index) => ({
    id: `team-${index}-${message.role}`,
    role: message.role,
    blocks: [{ type: 'text', text: message.content }],
    timestamp: index,
    source: 'hook'
  }))
}

function createSession(messages: TeamChatHistoryMessage[], busy: boolean): NativeChatLiveSession {
  return {
    messages: nativeMessages(messages),
    status: busy ? 'working' : messages.length ? 'ready' : 'empty',
    sessionId: null,
    agent: 'hermes',
    hasMore: false,
    loadingEarlier: false,
    loadEarlier: () => {},
    readPhase: 'ready'
  }
}

function createOptionSnapshot(
  modelId: TeamChatModelId,
  effort: TeamChatEffort
): SessionOptionDescriptor[] {
  const model = resolveTeamChatModel(modelId)
  const descriptors: SessionOptionDescriptor[] = [
    {
      id: 'model',
      label: 'Model',
      category: 'model',
      kind: {
        type: 'select',
        currentValue: modelId,
        choices: TEAM_CHAT_MODELS.map((choice) => ({
          value: choice.id,
          label: choice.label
        }))
      },
      valueSource: 'applied',
      settable: true
    }
  ]
  if (model.efforts.length) {
    descriptors.unshift({
      id: 'effort',
      label: 'Effort',
      category: 'thought_level',
      kind: {
        type: 'select',
        currentValue: effort,
        choices: EFFORT_CHOICES.map((value) => ({ value, label: value }))
      },
      valueSource: 'applied',
      settable: true
    })
  }
  return descriptors
}

export function HermesTeamChatView({
  tabId,
  route
}: {
  tabId: string
  route: HermesTeamChatRoute
}): React.JSX.Element {
  const stored = useMemo(() => readStoredTeamChat(route), [route])
  const [messages, setMessages] = useState<TeamChatHistoryMessage[]>(stored.messages)
  const [model, setModel] = useState<TeamChatModelId>(stored.model)
  const [effort, setEffort] = useState<TeamChatEffort>(stored.effort)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<TeamChatAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem(storageKey(route), JSON.stringify({ messages, model, effort }))
  }, [effort, messages, model, route])

  const setOption = useCallback(
    async (id: string, value: SessionOptionValue) => {
      if (id === 'model') {
        const nextModel = resolveTeamChatModel(value).id
        setModel(nextModel)
        setEffort((current) => resolveTeamChatEffort(nextModel, current))
      } else if (id === 'effort') {
        setEffort(resolveTeamChatEffort(model, value))
      }
      return { snapshot: [] }
    },
    [model]
  )
  const optionSnapshot = useMemo(() => createOptionSnapshot(model, effort), [effort, model])
  const optionSurface = useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => optionSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: optionSnapshot }),
      subscribe: () => () => {}
    }),
    [optionSnapshot, setOption]
  )

  const insertFileReference = useCallback(
    (relativePath: string): boolean => {
      const textarea = textareaRef.current
      if (!textarea || textarea.disabled) {
        return false
      }
      const start = textarea.selectionStart ?? draft.length
      const end = textarea.selectionEnd ?? start
      const insertion = buildNativeChatFileReferenceInsertion({
        draft,
        selectionStart: start,
        selectionEnd: end,
        relativePath
      })
      const next = `${draft.slice(0, start)}${insertion}${draft.slice(end)}`
      setDraft(next)
      requestAnimationFrame(() => {
        textarea.focus()
        const caret = start + insertion.length
        textarea.setSelectionRange(caret, caret)
      })
      return true
    },
    [draft]
  )
  const fileReferenceHandle = useRef({ insertFileReference })
  fileReferenceHandle.current.insertFileReference = insertFileReference
  useNativeChatFileReference(tabId, fileReferenceHandle)

  const send = useCallback(async () => {
    const text = draft.trim()
    if (busy || (!text && !attachments.length)) {
      return
    }
    const history = messages.slice()
    const displayText = text || attachments.map((file) => file.name).join(', ')
    setMessages([...history, { role: 'user', content: displayText }])
    setDraft('')
    const outgoingAttachments = attachments
    setAttachments([])
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setBusy(true)
    try {
      const result = await window.api.preflight.sendHermesTeamChat({
        requestId,
        profile: route.profile,
        host: route.host,
        cwd: route.cwd,
        mailtoken: route.mailToken,
        model,
        effort,
        message: text,
        history,
        attachments: outgoingAttachments
      })
      if (requestIdRef.current !== requestId) {
        return
      }
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.ok
            ? result.reply || '응답이 비어 있습니다.'
            : `오류: ${result.error || '응답을 받지 못했습니다.'}`
        }
      ])
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return
      }
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: `연결 오류: ${String(error)}` }
      ])
    } finally {
      if (requestIdRef.current === requestId) {
        requestIdRef.current = null
        setBusy(false)
        textareaRef.current?.focus()
      }
    }
  }, [attachments, busy, draft, effort, messages, model, route])

  const stop = useCallback(() => {
    const requestId = requestIdRef.current
    if (requestId) {
      requestIdRef.current = null
      setBusy(false)
      void window.api.preflight.cancelHermesTeamChat(requestId)
    }
  }, [])

  const readAttachments = useCallback(async (files: FileList | null) => {
    const selected = Array.from(files ?? []).slice(0, 5)
    const readable = selected.filter((file) => file.size <= 96_000)
    setAttachments(
      await Promise.all(
        readable.map(async (file) => ({ name: file.name, content: await file.text() }))
      )
    )
  }, [])

  const session = useMemo(() => createSession(messages, busy), [busy, messages])

  return (
    <div className="relative z-10 flex h-full min-h-0 w-full flex-col bg-background">
      <div className="absolute top-2 right-3 z-10">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="새 대화"
              disabled={busy}
              onClick={() => setMessages([])}
            >
              <RotateCcw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            새 대화
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <MessageSquare className="size-6" />
            </div>
            <p className="text-sm font-medium text-foreground">{route.label}와 대화 시작</p>
            <p className="max-w-sm text-balance text-xs text-muted-foreground">
              메시지를 입력하거나 프로젝트 파일을 선택하세요.
            </p>
          </div>
        ) : (
          <NativeChatMessageList
            session={session}
            isWorking={busy}
            expandSignal={false}
            fontScale={1}
          />
        )}
      </div>
      <div className="shrink-0 bg-background">
        <div className="px-3 pt-2 pb-4 sm:px-4">
          <div className="mx-auto w-full max-w-4xl">
            <div className="rounded-lg border border-border bg-muted/50 p-1.5 shadow-xs dark:bg-input/40">
              {attachments.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.name}
                      className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    >
                      <span className="max-w-56 truncate">{attachment.name}</span>
                      <button
                        type="button"
                        className="flex size-4 items-center justify-center rounded-sm hover:bg-accent"
                        onClick={() =>
                          setAttachments((current) => current.filter((item) => item !== attachment))
                        }
                        aria-label={`${attachment.name} 제거`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={draft}
                disabled={busy}
                rows={2}
                placeholder="메시지를 입력하세요…"
                className="scrollbar-sleek min-h-12 max-h-28 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".txt,.md,.csv,.json,.yaml,.yml,.log"
                onChange={(event) => {
                  void readAttachments(event.target.files)
                  event.target.value = ''
                }}
              />
              <div className="flex items-center pt-0.5">
                <NativeChatComposerActions
                  attachDisabled={busy}
                  dictationDisabled
                  sendDisabled={busy ? false : !draft.trim() && attachments.length === 0}
                  isWorking={busy}
                  isDictating={false}
                  isDictationHoldMode={false}
                  onAttach={() => fileInputRef.current?.click()}
                  onDictationToggle={() => {}}
                  onDictationHoldStart={() => {}}
                  onDictationHoldEnd={() => {}}
                  onSend={() => void send()}
                  onStop={stop}
                  sessionOptionsSurface={optionSurface}
                  sessionOptionsSnapshot={optionSnapshot}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
