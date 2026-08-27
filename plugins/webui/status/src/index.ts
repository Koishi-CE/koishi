import { Context, Schema } from '@koishi-ce/koishi'
import { resolve } from 'path'
import {} from '@koishi-ce/console'
import EnvInfoProvider from './envinfo'
import ProfileProvider from './profile'

export type Activity = Record<number, number>

declare module 'koishi' {
  interface Channel {
    name: string
    activity: Activity
  }
}

declare module '@koishi-ce/console' {
  namespace Console {
    interface Services {
      envinfo: EnvInfoProvider
      status: ProfileProvider
    }
  }
}

export {
  EnvInfoProvider,
  ProfileProvider,
}

export * from './envinfo'
export * from './profile'

export const name = 'status'
export const inject = ['console']

export interface Config extends ProfileProvider.Config, EnvInfoProvider.Config {}

export const Config: Schema<Config> = Schema.intersect([
  EnvInfoProvider.Config,
  ProfileProvider.Config,
])

export function apply(ctx: Context, config: Config) {
  ctx.console.addEntry({
    dev: resolve(__dirname, '../client/index.ts'),
    prod: resolve(__dirname, '../dist'),
  })

  ctx.plugin(EnvInfoProvider, config)
  ctx.plugin(ProfileProvider, config)
}
