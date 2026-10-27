import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_JUNGLE_RULES, type JungleState } from '@shared/jungle'

const native = vi.hoisted(() => ({ windows: [] as any[] }))
vi.mock('electron', () => ({
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  screen: { screenToDipRect: (_: unknown, bounds: unknown) => bounds, getDisplayMatching: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }) },
  BrowserWindow: class {
    bounds = { x: 0, y: 0, width: 264, height: 394 }
    visible = false
    destroyed = false
    options: unknown
    handlers = new Map<string, () => void>()
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), isLoading: () => false }
    constructor(options: unknown) { this.options = options; native.windows.push(this) }
    setMenu = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setAlwaysOnTop = vi.fn()
    showInactive = vi.fn(() => { this.visible = true })
    hide = vi.fn(() => { this.visible = false })
    loadFile = vi.fn()
    loadURL = vi.fn()
    once = vi.fn()
    on = vi.fn((event: string, handler: () => void) => { this.handlers.set(event, handler) })
    getBounds = () => ({ ...this.bounds })
    setBounds = vi.fn((value: typeof this.bounds) => { this.bounds = value })
    isVisible = () => this.visible
    isDestroyed = () => this.destroyed
    destroy = vi.fn(() => { this.destroyed = true })
  },
}))
import { JungleOverlay } from './jungle-overlay'
const live: JungleState = { enabled: true, status: 'live', gameId: '123', gameTime: 100, sampledAt: 0, timers: [], rules: DEFAULT_JUNGLE_RULES, message: '' }
const game = { visible: true, foreground: true, x: -1800, y: 50, width: 1280, height: 720 }
afterEach(() => { native.windows.length = 0 })
describe('game-only timer overlay', () => {
  it('is hidden outside the game and never requests keyboard focus', () => {
    const overlay = new JungleOverlay(vi.fn())
    overlay.update(live); expect(native.windows).toHaveLength(0)
    overlay.observe(game)
    const win = native.windows[0]
    expect(win.options).toMatchObject({ focusable: false, skipTaskbar: true, frame: false })
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    expect(win.showInactive).toHaveBeenCalledOnce()
    overlay.observe({ ...game, foreground: false }); expect(win.visible).toBe(false)
    overlay.observe(game); expect(win.visible).toBe(true)
    overlay.update({ ...live, status: 'unavailable' }); expect(win.visible).toBe(false)
    overlay.destroy()
  })
  it('switches mouse passthrough explicitly and resets interaction for the next game', () => {
    const overlay = new JungleOverlay(vi.fn()); overlay.update(live); overlay.observe(game)
    const win = native.windows[0]
    overlay.toggleInteraction()
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    const moves = win.setBounds.mock.calls.length
    overlay.update({ ...live, gameTime: 102 })
    expect(win.setBounds.mock.calls).toHaveLength(moves)
    overlay.hide(); overlay.update({ ...live, gameTime: 104 }); expect(win.visible).toBe(false)
    overlay.toggleInteraction(); expect(win.visible).toBe(true)
    overlay.update({ ...live, gameId: '124' })
    expect(overlay.interactive).toBe(false)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    overlay.destroy()
  })
  it('fits all layouts within the monitor on a negative-origin display', () => {
    const overlay = new JungleOverlay(vi.fn()); overlay.update(live); overlay.observe({ ...game, x: -2500, y: 1000 })
    overlay.layout(false, true)
    const win = native.windows[0]
    expect(win.bounds.x).toBeGreaterThanOrEqual(-1920)
    expect(win.bounds.y + win.bounds.height).toBeLessThanOrEqual(1040)
    overlay.layout(true, false); expect(win.bounds.height).toBe(54)
    overlay.destroy()
  })
  it('accepts an explicit tray request while the tray owns focus and shows it only back in game', () => {
    const overlay = new JungleOverlay(vi.fn()); overlay.update(live); overlay.observe(game)
    const win = native.windows[0]
    overlay.observe({ ...game, foreground: false })
    overlay.toggleInteraction(); expect(overlay.interactive).toBe(false)
    overlay.toggleInteraction(true); expect(overlay.interactive).toBe(true)
    expect(win.visible).toBe(false)
    overlay.observe(game); expect(win.visible).toBe(true)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    overlay.destroy()
  })
})
