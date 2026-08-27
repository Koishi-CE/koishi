import { Context, Dict } from '@koishi-ce/koishi'
import { DataService } from '@koishi-ce/console'
import { DependencyMetaKey, RemotePackage } from '@koishi-ce/registry'
import { Dependency } from './installer'

class DependencyProvider extends DataService<Dict<Dependency>> {
  constructor(public ctx: Context) {
    super(ctx, 'dependencies', { authority: 4 })
  }

  async get() {
    return this.ctx.installer.getDeps()
  }
}

class RegistryProvider extends DataService<Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>> {
  constructor(public ctx: Context) {
    super(ctx, 'registry', { authority: 4 })
  }

  async get() {
    return this.ctx.installer.fullCache
  }
}

export { DependencyProvider, RegistryProvider }
