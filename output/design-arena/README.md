# Rift Sidekick · 街头暴走 V2

用户已选「街头暴走」，本轮精修为独立启动窗与客户端吸附小窗。其余四案与首轮桌面稿保留作对照。这里是可交互的本地设计预览。

登录页已升级：官方「双城之战2 破碎者 金克丝」皮肤原画，搭配墨黑登录台、橙色大标题和启动按钮。样式见 `overdrive-login.css`；资源出处见 `assets/Jinx-arcane-fractured.jpg.json`。

已完成全部功能页的街头暴走设计：[全页设计板](http://127.0.0.1:4318/design-arena/overdrive-pages.html)。对位、教练、战绩、云顶、图鉴、语音、设置各有独立版式，均保留 430 / 390px 小窗结构。[全页说明](ALL-PAGES.md)。

[贴边场景](http://127.0.0.1:4318/design-arena/?concept=overdrive&view=app&presentation=context) · [小窗 1:1](http://127.0.0.1:4318/design-arena/?concept=overdrive&view=app&presentation=solo) · [登录页](http://127.0.0.1:4318/design-arena/?concept=overdrive&view=login)

登录为 1100×740；吸附小窗提供 430×720、390×560，以及大厅、选人、赛后三种状态。内容独立滚动，底部操作固定，设置和六个次级功能均在小窗内。实际客户端跟随逻辑继续沿用生产代码，本轮仅作设计预览。

| 方案 | 视觉语言 | 登录 | 客户端 | 整套图 |
| --- | --- | --- | --- | --- |
| 01 赤焰赛场 | 朱红、曜黑、速度切面 | [查看](../playwright/design-arena/redline-login.png) | [查看](../playwright/design-arena/redline-app.png) | [查看](../playwright/design-arena/redline-board.png) |
| 02 海克斯圣殿 | 深蓝、古金、符文轨道 | [查看](../playwright/design-arena/hextech-login.png) | [查看](../playwright/design-arena/hextech-app.png) | [查看](../playwright/design-arena/hextech-board.png) |
| 03 街头暴走 V2 · 已选 | 纸白、燃橙、拼贴海报 | [查看](../playwright/overdrive-v2/login.png) | [查看吸附窗](../playwright/overdrive-v2/dock.png) | [查看](../playwright/overdrive-v2/board.png) |
| 04 极夜战术 | 冷青、黑绿、战术地图 | [查看](../playwright/design-arena/nightops-login.png) | [查看](../playwright/design-arena/nightops-app.png) | [查看](../playwright/design-arena/nightops-board.png) |
| 05 冠军画报 | 暖白、炭黑、赛事画报 | [查看](../playwright/design-arena/champions-login.png) | [查看](../playwright/design-arena/champions-app.png) | [查看](../playwright/design-arena/champions-board.png) |

## 打开预览

在 `output` 目录启动静态服务：

```sh
python3 -m http.server 4318 --bind 127.0.0.1
```

打开 <http://127.0.0.1:4318/design-arena/?view=overview>。

点击方案，再切换「登录 / 启动」「客户端内」。可以选择方案、模式、分路、功能页；点击「设置」查看唯一一套 OpenAI 表单，AI 教练与局内语音共用接口、密钥与模型，各自保留提示词。

## 交付边界

账号、段位、连接状态、推荐与统计均为设计示意，已在窗口栏和总览标注。登录不会提交账号信息；设置不会存储或发送 Key。语音预览保持静音。QQ 验证码和大区仍在官方窗口完成。

设计产物位于 `output/design-arena`、`output/playwright/design-arena` 与 `output/playwright/overdrive-v2`。现有 React / Electron 代码未由本轮替换；真实连接和桌面行为在生产接入时验收。

街头暴走 V2 采用实际小窗宽度重新排版；「贴边场景」用于观察与客户端的相邻关系。其他四案仍为 1440×880 首轮画布。当前 Windows 吸附宽度与跟随逻辑已核对，未由浏览器原型修改。

## 首轮验证

- 十个页面均为 1440×880，无丢失图片，每页只有一个设置入口，主要操作处于画面内。
- 验证登录到工作台、方案切换、模式切换、六个功能页、统一 OpenAI 表单和 Escape 关闭。
- 海克斯模式隐藏常规符文与模式胜率，仅显示普通大乱斗装备参考。
- 对比页在 1600 和 390 像素宽度截图；390 像素宽度没有横向溢出。
- 无 JavaScript 运行异常；静态检测退化为正则模式，没有进行计算样式对比度检测。
- 42 张 Riot 原画 / 游戏资源均有来源记录，图片出处见 `assets/sources.json`；字体自托管。

## 文件

`index.html` / `gallery.css`：五案选择与预览外壳。
`app.js` / `screens.css`：五种独立构图、交互与全局设置。
`overdrive-v2.js` / `overdrive-v2.css`：已选方向的启动窗、吸附小窗及场景。
`overdrive-pages.js` / `overdrive-pages.css`：七个次级功能页、设置子页、各页对应的底部操作与示意交互。
`overdrive-pages.html`：八页设计板，点击截图进入对应功能；支持两档尺寸。
`REFINEMENT.md` / `validation-overdrive-v2.json`：V2 变更说明与浏览器检查。
`PRODUCT.md` / `DIRECTIONS.md`：产品事实和视觉方向。
`../playwright/design-arena/`：10 张页面、5 张组合板、桌面 / 手机总览和设置截图。

Riot Games 游戏素材用于本地设计提案展示；未表示 Riot 对本项目的认可。Barlow Condensed、DM Mono、Cinzel、Archivo Black 来自其相应开源字体分发。
