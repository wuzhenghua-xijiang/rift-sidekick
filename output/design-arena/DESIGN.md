---
name: Rift Sidekick — OVERDRIVE V2
description: 已选街头暴走；独立启动窗与客户端吸附小窗的本地设计预览。
colors:
  redline-accent: "#ff4d3d"
  redline-bg: "#111214"
  redline-surface: "#1b1c1f"
  redline-ink: "#f0efea"
  redline-muted: "#96969a"
  redline-line: "#ffffff1c"
  hextech-accent: "#c8aa6e"
  hextech-bg: "#091722"
  hextech-surface: "#102330"
  hextech-ink: "#e1e7e8"
  hextech-muted: "#90a3ac"
  hextech-line: "#c8aa6e30"
  overdrive-accent: "#f95a2c"
  overdrive-bg: "#efede6"
  overdrive-surface: "#e2e0d7"
  overdrive-ink: "#1b1b1c"
  overdrive-muted: "#6f6c66"
  overdrive-line: "#2423212d"
  nightops-accent: "#65ddc3"
  nightops-bg: "#0b1716"
  nightops-surface: "#11221f"
  nightops-ink: "#e2ece7"
  nightops-muted: "#87a29b"
  nightops-line: "#80b6a62a"
  champions-accent: "#b9954d"
  champions-bg: "#edeae2"
  champions-surface: "#e0ddd5"
  champions-ink: "#1c1d1c"
  champions-muted: "#77756d"
  champions-line: "#21221f2b"
  gallery-bg: "#171719"
  gallery-surface: "#101012"
  gallery-ink: "#ececee"
  gallery-muted: "#9c9ca5"
  gallery-line: "#343437"
  gallery-selected: "#29292d"
  gallery-focus: "#ff5847"
  white: "#fff"
typography:
  body: { fontFamily: "'PingFang SC', 'Microsoft YaHei UI', sans-serif", fontSize: "13px", lineHeight: 1.5 }
  gallery-body: { fontFamily: "'PingFang SC', 'Microsoft YaHei UI', sans-serif", fontSize: "14px" }
  redline-display: { fontFamily: "Barlow, sans-serif", fontSize: "93px", fontWeight: 900, lineHeight: 0.88, letterSpacing: "-.025em" }
  hextech-display: { fontFamily: "'Songti SC', 'SimSun', serif", fontSize: "43px", fontWeight: 600, letterSpacing: ".1em" }
  hextech-label: { fontFamily: "Cinzel, Georgia, serif", fontSize: "11px", fontWeight: 600, letterSpacing: ".32em" }
  overdrive-display: { fontFamily: "Barlow, sans-serif", fontSize: "151px", fontWeight: 900, lineHeight: 0.8, letterSpacing: "-.025em" }
  nightops-display: { fontFamily: "Barlow, sans-serif", fontSize: "84px", fontWeight: 800, lineHeight: 0.94, letterSpacing: ".015em" }
  champions-display: { fontFamily: "Barlow, sans-serif", fontSize: "98px", fontWeight: 900, lineHeight: 0.83, letterSpacing: "-.025em" }
  data: { fontFamily: "DM, monospace", fontSize: "11px", fontWeight: 400 }
rounded:
  square: "0"
  item: "3px"
  field: "4px"
  gallery-card: "8px"
spacing:
  tight: "5px"
  compact: "12px"
  panel: "20px"
  grid: "24px"
  generous: "28px"
components:
  button-redline: { backgroundColor: "{colors.redline-accent}", textColor: "{colors.white}", padding: "0 24px", rounded: "{rounded.square}" }
  button-hextech: { padding: "0 24px", rounded: "{rounded.square}" }
  button-overdrive: { backgroundColor: "{colors.overdrive-accent}", textColor: "{colors.overdrive-ink}", padding: "0 17px", rounded: "{rounded.square}" }
  button-nightops: { backgroundColor: "{colors.nightops-accent}", padding: "0 24px", rounded: "{rounded.square}" }
  button-champions: { padding: "0 16px", rounded: "{rounded.square}" }
  settings-input: { padding: "12px", rounded: "{rounded.field}" }
  gallery-navigation: { backgroundColor: "{colors.gallery-selected}", textColor: "{colors.white}", padding: "11px 12px" }
  role-chip-redline: { padding: "7px 12px", rounded: "{rounded.square}" }
  loadout-redline: { padding: "15px 17px", rounded: "{rounded.square}" }
---

# Design System: Rift Sidekick · OVERDRIVE V2

## Overview

**Creative North Star: "登录前炸场，登录后贴边助攻"**

用户已选「街头暴走」。当前 V2 保留纸白、墨黑、燃橙、英雄拼贴，登录前单独设计，登录后回归既有吸附小窗。其他四套与街头暴走首轮大工作台作为探索记录保留。

当前构图来自 [overdrive-v2.css](overdrive-v2.css)、[overdrive-v2.js](overdrive-v2.js) 与 [app.js](app.js)；首轮令牌来自 [gallery.css](gallery.css)、[screens.css](screens.css)。产品约束见 [PRODUCT.md](PRODUCT.md)，方向约定见 [DIRECTIONS.md](DIRECTIONS.md)。本文件描述预览，生产接入尚未进行。

**Key Characteristics:**

- 五个命名空间独立成立，中性画廊只负责比较与切换。
- 登录/启动与启动后的客户端分别组织；英雄图像承担首屏识别。
- OpenAI 连接只有一处配置，教练和语音共享连接、分别设置提示词。

## Colors

前置令牌保留 CSS 的实际值；每组 `accent` 是该方向的主强调色，`bg` / `surface` / `ink` / `muted` / `line` 是其独立中性色与分隔层。

| Namespace | Primary / Secondary character | Neutral character |
| --- | --- | --- |
| `redline` · 赤焰赛场 | 朱红用于启动、选中位置与横向进度 | 曜黑背景与微暖白字，赛场式高对比 |
| `hextech` · 海克斯圣殿 | 古金用于符文轨道、选中态与金属行动按钮 | 深海蓝分层，冷白正文与蓝灰说明 |
| `overdrive` · 街头暴走 | 燃橙用于海报、横幅与硬边投影；主按钮用墨黑 | 纸白底与墨黑清单，说明色偏暖灰 |
| `nightops` · 极夜战术 | 冷青用于部署动作、地图节点与编号 | 黑绿底、灰白正文与低亮青绿边线 |
| `champions` · 冠军画报 | 奖杯金作为画报与数据强调；工作台按钮用炭黑 | 暖白纸面与炭黑画报，灰褐说明 |

画廊使用 `gallery-*` 的中性灰阶，不继承某一案的品牌色。统一设置抽屉继承当前方案强调色；街头与画报采用浅色抽屉，其余采用深色抽屉。

**The Separate Worlds Rule.** 当前默认方向为 OVERDRIVE，其他四套命名空间保留用于对照；不向选定方向混入其他案的装饰或色板。

## Typography

实际自托管字体为 Barlow Condensed（CSS 别名 `Barlow`）、DM Mono（`DM`）与 Cinzel；中文依赖系统字体。随资源附带的 Archivo 当前未用于版面。

Barlow 承担赛场、街头、战术和画报的大字与战绩数字；海克斯以宋体中文标题配 Cinzel 拉丁标签。上方 display 令牌记录各案登录画面的实际大字，并非通用字号阶梯。

首轮正文基准使用 `body`，编号与技术标签使用 DM Mono；原有 (7–11px) 支持标签不构成生产字号标准。V2 小窗按真实尺寸排版：选中方案标题 15px、装备 35px（最小档 31px）、胜率 33px；替代方案标题 13px、胜率 29px。次级页面正文 12px；支持标签需在 Windows 实装后核对可读性。

## Layout

街头暴走 V2 登录为 1100×740；吸附助手为 430×720 或 390×560，高度只取两档便于评审，生产仍跟随客户端。小窗顶部 31px 窗口栏、25px 状态栏，左侧 47px 功能栏，底部 54px 固定操作；内容独立滚动。「贴边场景」额外展示 1280px 客户端示意。「小窗 1:1」按实际宽度排版。其他四案保留 1440×880 的首轮画布。

| Direction | Login / launch | Client workspace |
| --- | --- | --- |
| REDLINE | 左侧 (350px) 启动区叠在英雄全景上 | 水平导航；(600px) 英雄列与右侧配装列，间距 (28px) |
| HEXTECH | 左侧同心召唤装置，右侧 (335px) 凭证区 | (114px) 侧栏；主英雄区与 (260px) 战术栏，间距 (28px) |
| OVERDRIVE V2 | (616px) 官方皮肤拼贴海报与墨黑登录台；橙色标题、纸白输入框 | (47px) 功能栏；单列英雄、方案与摘要；固定应用 |
| NIGHT OPS | 峡谷地图场景与独立 (390px) 接入台 | (400px) 配装、弹性英雄列、(280px) 教练列，间距 (23px) |
| CHAMPIONS | (500px) 黑色账户区与大幅英雄画报 | (90px) 侧栏；配装与 (44%) 英雄画报，间距 (33px)；画报最终高度 (440px) |

概览默认三列，在 1250px 改两列、700px 改一列。街头暴走贴边场景按屏宽等比展示，小窗单独预览保留实际尺寸；画廊缩放不代表桌面行为验收。生产最小尺寸已核对为宽 390 DIP，实际 Windows 跟随、隐藏和文本可读性在接入后验收。

## Elevation & Depth

主体信息依赖明暗分层、细边线、英雄图像和渐变遮罩建立深度。海克斯的圆轨与节点只在召唤装置内使用；战术接入台有局部环境阴影；街头按钮采用偏移硬投影。画廊舞台与设置抽屉各有独立环境阴影，精确值记录于 sidecar。
当前街头暴走小窗以燃橙斜切英雄区、墨黑选中方案和整块橙色固定底栏建立节奏，选中方案采用 3px 燃橙硬投影。替代方案维持纸白横线清单，避免所有区域同时争夺注意力。

全部次级功能已在 [overdrive-pages.js](overdrive-pages.js) / [overdrive-pages.css](overdrive-pages.css) 中独立构图：对位用双方英雄与 VS 海报；教练用 BP 英雄海报与可选推荐；战绩用胜负战报与 KDA；云顶用墨黑六角棋盘；图鉴用英雄卡册；语音用静音播报台；设置用黑橙连接面板。页头与操作区保持统一，内容布局随任务变化。底栏分别承接刷新、生成、复制、返回、演示与保存，不再只显示同一条计时状态。

过渡以短促状态反馈为主：按钮颜色 (160ms)，抽屉入场 (200ms ease-out)，提示显隐 (180ms)。当前已有 `prefers-reduced-motion` 规则关闭动画与过渡，不代表完整无障碍验证。

## Shapes

REDLINE 使用单角裁切行动按钮 (10px)；HEXTECH 使用八角金属按钮切角 (9px) 与圆形轨道。OVERDRIVE 使用直角、倾斜字与纸条，正文保持端正。NIGHT OPS 使用精确直角框、角标和地图路径。CHAMPIONS 用粗细横线组织纸面信息。

通用装备图轻微圆角使用 `item`，战术与画报案保留方形装备。画廊卡片使用 `gallery-card`，设置字段使用 `field`；这些外壳圆角不自动迁入五套客户端。

## Components

- **Primary actions:** 当前街头暴走启动页使用 61px 燃橙按钮，配纸白硬投影与墨黑箭头块；小窗的燃橙底栏内使用墨黑应用按钮。其他四案保留首轮处理。键盘 focus 使用当前强调色轮廓。
- **Loadout rows:** 方案有编号、标题、装备与示意统计；选中态用强调边框和低浓度底色。画报案以横线清单替代盒状面板；不能强制套用通用卡片。
- **Role and mode chips:** 状态靠颜色、边框或实心块区分，位置与模式可切换；海克斯模式只展示装备同步相关内容。
- **Login fields:** 账号与密码共用带图标输入行，聚焦时外框变色；提交只切换至客户端预览。
- **Navigation:** 赛场与战术使用横向导航；其余采用各自宽度的侧栏。次级功能视图保留当前世界材料，不代表五套首屏采用相同结构。
- **Shared settings:** 只有一个 OpenAI 表单，含接口地址、API Key、模型；AI 教练和局内语音共用该连接，提示词分别切换。输入不保存、不发送；语音预览保持静音。
- **Gallery shell:** 独立概览卡、方向切换、登录/客户端切换与统一设置抽屉；该外壳用于评审，不是产品界面的第六套方案。

## Do's and Don'ts

- **Do** 在同一方向中保持其配色、字形、构图和材料一致。
- **Do** 使用已核对来源的 Riot Data Dragon 英雄、装备、符文与地图图像；来源保存在 `assets/sources.json`。
- **Do** 保留简短功能文案与示意状态说明，让英雄和主要动作优先。
- **Don't** 把五套方向混成统一色板；当前已选街头暴走，其他案只作对照。
- **Don't** 将固定桌面稿缩放预览当作生产移动布局、字号下限或侧边停靠验收。
- **Don't** 将本轮十张桌面稿、桌面/手机画廊和共享设置的视觉审阅当作无障碍合规认证；静态检测仅使用正则回退，未计算对比度。
