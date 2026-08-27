import { Activity, Dict } from '@koishi-ce/client'

declare module '@koishi-ce/client' {
  interface ActionContext {
    'theme.activity': Activity
  }

  interface Config {
    activities: Dict<ActivityOverride>
  }
}

interface ActivityOverride {
  hidden?: boolean
  parent?: string
  order?: number
  position?: 'top' | 'bottom'
}
