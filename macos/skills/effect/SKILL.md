---
name: effect
description: 为 Codex Animation Builder 制作和优化专门动效。用户要求扫光、流光、图形遮罩、不规则裁剪或出纸揭示时使用，经 MCP 配置 Pixi.js 渐变形状与独立图层 alpha 遮罩，保持预览与导出一致。
---

# 动效优化方案

扫光/表面高光读取[扫光方案](references/sweep.md)；图形裁剪、圆角、点位多边形、反向遮罩与出纸揭示读取[遮罩动效](../mask-effect/SKILL.md)。其他效果需先确认真实 MCP/渲染支持，不能编造工具或套用扫光。

动效参数通过 MCP 保存；动态形状、遮罩和插值由渲染器处理，不逐帧生图或烘焙关键帧。素材分层执行 [独立图层要求](../image-layering/SKILL.md)。沿用当前项目及透明背景，完成预览和视觉审查，由用户手动导出。
