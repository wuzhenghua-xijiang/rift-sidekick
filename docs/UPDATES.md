# Windows 应用内更新与发布

公开仓库：[wuzhenghua-xijiang/rift-sidekick](https://github.com/wuzhenghua-xijiang/rift-sidekick)。安装包和更新元数据放在正式 GitHub Releases，源码不提交 `node_modules/`、构建产物、用户配置或密钥。

## 使用

偏好设置顶部“应用内更新”支持检查、镜像下载、进度与“安装并重启”。Windows 安装版启动七秒后检查一次，发现新版本只显示提示；下载和安装都由玩家点击。开发模式及其他操作系统不执行更新。

下载失败可以重试，已通过校验的安装包在当前进程中保留。安装前重新计算文件摘要，等待未完成的偏好保存，并检查实际客户端阶段。选人、匹配、加载、对局、配置写入和待恢复状态会阻止安装。通过后调用 NSIS `quitAndInstall(true, true)` 静默覆盖安装并重启；普通关闭不会触发安装。重启后偏好、缓存与快照保留。

0.1.5 及更早版本没有更新入口，需要手动安装新版一次。当前建议测试从已安装的 0.1.8 更新到 0.2.0；macOS 上的界面或下载检查不能证明 Windows 安装重启成功。

## 下载与信任

- 检索通过 `gh-proxy.com`、`gh-proxy.org` 同时请求 GitHub 最新 Release API，采用先返回的有效结果，避免单一镜像阻塞。
- 下载固定到检索所得的具体版本 `/releases/download/vX.Y.Z/`；按 `gh-proxy.com`、`gh-proxy.org`、`ghfast.top`、`ghproxy.net` 切换镜像，不依赖镜像提供的任意安装 URL。下载仍需用户点击，每个候选文件都核对签名清单中的双哈希。
- 仅允许高于当前版本的正式三段版本；跳过草稿、预发布和旧版本。安装器文件名固定为 `Rift-Sidekick-Setup-X.Y.Z-x64.exe`。
- `update-manifest.json` 用 Ed25519 签名，绑定版本、标签、安装器文件名、SHA-512 和 SHA-256。公钥内置，私钥位于仓库的 `RIFT_UPDATE_SIGNING_KEY` Actions Secret。
- `latest.yml` 仅可包含这一份完整安装器；其版本、相对文件名和 SHA-512 必须与验签清单一致，拒绝额外文件、Web installer 或不匹配的哈希。关闭差分下载，避免镜像不支持 Range 或旧 blockmap 导致失败。
- 下载完成与安装前都流式计算实际安装包的 SHA-512/SHA-256。镜像修改了文件、元数据或签名会阻止安装。镜像仍可能不可用或缓存旧版本，签名不能保证镜像的可用性和新鲜度。
- 这是更新发布清单的签名，不是 Windows Authenticode。当前没有 Windows 代码签名证书，`verifyUpdateCodeSignature` 明确关闭；系统可能仍显示未知发布者提示。

## 发版

1. 修改版本并更新对应发布说明，例如 `docs/releases/v0.2.0.md`。
2. 提交代码，创建并推送匹配 `package.json` 的 `vX.Y.Z` 标签。
3. `.github/workflows/release.yml` 在 Windows runner 执行类型检查、测试和打包；`scripts/sign-update.js` 检查标签、文件哈希及签名私钥与内置公钥的对应关系，然后生成清单。
4. 工作流上传安装器、blockmap、`latest.yml`、`update-manifest.json` 和 `SHA256SUMS.txt`。具体校验值以 Release 附件为准，不同平台重新构建的包可能不同。

不要覆盖已发布版本的安装器或更换现有签名密钥。后续若要轮换公钥，需先通过旧密钥签名的版本分发新公钥，不能只替换 Actions Secret。

## Windows 验收

0.1.7 已通过 139 项自动化测试和类型/生产构建检查。在实际 Electron 窗口用隔离样例核对检查中、发现新版、下载进度、安装就绪与按钮调用；430×900 和 390×520 下更新入口可用。见 [更新界面样例](screenshots/update-panel-fixture.png)。样例没有执行安装，不代表 Windows 安装重启已通过。

2026-10-26 线上检查：GitHub Windows 构建和签名发布工作流均成功，正式 Release 与镜像 API 均返回 v0.1.7。另用真实 electron-updater 6.8.11 的 NSIS 下载器在 macOS 上模拟旧版本号/Windows 更新频道，完整下载正式安装器 125810285 字节，并以客户端内置公钥验证发布清单、确认 SHA-512 与 SHA-256 一致。这证明镜像和实际下载器可共同工作，没有执行该 Windows 安装器。SHA-256 为 `d258e319748473e4857d1ef09259a6f43d251b3caccfc551d14d3ca8ebe9b70e`，与 Release 的校验附件一致。

2026-10-27，0.1.8 的 [Windows CI](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40431315723) 和 [签名发布](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40431316281) 成功，157 项测试通过。用同一实际 NSIS 下载器模拟从 0.1.7 更新，通过镜像版本目录完整下载 125817376 字节的正式安装器；内置公钥验证清单签名，SHA-512 与 SHA-256 均一致，后者为 `42261e2318add335ad8a488caed594e690492a919fa1de970bde12e4af7331e2`。没有执行安装器，不代表 Windows 安装重启或实际游戏联动已通过。

2026-10-27，0.2.0 的 [Windows CI](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40466923617) 与 [签名发布](https://github.com/wuzhenghua-xijiang/rift-sidekick/actions/runs/40466923012) 均成功，32 个测试文件、267 项测试全部通过。已从正式 Release 完整下载 126200536 字节安装器，直接使用客户端 `update-policy.ts` 确认从 0.1.8 升级可被接受，Ed25519 清单签名与 SHA-512 / SHA-256 均通过；同时核对 `latest.yml`、`SHA256SUMS.txt`、五份附件的大小及 GitHub 摘要。SHA-256 为 `b683795dbe40eed0d32503960bd1d3abe43caf14dd13e62cc5f7e96b537428ca`。应用内更新镜像 API 已返回 v0.2.0；本次完整下载来自 GitHub 正式附件，未执行 Windows 安装器，实际安装重启与游戏联动仍待 Windows 验收。

- 从旧安装版检查更新，确认版本和进度；断网后重试，当前功能仍可用。
- 校验失败不得出现安装按钮；下载完成后替换缓存文件应拒绝安装。
- 选人、对局和正在恢复配置期间不得重启；返回大厅后同一包可继续安装。
- 安装完成后显示新版本，托盘与单实例机制正常，偏好和恢复快照保留。
- 拒绝管理员提升、杀毒拦截或磁盘空间不足时，确认可重新启动原版并再次尝试。

实现依据：[electron-builder 自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[electron-updater NSIS 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts)、[GitHub Release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)、[GH-Proxy 官方指南](https://gh-proxy.com/en/docs/github-accelerator)。实际实现按锁定的 `electron-updater` 6.8.11 API 调用。
