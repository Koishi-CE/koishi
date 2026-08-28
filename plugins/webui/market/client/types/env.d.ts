/// <reference types="vite/client" />

declare module '*.vue' {
  import { Component } from 'vue'
  const component: Component
  export default component
}

declare module '*.yaml' {
  const content: {}
  export default content
}

declare module '*.yml' {
  const content: {}
  export default content
}

declare module '*.scss' {
  const content: string
  export default content
}

declare module 'virtual:uno.css'
