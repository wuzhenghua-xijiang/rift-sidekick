# 开局聊天屏蔽

0.2.6 在备战页和设置 → 游戏提供“屏蔽所有玩家聊天”开关，默认关闭，偏好随助手重启保留。开启后在客户端大厅或选人等安全阶段设置队友与对手聊天隐藏；加载、对局中开启或关闭时，等待返回大厅后再处理。此开关针对文字聊天，游戏音量、信号、表情和好友黑名单不受影响。

通过 `/lol-game-settings/v1/game-settings` 读取并 PATCH `HUD.ShowAlliedChat`、`HUD.ShowAllChannelChat` 为关闭值；客户端返回 `HUD.ChatChannelVisibility` 时同步设为 0。仅使用客户端实际提供的已知字段，保留其布尔、数字或字符串类型，不创建缺失的字段。调用 `/lol-game-settings/v1/save` 并读回一致后才显示已确认；接口不兼容、保存失败或读回不一致会显示实际状态，支持重试。

首次修改前按当前登录账号保存原始值到用户数据目录的 `chat-mute.json`，再写客户端。关闭时仅恢复助手曾修改且仍为关闭状态的字段；其他账号的记录不会应用到当前账号，玩家后来手动改过的值继续保留。写入前与读回后检查账号，写入前再检查客户端阶段；中途关闭或切换阶段会取消后续操作。失败记录留待重试，不将失败视为已经恢复。

字段依据来自上游实际实现：[smiteless 聊天屏蔽](https://github.com/bobbyroylee/smiteless/blob/main/core/lolmute.py)、[LoL-Queue 设置与恢复](https://github.com/PrinceOfFear/LoL-Queue/blob/main/lolqueue/core/antitoxic.py)。本项目只采用可读回的聊天设置，不采用模拟游戏按键、修改配置文件或静音信号的路径。单元验证覆盖双频道关闭、保存与读回、按账号恢复、跨重启、重试、阶段切换和取消；当前国服游戏内的实际隐藏效果仍需 Windows 实局核验。
