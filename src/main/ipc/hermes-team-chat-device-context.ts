import { hostname, userInfo } from 'node:os'

export type TeamChatDeviceContext = {
  laptopName: string
  laptopUser: string
  projectSelected: boolean
}

function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

function cleanContextValue(value: string): string {
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\0', ' ').trim()
}

export async function getTeamChatDeviceContext(cwd: string): Promise<TeamChatDeviceContext> {
  return {
    laptopName: cleanContextValue(hostname()),
    laptopUser: cleanContextValue(safeUserName()),
    projectSelected: Boolean(cleanContextValue(cwd))
  }
}

export function formatTeamChatDeviceContext(context: TeamChatDeviceContext): string {
  const identity = JSON.stringify(context)
  return [
    `[작업컨텍스트] ${identity}`,
    '[장비접근제한] 노트북으로 SSH하거나 네트워크로 직접 접속하지 마세요. 프로젝트 파일은 아래 Orca 로컬파일도구로만 요청하세요.',
    ''
  ].join('\n')
}
