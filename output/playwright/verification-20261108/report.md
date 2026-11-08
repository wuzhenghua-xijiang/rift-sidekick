# 2026-11-08 本机修复验收

本次修复基于 `main` 的 `3fb7b7028f47022351060988886b4ac5f50b53d2`，随 v0.2.13 提交和发布。修复已更新到本机安装版；原应用文件已备份。

## 变更

- 大乱斗以当前队伍成员的英雄为准，换英雄后仍能识别锁定状态并刷新推荐。
- 助手符文页重建并激活后回读，避免保留旧英雄名称或选中旧页。
- 兼容客户端把装备地图 `any + [12/11]` 导出为 `HA/SR` 的行为，解除误报导致的恢复锁定。
- 装备按照初始装、中间装、成装、其它推荐装备写入客户端及游戏推荐文件。
- 单击保存方案偏好，双击或 Enter 应用；阻止并发应用，底部无应用按钮。
- 配置成功后向本局选人聊天发送宣传语；核对账号、英雄、对局与聊天室，等待延迟出现的房间，并回读发送结果。聊天失败保留配置且显示“已配置 · 聊天未确认”。
- 选人资料暂时读取失败时保留吸附小窗，阻止过期英雄写入；关闭后台渲染节流，减少窗口恢复时的短暂空白。
- 设置页功能默认开启，默认语音为台湾软妹。已有明确保存的个人开关仍可正常关闭；秒选英雄需要先指定英雄。

## 已完成的验证

- 49 个测试文件、598 项测试通过。运行命令：`node node_modules/vitest/vitest.mjs run --exclude src/main/client-launcher.windows.test.ts --maxWorkers=2`。原生启动器集成测试此前受当前 Windows 进程状态及 spawn EPERM 影响，未纳入本轮通过数。
- TypeScript 类型检查、生产构建、300 段内置语音完整性检查通过。验收保持静音。
- 正式组件交互验收：单击不应用、双击应用一次、Enter 防重入、依据被点击方案校验缓存、连续八次切换英雄均通过，无渲染异常。
- 已截取 430×720、390×560 小窗、登录及大厅。见 [同尺寸对照](comparison.html)。顶部真实功能控件和数据属于已有业务界面；按用户要求移除设计稿底部的应用入口。
- 真实客户端已验证斯维因、图奇的符文页名和内容更新，装备接口及游戏推荐文件均有四个分组。
- 首版聊天在杰斯时已显示；用户确认切换图奇后漏发。随后增加房间等待、发送确认及错误状态，并更新本机安装版；用户最终确认验证无问题。

## 用户最终确认

- 修复更新后，用户完成本机验证并确认“验证已经没有问题了”。
- 最后一次接口核对：梅尔的当前符文页为“Rift · 梅尔 · 奥术彗星”，装备套装关联英雄 800，并保留初始装、中间装、成装、其它推荐装备四组。
- 界面控制曾因物理 ESC 中断；本报告区分接口读取、组件验收与用户最终确认，不将文件验证当成商店截图证据。
- 收尾恢复测试时临时调整的语音及游戏音量，保留用户原先偏好。

## 参考接口实现

- [LeagueAkari：符文应用](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-champ-config/auto-config-controller.ts)
- [LeagueAkari：聊天接口](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/chat.ts)
- [lol-auto-accept：符文应用](https://github.com/moleicafe/lol-auto-accept/blob/main/src/laa/runes/applier.py)
- [LCU 接口定义](https://github.com/KebsCS/lcu-and-riotclient-api/blob/main/lcu/swagger.json)
