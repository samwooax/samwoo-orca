import { describe, expect, it, vi } from 'vitest'
import { dispatchSamwooMessageNotification } from './samwoo-message-native-notification'

describe('SAMWOO message native notifications', () => {
  it('uses the Electron notification path and requests the configured sound', async () => {
    const dispatch = vi.fn(async () => ({ delivered: true as const }))
    const playSound = vi.fn(async () => ({ played: true as const }))

    await expect(
      dispatchSamwooMessageNotification(
        { dispatch, playSound },
        '팀 채팅',
        '홍길동: 확인 부탁드립니다',
        'team'
      )
    ).resolves.toEqual({ delivered: true })

    expect(dispatch).toHaveBeenCalledWith({
      source: 'samwoo-message',
      notificationTitle: '팀 채팅',
      notificationBody: '홍길동: 확인 부탁드립니다',
      channelKey: 'team'
    })
    expect(playSound).toHaveBeenCalledTimes(1)
  })

  it('does not play a sound when the system declines delivery', async () => {
    const dispatch = vi.fn(async () => ({ delivered: false as const, reason: 'disabled' as const }))
    const playSound = vi.fn(async () => ({ played: true as const }))

    await dispatchSamwooMessageNotification({ dispatch, playSound }, '팀 채팅', '메시지', 'team')

    expect(playSound).not.toHaveBeenCalled()
  })

  it('contains native notification IPC failures', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('IPC unavailable')
    })
    const playSound = vi.fn(async () => ({ played: true as const }))

    await expect(
      dispatchSamwooMessageNotification({ dispatch, playSound }, '팀 채팅', '메시지', 'team')
    ).resolves.toEqual({ delivered: false, reason: 'invalid-request' })
    expect(playSound).not.toHaveBeenCalled()
  })
})
