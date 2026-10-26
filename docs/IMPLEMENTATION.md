# 实现说明与 PRD 对齐

交付版本：0.1.7。覆盖“识别 → 推荐 → 配置 → 开局隐藏 → 赛后分析与点赞”，并支持 GitHub 正式版应用内更新：镜像检索、Ed25519 清单签名、下载后/安装前 SHA-512 与 SHA-256 校验、静默安装重启。Windows 客户端联动和安装重启仍需实机验收。完整审查见 [产品审查](PRODUCT-REVIEW.md)，更新和发布流程见 [UPDATES.md](UPDATES.md)。

## 能力矩阵

| PRD 能力 | 实现状态 | 行为与边界 |
| --- | --- | --- |
| Windows 版本 | 已实现 | x64 NSIS 安装器，不提供 macOS/Linux 发布包 |
| GitHub 与应用内更新 | 已发布，安装重启待 Windows 实测 | GitHub Actions 构建正式 Release，镜像检索/下载，固定仓库与版本，Ed25519 签名、双哈希和安装前重验；下载进度/失败重试/安装重启。对局、选人、匹配、配置或点赞写入期间阻止安装，普通关闭不自动安装 |
| 客户端侧边吸附 | 已实现，待 Windows 实测 | 原生窗口矩形、DPI 转换、多屏工作区、右侧优先、最小化跟随；不会绘制到游戏画面内 |
| 托盘与后台唤回 | 已实现，待 Windows 实测 | Windows 托盘双击显示，右键显示/隐藏/彻底退出；关闭按钮在托盘可用时隐藏。手动隐藏暂停吸附唤回，赛后仍可恢复；托盘创建失败时正常关闭 |
| 经典峡谷排位/匹配/自定义识别 | 已实现 | 按地图、队列和模式判断，显示经典模式及单双排/灵活；统一使用峡谷推荐策略；明确的特殊模式不因地图 11 被误判 |
| 大乱斗/海克斯/云顶/斗魂/特殊模式识别 | 已实现 | 队列 2400 或 KIWI 优先识别海克斯；未知模式不冒用峡谷配置；云顶切换阵容页；斗魂当前仅识别 |
| 选人和游戏阶段英雄识别 | 已实现，待 Windows 实测 | 预选与锁定分开；游戏阶段只使用客户端会话公开的己方身份匹配信息，不读内存 |
| 分路识别 | 已实现 | 优先客户端 assignedPosition；无信息时使用手动偏好，不根据英雄武断推断 |
| 敌方英雄识别 | 已实现，有数据边界 | 保留已亮英雄及锁定状态；对位建议只使用已锁定英雄，优先明确分路。没有敌方分路时，按分路统计推测唯一常用该位置的英雄并明确标注；无法唯一判断则等待或手动更正 |
| 多套方案卡片 | 已实现，有数据边界 | 最多 5 套，来源真实的不同核心成装或主副系；按胜率降序，偏好不置顶，缺少胜率排末尾；单卡展示主系基石、副系两枚符文、召唤师技能的官方图标，及成装和准确标注的样本胜率；小众英雄/模式可能不足三套 |
| 侧栏与配置状态 | 已实现 | 紧凑英雄/分路区、对位摘要默认折叠、热门榜置于方案之后；区分离线预览/未锁定/正在加载/可以配置/需要恢复。浏览其他英雄或模式可回到本局，“已选择”不代表已写入 |
| 场景/来源筛选 | 部分实现 | 可切换模式、分路、方案；对位页可筛选本局英雄。暂无优势/均势/劣势标签和职业选手/自定义来源 |
| 符文/商店装备/召唤师技能 | 已实现，待 Windows 实测 | 经典与普通大乱斗默认同步完整符文及装备，召唤师技能可开启；只保留核心成装、鞋子及后续成装。海克斯只同步装备 |
| 锁定后自动配置 | 已实现，待 Windows 实测 | 1150ms 防抖、一次选人状态只自动成功一次；优先保存的偏好，无偏好用胜率最高的一套，海克斯用首套装备参考；取消/换英雄时放弃旧请求 |
| 写入与恢复 | 已实现并有故障测试 | 串行互斥、持久化意图、读取确认、失败补偿、账号/对局校验、手动编辑冲突提示 |
| 游戏开始/结束窗口联动 | 已实现，待 Windows 实测 | GameStart/InProgress/Reconnect 隐藏窗口并暂停吸附；短暂掉线保持隐藏，结算或明确返回大厅等阶段恢复一次、不主动抢焦点，并打开本局复盘 |
| 加载/游戏内切换写入 | 降级 | 默认隐藏；主动唤回可浏览方案，写入被明确限制在选人阶段 |
| 技能加点/连招 | 部分实现 | 在对位手册展示来源提供的顺序与连招，推荐卡片保持紧凑；不接管技能加点，不高亮游戏内按钮 |
| 对位胜率 | 已实现 | OP.GG 当前分路的英雄对阵整场胜率，展示样本量，不称为线杀率 |
| 对位建议与注意事项 | 已实现 | 开局页和对位页显示双方 Data Dragon 基础技巧、分路提醒及可用的对阵样本；可折叠、手动修正，支持外号搜索。不声称实时冷却、视野或版本数值精准；剔除含数值调参的静态技巧 |
| 当前分路热门英雄 | 已实现 | OP.GG 全球/全段位/排位数据，按登场率排列，显示胜率、样本和版本，点选可看方案；经典峡谷可参考，不用于 ARAM/海克斯等模式 |
| 阵容总胜率/线杀率 | 未实现 | 没有可信、可用且版本明确的数据与模型，不组合单英雄胜率伪造队伍概率 |
| Buff/大招/水晶/眼位计时 | 未实现 | 当前没有合适的数据接入，不以抓包/读内存补齐 |
| 对线提醒/打野来向 | 未实现 | 缺少可靠的可用输入 |
| 死亡回放/对局分析 | 部分实现 | 结算展示本局 KDA、参团率、伤害占比、补刀/分钟、视野、我方伤害对比和事实性复盘提示；同次运行切页/回大厅/继续匹配保留只读报告，断连或新选人清除。仍有历史战绩及整场回放请求，没有阵亡即时视频或逐帧复盘 |
| 赛后一键点赞 | 已实现，待 Windows 实测 | 按客户端实际票数和可选玩家勾选，手动点击后逐人提交 HEART 并完成荣誉投票；提交前核验账号、阶段、游戏编号和新票单，开始写入后不自动重试 |
| 自己的战绩/段位/熟练度 | 已实现，待 Windows 实测 | 按身份匹配当前玩家；战绩每页 20 场，最多 200；单接口失败单独提示 |
| 选人队友侦查 | 未实现 | 不绕过匿名身份或隐私限制 |
| 云顶之弈 | 已实现 | 真实当季阵容、推荐站位、装备、样本统计和阵容代码；不自动买棋/排阵 |
| 斗魂竞技场阶段/血量/胜负 | 未实现 | 仅模式识别与停用不适用配置；无可靠实时数据接入 |
| 大乱斗独立方案 | 已实现 | 使用 ARAM 统计，地图和技能写入校验独立；无专属 Buff 展示 |
| 海克斯大乱斗 | 识别及装备参考 | 该模式停用常规符文；只同步明确标注的普通大乱斗装备参考，不套用胜率或对位数据，不请求符文页，也不更改召唤师技能 |
| 自动接受/自动 BP/喊话 | 未纳入 | PRD 可选范围，此版本没有启用这些动作 |
| 假设出装模拟/自定义符文连招 | 未纳入 | PRD 明确不属于本期目标 |

## 结构与数据路径

```text
renderer (React，隔离渲染进程)
    ↓ 受限 preload IPC
main/index.ts（偏好、调度、已注册方案、自动配置）
    ├─ lcu.ts → 127.0.0.1 HTTPS → LeagueClientUx
    ├─ configuration.ts → 校验/意图日志/写入/读回/恢复
    ├─ data.ts + catalog.ts → Data Dragon 资源与合法性校验
    ├─ opgg.ts + recommendations.ts → 完整 OP.GG 统计与 MCP 回退、方案筛选
    ├─ tft.ts → OP.GG MCP；与推荐共享串行请求和限流退让
    ├─ profile.ts → 自己的战绩、段位与熟练度
    ├─ lane-rankings.ts → OP.GG 分路登场率、胜率与常用分路
    ├─ postgame.ts → 本局结算解析、荣誉票单校验与手动提交
    ├─ shared/gameflow.ts + shared/matchup.ts → 窗口阶段策略、已锁定同位置对手判断
    ├─ shared/configuration-status.ts → 与偏好选中区分的即时配置状态
    └─ windows-dock.ts → 单个 PowerShell 辅助进程 → Win32 窗口位置
```

客户端读取：`/lol-gameflow/v1/gameflow-phase`、`/lol-gameflow/v1/session`、`/lol-champ-select/v1/session`、`/lol-summoner/v1/current-summoner`、`/lol-patch/v1/game-version`。

写入：`/lol-perks/v1/pages`、`/lol-perks/v1/pages/{id}`、`/lol-perks/v1/currentpage`、`/lol-item-sets/v1/item-sets/{summonerId}/sets`，可选 `/lol-champ-select/v1/session/my-selection`。

战绩与回放：`/lol-match-history/v1/products/lol/current-summoner/matches`、`/lol-champion-mastery/v1/local-player/champion-mastery`、`/lol-ranked/v1/current-ranked-stats`、`/lol-replays/v1/rofls/{gameId}/download|watch`。回放仅接受本机刚查询的自己的战绩编号，且不在选人/游戏阶段启动。

本局结算读取：`GET /lol-end-of-game/v1/eog-stats-block`。荣誉票单读取：`GET /lol-honor-v2/v1/ballot`；逐人投票：`POST /lol-honor/v1/honor`，参数为 `honorType: HEART` 与 `recipientPuuid`；完成投票：`POST /lol-honor/v1/ballot`。最后一个 POST 会结束投票，不能拿来当查询端点。读取结算与票单不会触发写入。

## 一致性与降级

LCU 没有跨符文、装备和技能的事务。使用“先保存意图 → 逐项写入 → 读取确认 → 失败时补偿”的方式，不能声称服务端提供严格原子性。补偿断线、拒绝或读回不一致时保留恢复快照并阻止新的配置，重新连接原账号后可重试。

助手只操作自己创建的页和装备 UID。常规模式首次没有符文页空位就停止，不删除玩家其他页面。海克斯大乱斗不调用符文目录、库存或当前页接口，装备事务与恢复不依赖符文页容量。装备写入合并最近读取的集合；与客户端同时编辑仍存在没有服务端条件写入时的竞争窗口。恢复检测到玩家手动修改时停止对应恢复，提供保留当前内容的选项。

资源主次版本必须与客户端一致；完整统计响应的 `meta.version` 单独显示，已知统计主次版本不同也会阻止写入。MCP 回退没有版本时标注未提供，无法保证国服每次小更新均已同步。写入前检查装备 ID/地图、主副系符文槽位、可选技能。稀疏样本不会生成虚假的胜率、线杀率或阵容概率。核心装备与符文的统计各自标注，不将其解释为整套配置的联合胜率。

多方案先对真实核心装备组合去重，优先三组核心，再加入不同主副系组合，最多五组；样本不足不补造。成装按 Data Dragon 地图、合成关系、价格及鞋子/辅助装类别筛选，排除出门装和小件，避免同件装备及进化前后装备同时进入六格。配置内容与偏好 ID 由英雄/模式/分路及配置生成，不随胜率和样本数变化而失效。

候选方案在输出到界面前按胜率降序排列，同胜率保留来源顺序，缺失或不合法的胜率排末尾。偏好仅标记选中状态，不改变排序；自动配置仍优先使用保存的偏好。海克斯没有独立胜率，保留装备参考的来源顺序。基石与副系小符文图标按实际选中的符文 ID 从 Data Dragon 目录取得，不从截图猜测 ID，也不限制为截图中的历史符文。召唤师技能同样按推荐 ID 取得当前资源版本的图标和名称；显示推荐不代表已写入，实际同步仍由现有开关控制，海克斯不套用普通大乱斗的技能推荐。

同位置对手优先采用客户端明确分路，不按队伍数组下标猜位置。仅有一个已锁定、分路未知的敌方英雄在该位置的使用占比达到 65% 时才显示推测；多个候选、预选、其他模式均不自动指定。双方技巧来自 Data Dragon，局部失败不影响方案；分路榜共享十分钟缓存并合并并发请求。

本局结算必须匹配游戏编号及当前账号 PUUID，缺少 PUUID 才允许按 summonerId 匹配，不默认取首位玩家。胜负未确认时等待；补刀/伤害等缺失不填零，队伍指标不完整时不计算占比。结算/荣誉暂不可用时有限次等待，不影响其他页面。

荣誉提交只接受已展示过的本局分析，并在每次提交前重新读取阶段、账号与票单；剔除自己、机器人及重复身份，校验资格和剩余票数。逐人写入与最终完成并非服务端原子事务，开始写入后发生超时或失败会锁定本局再次提交，提示到客户端确认；写入前的资格变化可以刷新后重选。没有自动点赞或接口变体试写。

请求 LCU 时仅对带本机凭证的 loopback HTTPS 接受自签名证书。远程资源使用正常 HTTPS；渲染进程没有 Node 权限，启用隔离、沙箱和 CSP，外部链接限固定来源。恢复日志包含账号编号与配置内容，不包含 LCU token。

## 验证记录

- TypeScript 类型检查通过。
- 139 项测试、16 个测试文件通过，类型检查和生产构建通过。包括客户端配置、赛后与更新生命周期；更新检查覆盖正式版筛选、真实签名校验、额外安装文件/摘要不匹配、下载失败重试、安装阶段保护及本地缓存篡改。
- 内置腾讯 173 位英雄的搜索关键词及社区别名，搜索规则与来源见 [词库说明](CHAMPION-SEARCH.md)。
- 真实查询 OP.GG 阿狸中路及炸弹人普通大乱斗，各获得 5 套方案，通过 Data Dragon 16.21.1 成装与符文目录校验；海克斯分支生成 5 套明确标注的普通大乱斗装备参考，无符文/胜率/对位数据。
- 真实查询云顶返回十套阵容，已在实际 Electron 窗口检查站位、统计和装备显示。
- 在 macOS 进行了推荐、对位、云顶、图鉴/搜索、设置和未连接提示的窗口检查。截图仅反映界面预览，不证明 Windows LCU 或窗口跟随效果。
- 0.1.2 已在实际 Electron 窗口检查多张紧凑卡片、点选高亮、偏好保存、官方主副系图标、六件成装及海克斯装备参考提示，见 [卡片预览](screenshots/build-cards-preview.png) 与 [海克斯预览](screenshots/mayhem-preview.png)。Windows x64 安装包已生成并核对内含程序架构与版本，SHA-256 见 `release/SHA256SUMS.txt`。
- 0.1.3 已在实际 Electron 窗口核对胜率降序、主系基石及副系两枚小符文、两枚召唤师技能图标；选中较低胜率方案后重新载入，选中状态保留且排序不变。Windows x64 安装包已生成，并核对内含程序为 Windows x86-64，SHA-256 已记录。
- 0.1.4 已在实际 Electron 窗口查询并检查拉克丝下路对凯特琳建议、外号搜索、真实分路榜；结算页用隔离样例检查 KDA/指标、多人选择、票数上限和提交反馈，样例未连接或向真实账号投票。见 [对位建议](screenshots/matchup-preview.png)、[分路热门榜](screenshots/lane-hot-preview.png) 与 [结算样例](screenshots/postgame-fixture.png)。Windows x64 安装包已生成，已核对内含程序为 Windows x86-64、包内版本为 0.1.4，SHA-256 已记录到 `release/SHA256SUMS.txt`。
- 0.1.5 已在实际 Electron 430×900 窗口用真实推荐核对首屏完整卡片、后续卡片及离线禁用提示，见 [新版侧栏](screenshots/review-overview.png)。隔离样例核对结算→大厅保留→切页保留→下一局选人清除，以及 390×520 最小窗口的滚动区/固定操作栏；没有向真实客户端投票。见 [大厅保留样例](screenshots/review-postgame-retained.png) 和 [最小窗口样例](screenshots/review-minimum-fixture.png)。界面样例不证明 Windows 生命周期或实际写入通过。
- 0.1.5 Windows x64 安装包已生成，核对内含程序为 Windows x86-64、包内版本为 0.1.5，并确认托盘图标已随包分发；SHA-256 已记录到 `release/SHA256SUMS.txt`。安装包尚未代码签名。
- 0.1.6 已在本机生成 Windows x64 NSIS 安装包并确认 `app-update.yml` 使用 GitHub 镜像 generic feed；本机用临时测试密钥验证签名脚本能绑定版本、安装包和 latest.yml SHA-512，正式私钥仅存在 GitHub Actions Secret。当前 macOS 无法替代 Windows 实测下载、安装重启和托盘生命周期。
- 0.1.6 已通过 GitHub Windows runner 构建并公开发布，镜像完整下载 125809506 字节，使用内置公钥验证正式清单签名并确认 SHA-512/SHA-256 一致。0.1.7 补上安装前重验、安装阶段保护、可重试状态与更新提示。具体流程和 Windows 升级验收见 [UPDATES.md](UPDATES.md)。
- Windows 安装、LOL 实际写入、恢复、DPI 吸附、帧率/延迟及长期内存占用尚未实测，见 `WINDOWS-ACCEPTANCE.md`。

## 参考来源

接口研究使用 GitHub 的原始文档和源码，通过 `gh` 检索，未复制 WeGame 界面代码或闭源资源。

- [OP.GG 官方 MCP](https://github.com/opgginc/opgg-mcp)：推荐和云顶工具的参数与使用方式。
- [LeagueJax 完整统计接入](https://github.com/tarnishablec/LeagueJax/blob/92e0e55c24e1c4df6dbaa6cc8f85ea039b68dffb/src-tauri/src/shards/opgg/mod.rs)：完整统计数组与网站接口路径参考。
- [LeagueAkari 海克斯模式接入](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/renderer/src-opgg-window/opgg/context.ts)：KIWI 模式及跳过常规符文/技能配置的处理参考。
- [league-connect](https://github.com/junlarsen/league-connect)：本机客户端认证方式。
- [LeagueAkari](https://github.com/LeagueAkari/LeagueAkari)：LCU 实践、选人和战绩接口。
- [LeagueAkari 荣誉接口](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/honor.ts)：读取票单、逐人点赞和完成投票的不同请求。
- [LCU 与 Riot Client 接口定义](https://github.com/KebsCS/lcu-and-riotclient-api)：端点、请求和返回结构。
- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray) 和 [app 退出事件](https://www.electronjs.org/docs/latest/api/app#event-before-quit)：Windows 托盘图标、右键菜单与退出生命周期；另经 `gh` 核对 Electron 仓库原始 API 文档。
- [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)：静态资源目录。
- [Riot 队列目录](https://static.developer.riotgames.com/docs/lol/queues.json)：普通 ARAM 与队列 2400 的区分。
- [Riot 海克斯大乱斗说明](https://support.riotgames.com/en-us/league-of-legends/events/league-of-legends-aram-mayhem-game-mode)：常规符文停用与海克斯强化机制。

PRD 中关于 WeGame 准确率、历史功能可用性等第三方描述未经本项目独立核实，不作为实现正确性的验收依据。
