import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import type { JungleState } from '@shared/jungle'
import type { ObservedWindow } from './windows-dock'

export class JungleOverlay {
  window?: BrowserWindow
  interactive = false
  shortcutAvailable = false
  private current?: JungleState
  private game: ObservedWindow = { visible: false }
  private hiddenForGame?: string
  private collapsed = false
  private camps = false
  private offset?: { x: number; y: number }
  private positioning = false
  constructor(private onInteraction: () => void) {}
  registerShortcut() {
    if (process.platform === 'win32') this.shortcutAvailable = globalShortcut.register('Alt+Shift+J', () => this.toggleInteraction())
    this.onInteraction()
  }
  update(state: JungleState) {
    if (this.current?.gameId !== state.gameId) { this.hiddenForGame = undefined; this.interactive = false; this.offset = undefined }
    this.current = state
    this.sync()
  }
  observe(game: ObservedWindow) { this.game = game; this.sync() }
  toggleInteraction(fromTray = false) {
    if (this.current?.status !== 'live' || !this.game.visible || (!this.game.foreground && !fromTray)) return
    this.hiddenForGame = undefined
    this.interactive = !this.interactive
    this.sync(); this.onInteraction()
  }
  layout(collapsed: boolean, camps: boolean) { this.collapsed = collapsed; this.camps = camps; this.sync() }
  hide() { this.hiddenForGame = this.current?.gameId; this.interactive = false; this.window?.hide(); this.onInteraction() }
  destroy() {
    if (this.shortcutAvailable) globalShortcut.unregister('Alt+Shift+J')
    this.window?.destroy(); this.window = undefined
  }
  private create() {
    const window = new BrowserWindow({ width: 264, height: 394, frame: false, show: false, resizable: false, minimizable: false, maximizable: false,
      focusable: false, skipTaskbar: true, roundedCorners: false, backgroundColor: '#191823', title: 'Rift Sidekick · 野怪计时',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
    })
    this.window = window
    window.setMenu(null)
    window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) void window.loadURL(`${devUrl.split('#')[0]}#jungle`)
    else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'jungle' })
    window.once('ready-to-show', () => { this.onInteraction(); this.sync() })
    window.on('moved', () => {
      if (!this.interactive || this.positioning || !this.game.width) return
      const anchor = screen.screenToDipRect(null, { x: this.game.x || 0, y: this.game.y || 0, width: this.game.width, height: this.game.height || 0 })
      const bounds = window.getBounds()
      this.offset = { x: bounds.x - anchor.x, y: bounds.y - anchor.y }
    })
    window.on('closed', () => { this.window = undefined })
    return window
  }
  private sync() {
    const state = this.current
    if (!state?.enabled || state.status !== 'live' || !this.game.visible || !this.game.foreground || !this.game.width || !this.game.height || this.hiddenForGame === state.gameId) { this.window?.hide(); return }
    const window = this.window || this.create()
    const anchor = screen.screenToDipRect(null, { x: this.game.x || 0, y: this.game.y || 0, width: this.game.width, height: this.game.height })
    const work = screen.getDisplayMatching(anchor).workArea
    const width = Math.min(264, work.width), height = Math.min(this.collapsed ? 54 : this.camps ? 526 : 394, work.height)
    const bounds = { width, height,
      x: Math.round(Math.max(work.x, Math.min(anchor.x + (this.offset?.x ?? anchor.width - width - 16), work.x + work.width - width))),
      y: Math.round(Math.max(work.y, Math.min(anchor.y + (this.offset?.y ?? 100), work.y + work.height - height))),
    }
    const current = window.getBounds()
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
      this.positioning = true; window.setBounds(bounds, false); setImmediate(() => { this.positioning = false })
    }
    window.setIgnoreMouseEvents(!this.interactive, { forward: true })
    window.setAlwaysOnTop(true, 'floating')
    if (!window.isVisible() && !window.webContents.isLoading()) window.showInactive()
  }
}
