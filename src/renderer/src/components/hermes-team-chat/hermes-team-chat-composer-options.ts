import type {
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import {
  resolveTeamChatEffort,
  resolveTeamChatModel,
  type TeamChatEffort,
  type TeamChatModelId
} from '../../../../shared/hermes-team-chat-models'
import { createTeamChatOptionSnapshot } from './hermes-team-chat-session-options'

export function createTeamChatComposerOptions(args: {
  model: TeamChatModelId
  effort: TeamChatEffort
  onModelChange: (model: TeamChatModelId) => void
  onEffortChange: (effort: TeamChatEffort) => void
}): { surface: SessionOptionsSurface; snapshot: ReturnType<typeof createTeamChatOptionSnapshot> } {
  const currentSnapshot = createTeamChatOptionSnapshot(args.model, args.effort)
  const snapshotFor = (model: TeamChatModelId, effort: TeamChatEffort) =>
    createTeamChatOptionSnapshot(model, effort)

  const setOption = async (id: string, value: SessionOptionValue) => {
    if (typeof value !== 'string') {
      return { snapshot: currentSnapshot }
    }
    if (id === 'model') {
      const model = resolveTeamChatModel(value).id
      const effort = resolveTeamChatEffort(model, args.effort)
      args.onModelChange(model)
      return { snapshot: snapshotFor(model, effort) }
    }
    if (id === 'effort') {
      const effort = resolveTeamChatEffort(args.model, value)
      args.onEffortChange(effort)
      return { snapshot: snapshotFor(args.model, effort) }
    }
    return { snapshot: currentSnapshot }
  }

  return {
    snapshot: currentSnapshot,
    surface: {
      getSnapshot: () => currentSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: currentSnapshot }),
      subscribe: () => () => {}
    }
  }
}
