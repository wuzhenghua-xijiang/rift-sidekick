# 国服自动登录可行性研究

核查日期：2026-10-28。目标是本项目直接打开的国服 `Launcher\Client.exe`，不经过 WeGame。本文记录研究结果，不代表已通过真实 QQ 登录验收；当前产品仍由官方窗口处理登录，不接收或保存 QQ 密码。

## 结论

**窗口辅助登录有实现依据，值得做 Windows 实机原型；当前没有足够证据承诺新版国服后台直登或完全无人值守。**

| 路线 | 已核实的依据 | 对当前项目的判断 |
| --- | --- | --- |
| 复用官方登录状态 | Riot 国际服官方说明有保持登录能力；本项目能直接打开国服官方入口 | 优先观察目标国服版本是否有并能复用该状态，不能由国际服资料推断国服一定支持 |
| 官方窗口辅助登录 | 国服开源项目已有 UI Automation 和 TPF 渲染面板 OCR 输入实现 | 最有实施依据；仍需验证新版入口、焦点、权限、大区及验证流程 |
| 账号密码启动参数 | 已核对的本项目及参考项目只使用程序启动或窗口操作 | 尚未找到当前国服可验证的通用 QQ 账号密码参数 |
| 腾讯本地登录接口 | Riot Client 社区接口导出确有 `tencent-launcher` 登录相关端点 | 依赖腾讯 SDK 及启动器提供的凭据；不能直接当作 QQ 账号密码登录接口 |
| RSO / 国际服自动登录 | 有 Riot 身份认证实现及 OAuth 授权资料 | 与国服 QQ 登录不是同一认证链路，不能直接移植 |

## 新发现一：新版渲染面板已有 OCR 实现

核对 [LOL-GameAssistant 的固定版本 23083d0](https://github.com/shecong/LOL-GameAssistant/tree/23083d028eae8243d69de5bde747b5fb5ff9ba6b)（提交时间 2026-10-28），发现其不只操作传统输入框：

- [TclsLoginAutomation.cs](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsLoginAutomation.cs) 尝试通过 UI Automation 的可写输入框和按钮操作登录及大区。
- [TclsRenderedLoginAutomation.cs](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsRenderedLoginAutomation.cs) 针对没有暴露可操作 UIA 控件的 TPF 面板，使用 PaddleOCR 识别账号、密码和进入游戏等文字，再推算输入区域并模拟输入。识别到 QQ/微信入口时可先选择 QQ。
- 其流程限定目标窗口、前台焦点和未遮挡区域，遇到验证码、登录验证或失败文字停止；不应将这种实现描述为绕过验证。

**它仍不是当前项目可直接接入且已验收的方案：**

1. [GameClientExecutablePaths.cs](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant/Infrastructure/LeagueClient/GameClientExecutablePaths.cs) 仍将 `TCLS\client.exe` 识别为腾讯启动入口；[TclsAutomaticClientLauncher.cs](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsAutomaticClientLauncher.cs) 的自动登录入口依赖这个判断。它会观察后续出现的 Launcher 窗口，但这不能证明直接选择新版 `Launcher\Client.exe` 的流程已打通。
2. OCR 根据文字和布局估算输入位置，不能据此保证安全输入框接受模拟输入，也不能保证所有分辨率、缩放及客户端更新后的布局都有效。
3. [TclsRenderedLoginTests.cs](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant.UiTests/TclsRenderedLoginTests.cs) 的 OCR 检查使用程序绘制的位图，缩放与坐标测试使用构造数据。这些测试证明识别和计算逻辑，未证明真实新版国服 QQ 登录成功。

## 新发现二：确有腾讯登录端点，但不是密码透传

核对 [Riot Client 社区接口导出 data_info.json](https://github.com/KebsCS/lcu-and-riotclient-api/blob/e8c7cf2ad885f6af82dfcad87be9afa5792dae66/riotclient/data_info.json)（快照提交日期 2026-10-18）：

| 端点 | 导出文档中的用途和前提 |
| --- | --- |
| `POST /tencent-launcher/v1/init-aclsdk` | 初始化 ACLSDK，参数为腾讯提供的游戏 ID 和游戏 Key；需要腾讯发行配置及 `ACLSDK.dll` |
| `POST /tencent-launcher/v1/login` | 取得 Tencent Launcher 的 mSDK 凭据后，完成合作方 RSO 认证；不是提交 QQ 用户名和密码 |
| `GET /tencent-launcher/v1/login-info` | 读取 SDK 已取得的 `openid`、`token`、`channel`、`ext` 等不透明凭据；尚未初始化成功时返回不可用状态 |
| `PUT /rso-auth/v1/session/login-token` | 使用 rso-authenticator 生成的令牌建立认证会话，不能自行生成 QQ 登录令牌 |

该文件属于社区导出的 Riot Client 接口资料，不是腾讯针对当前国服 Launcher 的公开接入文档。尚未取得目标客户端运行时端点、所需 SDK 配置、有效调用结果或真实登录证据；不能仅凭端点名称推导出后台直登已经可用。导出中的部分登录端点还带有迁移/删除提示，存在版本变化风险。

同一导出中的 `POST /rso-auth/v1/authorization/gas` 虽说明可接收用户名、密码和平台参数，但其描述明确涉及 RSO，遇到额外验证码或多因素认证会失败；没有证据说明它支持当前国服 QQ 登录。

## 其他边界

- [Riot 官方保持登录说明](https://support.riotgames.com/en-us/league-of-legends/client/installing-the-updated-league-client/) 可作为国际服能力依据，不能替代国服验证。是否存在 QQ 快速登录、是否需要扫码或确认，应读取实际官方窗口后再决定。
- [Riot 开发者 FAQ](https://developer.riotgames.com/docs/faqs) 中的 RSO 是第三方应用授权机制；获批生产应用的授权流程不等同于替玩家登录桌面客户端。
- [Microsoft SendInput 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) 说明输入注入受 UIPI 限制，只能面向相同或更低完整性级别的目标。助手普通权限、官方窗口管理员权限时，不能承诺输入成功；需要实测并明确提示权限不匹配，不能静默反复输入。
- 本项目 LCU 的端口及令牌用于连接本地游戏客户端，并非 QQ 账号密码，也不能替代腾讯认证。成功标准应是取得真实登录后的账号与大区状态，而不是点击按钮、进程出现或窗口关闭。

## 建议的下一步：最小 Windows 实机原型

先用真实新版官方入口验证窗口能力，再决定是否实现账号管理。不要先恢复旧 TCLS 入口或凭据设置。

1. **无凭据观察：** 从本项目现有 ShellExecute 路径启动，记录目标路径、窗口归属、进程权限、DPI 和 UIA 控件结构，确认 QQ 登录与大区界面；观察官方已保存登录状态能否复用。诊断信息不采集输入框内容、令牌或密码，不保存带凭据的截图。
2. **受控操作：** UIA 可用时优先使用控件操作；仅在确认新版面板布局与窗口归属后尝试 OCR。每次输入、提交及大区切换前重新检查目标和焦点；用户切走窗口或面板状态不明确时立即停止，避免把密码输入其他应用。
3. **人工接管：** 验证码、短信、扫码、设备确认、账号冻结等交给用户。不能把“自动输入”宣传成“免验证登录”；不在验证状态下自动重试提交。
4. **完成读回：** 登录后等待真实 LCU 状态，核对预期账号与大区，才报告完成；失败、超时、用户接管及已有账号会话分开处理，避免误切账号。

最小验收包括正常密码登录、官方可复用状态、验证出现、错误密码、大区选择、DPI 变化、管理员权限窗口，以及用户中途切换前台应用。当前环境为 macOS，尚未对真实 Windows 国服登录窗口执行以上验证。

若实机原型通过，再单独决定账号保存方式。Windows 的 DPAPI CurrentUser 是可研究的本机加密方案；[参考项目的存储实现](https://github.com/shecong/LOL-GameAssistant/blob/23083d028eae8243d69de5bde747b5fb5ff9ba6b/LOL-GameAssistant/Infrastructure/LeagueClient/LocalTclsAccountStore.cs) 已采用该机制。本次没有引入凭据存储、登录输入或新的权限要求。
