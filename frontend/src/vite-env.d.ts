/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG?: string
  readonly VITE_ICE_SERVERS?: string
}

interface Window {
  onYouTubeIframeAPIReady?: () => void
}
