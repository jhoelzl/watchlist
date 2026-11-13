import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(),
  addListener: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNative } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener } }))

import { onForeground } from './foreground'

beforeEach(() => {
  mocks.isNative.mockReset()
  mocks.addListener.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('foreground refresh', () => {
  it('refreshes only when a browser tab becomes visible and removes its listener', () => {
    const document = new EventTarget()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
    vi.stubGlobal('document', document)
    const refresh = vi.fn()
    const dispose = onForeground(refresh, vi.fn())
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on native resume and removes the listener', async () => {
    mocks.isNative.mockReturnValue(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    let change: (state: { isActive: boolean }) => void = () => {}
    mocks.addListener.mockImplementation((_name, callback) => { change = callback; return Promise.resolve({ remove }) })
    const refresh = vi.fn()
    const dispose = onForeground(refresh, vi.fn())
    await Promise.resolve()
    change({ isActive: false })
    change({ isActive: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
    change({ isActive: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('removes a native listener that resolves after cleanup', async () => {
    mocks.isNative.mockReturnValue(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    let resolve: (handle: { remove: typeof remove }) => void = () => {}
    mocks.addListener.mockReturnValue(new Promise((done) => { resolve = done }))
    const dispose = onForeground(vi.fn(), vi.fn())
    dispose()
    resolve({ remove })
    await Promise.resolve()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('reports native registration failures', async () => {
    mocks.isNative.mockReturnValue(true)
    const error = new Error('registration failed')
    mocks.addListener.mockRejectedValue(error)
    const report = vi.fn()
    const dispose = onForeground(vi.fn(), report)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error))
    dispose()
  })
})
