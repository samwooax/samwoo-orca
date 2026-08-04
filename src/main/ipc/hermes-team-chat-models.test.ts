import { describe, expect, it } from 'vitest'
import {
  buildTeamChatCancelRemoteCommand,
  buildTeamChatAcpRemoteCommand,
  buildTeamChatRemoteCommand,
  formatTeamChatMessage,
  normalizeTeamChatHistory,
  resolveTeamChatEffort,
  resolveTeamChatModel,
  TEAM_CHAT_MODELS
} from './hermes-team-chat-models'

describe('team chat model catalog', () => {
  it('offers the requested Claude and GPT models', () => {
    expect(TEAM_CHAT_MODELS.map((model) => model.id)).toEqual([
      'fable',
      'opus',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5'
    ])
  })

  it('falls back to GPT-5.5 and a supported effort', () => {
    expect(resolveTeamChatModel('unknown').id).toBe('gpt-5.5')
    expect(resolveTeamChatEffort('fable', 'high')).toBe('high')
    expect(resolveTeamChatEffort('opus', 'invalid')).toBe('medium')
  })
})

describe('team chat remote commands', () => {
  it('routes Fable through Claude with the profile persona and effort', () => {
    const command = buildTeamChatRemoteCommand({
      requestId: 'request-1',
      profile: 'hr',
      modelId: 'fable',
      effort: 'high'
    })
    expect(command).toContain('read -r mail_token')
    expect(command).toContain('export MAILTOKEN="$mail_token"')
    expect(command).toContain(
      'claude -p --model fable --effort high --permission-mode bypassPermissions'
    )
    expect(command).not.toContain('safe-token')
    expect(command).toContain('--output-format stream-json --verbose')
    expect(
      buildTeamChatRemoteCommand({
        requestId: 'request-1',
        profile: 'hr',
        modelId: 'fable',
        effort: 'high'
      })
    ).toContain('skills/*/SKILL.md')
  })

  it('routes GPT-5.6 through the selected Hermes profile directory', () => {
    const command = buildTeamChatRemoteCommand({
      requestId: 'request-2',
      profile: 'hr',
      modelId: 'gpt-5.6-sol',
      effort: 'medium'
    })

    expect(command).toContain('HERMES_HOME=/opt/data/profiles/hr hermes --model gpt-5.6-sol')
    expect(command).not.toContain('hermes --profile')
    expect(command).not.toContain('2>/dev/null')
  })

  it('runs each request in a bounded session and can stop that entire session', () => {
    const run = buildTeamChatRemoteCommand({
      requestId: 'request-3',
      profile: 'hr',
      modelId: 'gpt-5.5',
      effort: 'medium'
    })
    const cancel = buildTeamChatCancelRemoteCommand('request-3')

    expect(run).toContain('setsid sh -c')
    expect(run).toContain('timeout --signal=TERM --kill-after=5s 1800s')
    expect(run).toContain('/tmp/samwoo-team-chat-request-3.pid')
    expect(cancel).toContain('pkill -TERM -s')
    expect(cancel).toContain('pkill -KILL -s')
    expect(cancel).toContain('pgrep -s')
  })

  it('bootstraps ACP credentials from stdin instead of process arguments', () => {
    const command = buildTeamChatAcpRemoteCommand({
      requestId: 'conversation-1',
      profile: 'hr'
    })

    expect(command).toContain('read -r mail_token')
    expect(command).toContain('hermes acp')
    expect(command).not.toContain('safe-token')
  })
})

describe('team chat history', () => {
  it('keeps only valid recent messages', () => {
    const history = normalizeTeamChatHistory([
      { role: 'system', content: 'drop' },
      { role: 'user', content: '질문' },
      { role: 'assistant', content: '답변' },
      null
    ])
    expect(history).toEqual([
      { role: 'user', content: '질문' },
      { role: 'assistant', content: '답변' }
    ])
  })

  it('formats context, history, and the current user message separately', () => {
    expect(
      formatTeamChatMessage({
        contextLine: '[작업컨텍스트 노트북=office]\n',
        history: [{ role: 'assistant', content: '이전 답변' }],
        message: '현재 질문'
      })
    ).toBe(
      '[작업컨텍스트 노트북=office]\n[이전 대화]\n에이전트:\n이전 답변\n[이전 대화 끝]\n\n사용자:\n현재 질문'
    )
  })
})
