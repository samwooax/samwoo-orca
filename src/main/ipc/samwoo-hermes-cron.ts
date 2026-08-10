import { ipcMain } from 'electron'
import type {
  RunSamwooHermesCronActionArgs,
  UpsertSamwooHermesCronArgs
} from '../../shared/samwoo-hermes-cron'
import {
  listSamwooHermesCron,
  runSamwooHermesCronAction,
  upsertSamwooHermesCron
} from './samwoo-hermes-cron-client'

export function registerSamwooHermesCronHandlers(): void {
  ipcMain.handle('samwooHermesCron:list', (_event, profile: string) =>
    listSamwooHermesCron(profile)
  )
  ipcMain.handle('samwooHermesCron:upsert', (_event, args: UpsertSamwooHermesCronArgs) =>
    upsertSamwooHermesCron(args)
  )
  ipcMain.handle('samwooHermesCron:action', (_event, args: RunSamwooHermesCronActionArgs) =>
    runSamwooHermesCronAction(args)
  )
}
