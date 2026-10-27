export interface TclsLoginInput {
  enabled: boolean
  username: string
  /** Empty keeps the existing password only when the account is unchanged. */
  password: string
  rememberPassword: boolean
}

/** This is the only account information sent back to the renderer. */
export interface TclsLoginState {
  supported: boolean
  enabled: boolean
  username: string
  hasPassword: boolean
  rememberPassword: boolean
  canRemember: boolean
  busy: boolean
  status: 'idle' | 'waiting' | 'filling' | 'submitted' | 'manual' | 'connected' | 'cancelled' | 'error' | 'unsupported'
  message: string
}

export const TCLS_PROGRESS = {
  window: { status: 'waiting', message: '等待国服 QQ 登录窗口…' },
  foreground: { status: 'waiting', message: '请将国服登录窗口放到最前方，助手会继续填写。' },
  uia: { status: 'filling', message: '正在填写国服 QQ 登录控件…' },
  ocr: { status: 'filling', message: '已识别国服 QQ 登录区域，正在填写…' },
  submitted: { status: 'submitted', message: '账号密码已提交一次，等待官方登录结果；不会自动重试。' },
  verification: { status: 'manual', message: '官方窗口需要验证，或账号登录未通过。自动操作已停止，请在官方窗口处理。' },
  region: { status: 'manual', message: '请在官方窗口确认大区并进入游戏，助手会在登录后自动连接。' },
  ocrUnavailable: { status: 'manual', message: '当前窗口没有可填写的控件，系统中文 OCR 也不可用。请在官方窗口手动登录。' },
  timeout: { status: 'manual', message: '等待登录超时，自动操作已停止。请在官方窗口确认登录结果；未重复提交密码。' },
  unsupported: { status: 'manual', message: '当前登录界面无法可靠识别，已停止自动操作。请在官方窗口手动登录。' },
  failed: { status: 'error', message: '国服自动填写未完成，已停止自动操作。请在官方窗口手动登录。' },
} as const

export type TclsProgress = keyof typeof TCLS_PROGRESS
