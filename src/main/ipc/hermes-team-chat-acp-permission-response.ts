import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

export function hermesAcpPermissionResult(
  message: AcpJsonRecord,
  cancelRequested: boolean
): AcpJsonRecord {
  const params = isAcpRecord(message.params) ? message.params : {}
  const options = Array.isArray(params.options) ? params.options : []
  const selected = cancelRequested
    ? undefined
    : options.find(
        (option) =>
          isAcpRecord(option) &&
          typeof option.optionId === 'string' &&
          (option.kind === 'allow_once' || option.kind === 'allow_always')
      )
  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}
