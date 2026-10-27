# Rift Sidekick · 街头暴走精修

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
英雄联盟 Windows 玩家，在启动游戏、选择英雄和赛后复盘时使用侧边助手。

## Product Purpose
五案探索后，用户选择「街头暴走」。当前交付是沿该方向精修的可交互本地设计预览。

## Capabilities and Constraints
现有功能：游戏位置识别、性能优化、QQ 账号填写、自动配装、符文与技能、对位、AI 教练、战绩复盘、云顶阵容、英雄图鉴、游戏原生小地图计时设置、局内语音和更新。
登录与客户端启动后的主界面采用不同页面结构；OpenAI 连接设置统一在全局设置中，教练和局内语音共用一套连接，独立提示词。
登录前采用独立启动窗；登录后延续现有客户端吸附助手，默认宽 430 DIP、最小宽 390 DIP，高度跟随客户端。预览提供 430×720、390×560 两档，并展示大厅、选人、赛后三阶段。主内容滚动，关键操作固定在底部。
不增加自动 BP、自动接受、敌方技能监控或第三方独立野怪识别等未实现能力。QQ 验证码和大区选择保留在官方窗口。
所有账号、战绩、推荐数值和连接状态均为设计示意；预览不收集账号、不连接客户端、不发送 OpenAI 请求。

## Brand Commitments
用户要求彻底替换旧设计，更有游戏感、更热血，减少文案，先提供五套鲜明不同的设计稿。
已选街头暴走的纸白、墨黑、燃橙与英雄拼贴；用户确认登录后应保留之前的小窗吸附形态。其余四案保留为首轮对照。
用户要求街头暴走的视觉力度覆盖所有功能页；不能只强化备战。次级页面在同一视觉语言内根据用途分别构图，文案保持简短。

## Evidence on Hand
README.md、src/renderer/App.tsx、Launchpad.tsx、TclsLogin.tsx、Coach.tsx、Combat.tsx，以及既有界面截图。
本轮核对 src/main/index.ts 的窗口宽度约束，以及 src/main/dock-bounds.ts、windows-dock.ts 的贴边逻辑；实际桌面行为未由本轮原型修改。
英雄、装备原画资源来自 Riot Data Dragon；下载地址记录在 assets/sources.json。

## Product Principles
先看英雄与操作，再看说明；功能文案用短语；登录聚焦启动，主界面聚焦对局；五案改变构图和设计语言，而不只是颜色。
