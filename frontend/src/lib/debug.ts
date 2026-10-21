export const DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG === 'True'

export function debug(...args: unknown[]) {
  if (DEBUG) console.debug('[watch-together]', ...args)
}
