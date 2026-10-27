# 启动客户端与性能优化

0.2.0 新增功能；Windows 启动、权限和真实对局仍待实机验收。

助手启动后自动扫描游戏安装注册表、运行中的客户端路径、开始菜单/桌面快捷方式、Riot 本地安装清单和常见游戏目录；仍未找到时，自动扫描本地固定磁盘的目录，限制为 45 秒/十万个目录，跳过系统、依赖缓存及目录联接。后台扫描不会阻塞窗口。找到后自动选用并保存位置，下次先校验已记住的位置；游戏搬家后自动重新查找，也可点击「重新查找」主动刷新。

从首页入口或左侧「游戏启动」直接启动。未识别到时仍保留「手动选择」作为备用，选择 `LeagueClient.exe` 或国服安装目录中的 `TCLS\Client.exe`，也可选择国际服 `RiotClientServices.exe`。多个入口可以切换。不会选择或启动 WeGame；即使游戏安装在 WeGameApps 目录下，也直接使用游戏内的官方程序。

「启动前性能优化」默认开启。点击「优化并启动英雄联盟」后的顺序为：

1. 检查 CPU、内存和电源计划。
2. 设备提供标准高性能计划时切换并读回核验；未提供时保留当前方案并显示说明。
3. 降低助手后台优先级，临时阻止系统自动休眠。
4. 以上检查和可用优化完成后，才启动官方客户端。切换或核验失败时停止启动，保留原因和恢复入口；资源紧张和设备不支持的项目单独提示。

选人或游戏状态轮询不会启动整机优化。游戏进程出现后，仅跟进其进程优先级，尝试设置为 AboveNormal，游戏保护或系统拒绝时显示限制；不会使用 High 或实时优先级。已经运行的客户端只请求唤回，避免启动第二个客户端或在启动后补做整机优化。

对局结束、取消选人、关闭优化开关、手动点击恢复或彻底退出助手时，恢复本次改动。关闭到托盘继续保留本次会话。先写入 `performance.json` 恢复快照再修改系统；异常退出后下次启动尝试恢复。恢复电源计划前检查当前计划，保留玩家后来手动切换的方案；游戏进程同时校验 PID 和启动时间，避免恢复到复用同一 PID 的其他进程。恢复失败时保留快照并允许重试。

性能优化不会关闭其他应用、清理用户文件、清空工作集、修改游戏文件或注入进程。CPU/内存为最近一次启动检查的数据，不能据此保证固定帧率增益。高性能计划会增加功耗，设备散热和其他后台负载仍会影响实际表现。

## 国服 QQ 自动登录

源码已接入助手内填写 QQ 账号密码，再自动填写官方 TCLS 登录窗口的流程，仅支持 Windows 国服。没有接入 WeGame DLL 或国际服 Riot 密码接口，也没有实现无窗口的登录票据透传。关闭自动填写时，仍可复用官方保存的登录状态，或者在官方窗口手动输入/扫码。

1. 进入「游戏启动」，等待自动找到国服安装位置。若保存的是 `LeagueClient.exe`，开启 QQ 自动填写后会查找同一安装目录中的 `TCLS\Client.exe`；找不到时停止启动并提示重新选择，不把 QQ 密码交给 Riot 客户端。
2. 打开「国服 QQ 登录」的「自动填写 QQ 登录」，输入账号密码，点击「保存登录设置」。默认只保留在助手主进程内存中，退出后需要重新输入。
3. 如需重启后继续使用，勾选「在此电脑记住密码」。账号和密码一起使用 Electron `safeStorage` 在 Windows 本机加密，写入用户配置目录下独立的 `tcls-login.json`；系统加密不可用时拒绝记住，不回退明文。清除账号会移除保存的密文并关闭自动填写。密码不会回传渲染进程；同一账号可将密码栏留空继续使用，换账号必须重新输入密码。
4. 点击「优化并启动英雄联盟」。登录设置通过检查后，先完成性能优化，再直接打开 TCLS，随后开始自动填写。请将官方登录窗口保持在前台；助手不会反复抢焦点。
5. 每次尝试最多提交一次。验证码、密码错误或大区选择会停止自动操作并提示在官方窗口处理。识别失败或等待约 90 秒后也会停止，不反复提交；可随时点击「停止自动填写」。客户端已运行时仅唤回，不填写或切换正在使用的账号。

旧式控件使用 Windows UI Automation；绘制式界面使用 Windows 自带中文 OCR 识别完整的 QQ 表单，再发送输入，检查窗口路径、PID、进程启动时间和前台窗口。OCR 只读取本机登录面板，截图仅存在于内存；密码通过子进程标准输入传递，不进入命令行、剪贴板、脚本文件或日志。系统未安装简体中文 OCR、窗口被遮挡/最小化、登录器以更高权限运行或布局不受支持时可能需要手动登录。助手退出、检测到 LCU 连接或用户取消时停止后续输入；自动填写期间阻止安装更新。

只有已有 LCU 连接确认后才显示客户端已连接；「账号密码已提交一次」只代表已尝试提交，账号及大区仍应在官方客户端核对。本功能的当前国服版本兼容性待 Windows 实测，验收项目见 [Windows 验收清单](WINDOWS-ACCEPTANCE.md#国服-qq-自动登录)。

2026-10-27 GitHub 复核：[`shecong/LOL-GameAssistant` 的 TCLS 实现](https://github.com/shecong/LOL-GameAssistant/blob/f823b2c1a757ee9abbd106698235cb39eff7f04b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsLoginAutomation.cs#L32-L56) 通过 Windows UI Automation 写入账号密码并点击登录；[绘制式登录界面的适配](https://github.com/shecong/LOL-GameAssistant/blob/f823b2c1a757ee9abbd106698235cb39eff7f04b/LOL-GameAssistant/Infrastructure/LeagueClient/TclsRenderedLoginAutomation.cs#L14-L77) 使用本地 OCR 和前台窗口输入。此项目参考其表单几何识别思路，改用 Windows 原生控件和系统 OCR，未引入 FlaUI/PaddleOCR；授权说明随包保留在 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)。上游相关测试使用模拟窗口和生成图片，也不能据此确认当前国服登录器兼容性。国际服 Riot RSO 文档不能作为判断国服 QQ/TCLS 登录能力的依据。

WeGame 的平台会话与助手自动填写需要分别核实：GitHub 中的[腾讯 Rail SDK 头文件](https://github.com/GaiaWorld/pi_rail/blob/47afe72381df48d6d0e2a1d8e63385f8b3be8735/rail/sdk/rail_player.h) 暴露会话票据接口；另有[调用 WeGame 内部登录模块的逆向项目](https://github.com/fantasyboy/WeGameLogin/blob/2a193f8daa52939598d0b833719b6dfdd088ffcd/GameFunction.cpp#L18-L112)。这些资料说明平台登录和游戏启动存在集成方式，不能据此确认当前 LOL 国服具体使用的传递协议，也不能将依赖 WeGame 内部 DLL 的路线用于本项目的直接启动要求。

实现依据：[Microsoft powercfg](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options)、[进程优先级定义](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processpriorityclass)、[LeagueAkari 官方客户端启动实现](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/main/shards/client-installation/client-launcher.ts)。

本地验证（2026-10-27）：类型检查、生产构建通过，当前工作区完整测试为 257 项通过、2 项 Windows 原生检查按平台跳过。31 项启动/优化/自动登录相关测试覆盖自动扫描与缓存失效、启动顺序、失败阻断、重复启动、密码保密与加密/损坏存储、切换账号、取消和连接后停止、进程传输白名单，以及原有性能恢复路径。Windows CI 会解析真实 PowerShell 脚本、编译 UIA/输入代码并校验 OCR 表单几何，当前 macOS 无法执行这些原生检查。

Playwright 在隔离 Electron 表单样例中操作了开关、输入、保存、启动等待、停止与清除，确认密码掩码、保存后清空、未保存阻止启动，以及 430×900、390×520 下无横向溢出、页面无运行错误。样例使用模拟桥接和测试账号，不证明 Windows 加密、TCLS 或 OCR 实际登录成功；[表单预览](../output/playwright/tcls-login/qq-login-form.png) 与早先的 [macOS 页面预览](screenshots/game-launch-macos-preview.png) 均不代表 Windows 实机验收。
