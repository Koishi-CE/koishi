import { Context } from '@koishi-ce/client'
import Bots from './index.vue'

export default (ctx: Context) => {
  ctx.slot({
    type: 'status-right',
    component: Bots,
  })
}
