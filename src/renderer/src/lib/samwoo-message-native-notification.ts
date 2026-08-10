import type { NotificationDispatchResult, NotificationSoundResult } from '../../../shared/types'

type NotificationApi = {
  dispatch: (args: {
    source: 'samwoo-message'
    notificationTitle: string
    notificationBody: string
    channelKey: string
  }) => Promise<NotificationDispatchResult>
  playSound: () => Promise<NotificationSoundResult>
}

export async function dispatchSamwooMessageNotification(
  api: NotificationApi,
  title: string,
  body: string,
  channelKey: string
): Promise<NotificationDispatchResult> {
  try {
    const result = await api.dispatch({
      source: 'samwoo-message',
      notificationTitle: title,
      notificationBody: body,
      channelKey
    })
    if (result.delivered) {
      // Why: the main notification is silent for custom sounds; the shared player applies that setting.
      void api.playSound().catch(() => undefined)
    }
    return result
  } catch {
    // Notification delivery must not interrupt inbox polling.
    return { delivered: false, reason: 'invalid-request' }
  }
}
