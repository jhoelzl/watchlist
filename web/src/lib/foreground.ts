import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'

export function onForeground(refresh: () => void, onError: (error: unknown) => void): () => void {
  if (!Capacitor.isNativePlatform()) {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  let disposed = false
  let listener: PluginListenerHandle | undefined
  const remove = (handle: PluginListenerHandle) => { void handle.remove().catch(onError) }
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!disposed && isActive) refresh()
  }).then((handle) => {
    if (disposed) remove(handle)
    else listener = handle
  }).catch((error: unknown) => { if (!disposed) onError(error) })
  return () => {
    disposed = true
    if (listener) remove(listener)
  }
}
