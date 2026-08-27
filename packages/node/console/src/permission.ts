import { Context } from '@koishi-ce/koishi'
import { DataService } from './service'

export class PermissionProvider extends DataService<string[]> {
  constructor(ctx: Context) {
    super(ctx, 'permissions', { immediate: true })

    ctx.on('internal/permission', () => this.refresh())
  }

  async get() {
    return this.ctx.permissions.list()
  }
}
