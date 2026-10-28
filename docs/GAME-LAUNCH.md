# 启动客户端与性能优化

2026-10-27 起，[0.2.1](releases/v0.2.1.md) 的启动窗和游戏启动页只负责优化与打开官方客户端，已移除 QQ 账号、密码、记住密码及自动填写入口。[0.2.2](releases/v0.2.2.md) 修复残留后台进程导致启动被跳过的问题。用户随后反馈助手启动客户端成功；系统授权、登录及对局的其他条目仍待实机验收。

## 默认查找国服官方客户端

助手自动读取安装注册表、运行中的游戏进程位置、桌面/开始菜单快捷方式、本地安装清单与常见目录。默认选择游戏根目录中的 `Launcher\Client.exe`，也支持已有的 `LeagueClient.exe`；不会扫描或启动 `TCLS\Client.exe`、`WeGameLauncher\launcher.exe` 或 WeGame。安装在 WeGameApps 目录中不影响直接启动，包含“英雄联盟（含经典模式）”的目录也会自动查找。

旧版本缓存为 `TCLS\Client.exe` 或 `startup_runner.exe` 时，只使用其父目录定位安装根目录，然后查找同目录的 `Launcher\Client.exe`。旧文件已被更新删除时仍可迁移；官方客户端缺失则重新扫描或提示选择，不回退 TCLS，不修改游戏的 WeGame 登录偏好文件。

常规查找仍无结果时，后台扫描本地固定磁盘目录，限制为 45 秒/十万个目录，跳过系统、依赖缓存及目录联接。找到的位置会保存；游戏搬家后重查，也可点击「重新查找」或「手动选择」。启动窗与游戏位置页显示实际路径，失败提示也附上本次启动路径。

## 启动与登录

点击启动后先完成下面的性能检查，再通过 Windows ShellExecute 打开已校验的官方程序，工作目录设为程序所在目录。此方式遵循官方程序的权限清单，需要管理员权限时由 Windows 显示正常授权窗口；取消授权、权限拒绝、文件或依赖缺失时给出具体原因并请求恢复本次优化。

助手检查同一安装目录的官方窗口出现后，才显示已打开客户端；单纯创建进程不算确认成功。窗口最多等待约 45 秒，系统授权单独等待；启动期间检测到新的 WeGame 进程或未确认官方窗口时显示失败，不杀死其他应用。只有 LCU 实际连接后才进入吸附小窗。

账号登录、官方已保存的登录状态、扫码、验证码及大区选择均由官方客户端处理。助手不接收、保存或填写 QQ 凭证，不加载旧版 `tcls-login.json`，也不再提供保存/清除/自动填写的 IPC 接口；历史存储文件不主动删除。当前 Windows 会话中已有可见客户端窗口时只唤回，包含 `Launcher\Client.exe` 的官方登录窗口，不启动第二个实例或切换账号。只有无窗口的后台进程时继续正常启动，不会结束这些进程。

0.2.1 曾将残留的 `LeagueClient.exe` 进程直接视为客户端已打开，随后唤回失败并跳过所选 EXE。Windows 原生测试已复现该缺陷。0.2.2 统一了检查与唤回的窗口条件；未知异常按状态检查、显示已有窗口、文件检查、性能优化及实际启动阶段提示，并附可用系统错误码与启动路径。

## 启动前性能优化

「启动前性能优化」默认开启，顺序为：

1. 检查 CPU、内存和电源计划。
2. 设备提供标准高性能计划时切换并读回核验；未提供时保留当前方案并显示说明。
3. 降低助手后台优先级，临时阻止系统自动休眠。
4. 完成检查和可用优化后，再打开官方客户端。必要步骤失败时停止启动；资源紧张或设备不支持的项目单独提示。

选人或游戏状态轮询不会启动整机优化。游戏进程出现后，仅尝试将其优先级设为 AboveNormal，系统拒绝时显示限制，不使用 High 或实时优先级。已经运行的客户端不会补做整机优化。

对局结束、取消选人、关闭优化、手动恢复或彻底退出助手时，恢复本次改动。关闭到托盘继续保留会话。先写入 `performance.json` 快照再修改系统，异常退出后下次启动尝试恢复。恢复电源计划时保留玩家后来手动切换的方案；进程恢复同时核对 PID 和启动时间。恢复失败保留快照并允许重试。

性能优化不会关闭其他应用、清理用户文件、清空工作集、修改游戏文件或注入进程。CPU/内存为最近一次启动检查的数据，不能保证固定帧率增益。实现依据：[Microsoft powercfg](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options)、[进程优先级定义](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processpriorityclass)。

## GitHub 交叉检索结论

本次没有找到可验证、适用于当前国服原生客户端的通用账号密码参数或公开本地登录接口。这不等于断言腾讯内部不存在集成协议；按用户要求，本项目停止自动填写路线，只负责打开官方客户端。

2026-10-28 的[自动登录补充研究](AUTO-LOGIN-RESEARCH.md) 找到 TPF 渲染面板的 OCR 自动输入实现，以及社区导出的腾讯 SDK 登录端点。前者仍有旧 TCLS 启动依赖且测试未证明真实新版登录；后者依赖启动器已有凭据，不能直接传入 QQ 账号密码。窗口辅助登录值得进行 Windows 实机原型验证，当前产品继续使用官方登录流程。

- [LeagueAkari 的安装发现](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/main/shards/client-installation/installation-detector.ts#L94-L98) 将 `Launcher\Client.exe` 作为国服原生入口，与 WeGameLauncher 单独处理。
- [rank-analysis 的启动实现](https://github.com/wnzzer/rank-analysis/blob/3878348ed516252083d1fc3fde606affe0e2ce6c/rank-analysis-app/src-tauri/src/command/launcher.rs) 使用 ShellExecute 遵循官方权限清单；[维护者说明](https://github.com/wnzzer/rank-analysis/issues/32#issuecomment-4884814846) 明确此功能免开 WeGame，但仍需在腾讯窗口登录。其源码与本项目采用相同的 Windows 启动方式，不采用其清理自启动注册表功能。
- [LOL-GameAssistant 的国服实现](https://github.com/shecong/LOL-GameAssistant/blob/f823b2c1a757ee9abbd106698235cb39eff7f04b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsLoginAutomation.cs) 使用 UI Automation；[lol_login](https://github.com/Skyonelu/lol_login/blob/41a74167d8d514f557898fd30b192e85ff9cd28f/lol_login.py) 通过图像定位及模拟输入操作窗口，均不能作为账号密码参数透传的证据。
- [WeGameLogin](https://github.com/fantasyboy/WeGameLogin/blob/2a193f8daa52939598d0b833719b6dfdd088ffcd/GameFunction.cpp#L18-L112) 依赖 WeGame 内部模块和地址匹配，不能直接用于“不经 WeGame”的原生启动需求，也不能据此确认当前国服的具体协议。

## 验证范围

启动测试覆盖自动选择官方入口、旧缓存迁移、拒绝 TCLS/WeGame、优化先于启动、重复点击、窗口确认、系统授权错误、分阶段诊断与失败恢复；主进程集成检查确认无需账号设置且不注册旧账号 IPC。Windows CI 解析真实 PowerShell 启动脚本并编译窗口检查代码，还会在有残留后台进程的情况下，从中文、空格和括号路径实际打开临时 Windows 窗口程序，核对 ShellExecute、工作目录、窗口确认及再次唤回；macOS 按平台跳过原生检查。

0.2.1 的 [Windows 检查](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40480985839) 和 [发布流水线](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40480985575) 曾通过 278 项测试，但没有覆盖残留后台进程跳过启动的缺陷。[失败复现](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40484131529) 已确认此判断有误；修复后新增上述原生窗口测试，0.2.2 的 [Windows 检查](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40486214312) 和 [发布流水线](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40486226106) 均成功，284 项测试全部通过。本地类型检查及启动相关 36 项测试通过，4 项因 macOS 平台跳过。

已下载并解包 0.2.2 正式安装器，确认内置版本和窗口判断、分阶段错误提示等修复代码；更新清单签名、SHA-512 / SHA-256、发布资产和更新元数据校验通过，现有 0.2.1 的更新策略接受新版。

界面沿用正式 React 组件和隔离示例桥接完成的 1100/840 启动窗与 430/390 小窗检查，截图和同尺寸对照见 [启动页验收报告](../output/playwright/official-launch-review.html)。自动化检查只覆盖临时窗口程序；用户已另外反馈通过助手启动客户端成功，其余实机项目见 [Windows 验收清单](WINDOWS-ACCEPTANCE.md#官方客户端启动页)。
