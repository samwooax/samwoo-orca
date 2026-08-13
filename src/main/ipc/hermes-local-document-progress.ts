import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { LocalDocumentOperation } from './hermes-local-document-protocol'

export function localDocumentProgress(
  requestId: string,
  operation: LocalDocumentOperation,
  status: TeamChatProgressEvent['status'],
  detail?: string
): TeamChatProgressEvent {
  const actions: Record<LocalDocumentOperation['kind'], string> = {
    inspect: '문서 확인',
    extract: '문서 내용 추출',
    apply_xlsx_translation: 'Excel 번역본 저장',
    apply_pptx_translation: 'PowerPoint 번역본 저장',
    create_pptx: 'PowerPoint 생성',
    edit_pptx: 'PowerPoint 편집',
    create_pdf: 'PDF 생성',
    edit_pdf: 'PDF 편집'
  }
  const target = 'path' in operation ? operation.path : operation.outputPath
  return {
    requestId,
    id: `local-document-${operation.id}`,
    kind: 'local_document',
    title: `${actions[operation.kind]}: ${target}`,
    ...(detail ? { detail: detail.slice(0, 240) } : {}),
    status
  }
}
