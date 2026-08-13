import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type {
  HermesTeamChatResult,
  TeamChatLocalToolExecution
} from '../../shared/hermes-team-chat-result'
import { executeLocalProjectToolReply } from './hermes-local-project-tool-loop'
import type { LocalDocumentAttachment } from './hermes-local-document-protocol'
import type { ExcelArtifactCapability } from '../../shared/hermes-excel-artifact'

export const MAX_LOCAL_TOOL_EXECUTIONS = 8

export function attachTeamChatToolExecutions(
  result: HermesTeamChatResult,
  toolExecutions: TeamChatLocalToolExecution[]
): HermesTeamChatResult {
  return toolExecutions.length > 0 ? { ...result, toolExecutions: [...toolExecutions] } : result
}

export async function advanceTeamChatLocalToolTurn(args: {
  reply: string
  cwd: string
  store: Store
  artifactStore?: HermesBinaryArtifactStore
  excelCapability?: ExcelArtifactCapability | null
  conversationId?: string
  requestId: string
  toolExecutions: TeamChatLocalToolExecution[]
  documentAttachments?: LocalDocumentAttachment[]
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<
  | { kind: 'complete' }
  | { kind: 'failed'; result: HermesTeamChatResult }
  | { kind: 'continue'; message: string }
> {
  const toolReply = await executeLocalProjectToolReply({
    reply: args.reply,
    cwd: args.cwd,
    store: args.store,
    artifactStore: args.artifactStore,
    excelCapability: args.excelCapability,
    conversationId: args.conversationId,
    requestId: args.requestId,
    documentAttachments: args.documentAttachments,
    allowExecution: args.toolExecutions.length < MAX_LOCAL_TOOL_EXECUTIONS,
    onProgress: args.onProgress
  })
  if (toolReply.kind === 'none') {
    return { kind: 'complete' }
  }
  if (toolReply.kind === 'invalid') {
    return {
      kind: 'failed',
      result: attachTeamChatToolExecutions(
        { ok: false, errorCode: 'local_tool_protocol_invalid', error: toolReply.error },
        args.toolExecutions
      )
    }
  }
  if (toolReply.kind === 'blocked') {
    return {
      kind: 'failed',
      result: attachTeamChatToolExecutions(
        {
          ok: false,
          errorCode: 'local_tool_limit_exceeded',
          error: `local project tool execution limit reached (${MAX_LOCAL_TOOL_EXECUTIONS}); additional request was not executed`
        },
        args.toolExecutions
      )
    }
  }
  args.toolExecutions.push({ sequence: args.toolExecutions.length + 1, ...toolReply.execution })
  const finalReplyOnly = args.toolExecutions.length === MAX_LOCAL_TOOL_EXECUTIONS
  return {
    kind: 'continue',
    message: [
      `Orca 로컬 프로젝트 도구 결과:\n${toolReply.reply}`,
      finalReplyOnly
        ? '로컬 도구 실행 한도를 모두 사용했습니다. 추가 도구를 요청하지 말고, 위 결과와 지금까지의 작업을 근거로 최종 답변하세요.'
        : '위 결과를 사용하세요. 추가 작업이 필요하면 해당 로컬 도구 형식만 출력하세요. 사용자 판단이 필요하면 질문한 뒤 이번 턴을 종료하고, 완료됐으면 최종 답변하세요.'
    ].join('\n\n')
  }
}
