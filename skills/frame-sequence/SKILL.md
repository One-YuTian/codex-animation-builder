---
name: frame-sequence
description: 用户要求逐帧动画、角色动作或无法用常规变换表达的局部动画时使用。Codex imagegen 在单张 Grid 图生成均匀序列帧，MCP拆分后填充目标时间轴。
---

先调用 `animation_open_editor`；读取项目和目标 layerId、动画区域、用户动作要求。只处理需要动画的图层/区域，其余图层保持。

1. 先分析角色动作的完整周期、风格、停顿及循环衔接，再确定FPS和总时长；参考[节奏与帧率选择](../animation-builder/references/animate.md#节奏与帧率选择)，不要默认3秒24FPS。当前上限FPS≤24、总时长≤3秒、播放总帧数≤72。可用较少生成帧由 `animation_sequence` 均匀覆盖；向用户准确说明生成帧数和播放FPS。设置统一单元格尺寸，不让目标动画超画布。
2. 必须调用 Codex imagegen。输出一张规则 Grid 接触表，按行从左向右、再向下排列，等宽高单元格，无文字、编号、网格线。角色、光照、比例、相机和位置锚点一致；所有动作完整处于同一格内。使用与内容不冲突的高对比纯色背景，不要求生成透明背景。声明列数、行数、有效帧数、padding、gap及每帧尺寸。
3. `animation_import_image` 导入，`animation_key_image` 时按每个单元格提供 regions 独立采样，避免其他格子干扰。`animation_split_grid` 使用同样 columns/rows/count/padding/gap；服务严格检查整像素等尺寸，不能将余数静默裁掉。
4. 检查每帧外观和背景剔除。通过合图审查后调用 `animation_sequence`，assetIds必须按返回顺序，startFrame/endFrame覆盖需求时间段。每帧均匀占用时间；不改变层位置来迁就抖动。每帧在固定的目标图层 width/height 内渲染。
5. 用 playback 预览，关键时间点 snapshot 检查动作与边界。AI 工作流到此结束，由用户在面板点击“导出”；禁止 AI 调用导出工具或改用脚本导出。


## 背景、MCP缩放与自动分组
- 若参考图含透明区域，且用户未明确要求不透明背景，项目必须保持 background=transparent。最终GIF/PNG保留透明背景。imagegen中间图集仍按纯色背景生成，由MCP抠图去除；不要把中间纯色填充或透明棋格当成最终背景层。真实不透明画面区域应保留。
- 互不相连的空间元素可按image-layering技能同图生成再拆分；生成尺寸与比例仅由Skill指导，内容可用时MCP不得以相对原图大小或比例拒绝导入。逐张对照原图，确认每张生成图中的元素位置一致；位置要求同样仅在SKILL中执行。达标后直接把原生路径交给 animation_import_image(fit="canvas")，由MCP保留 nativeAsset 并等比对齐。局部资产保持比例用 contain；禁止用 fill 非等比拉伸、插值放大低清图或裁切内容伪装达标。无需询问是否缩放，也不要在MCP前处理图片。原始参考图 reference=true 导入时保留原尺寸。
- 组合图层后自动按语义分组：主体、文案/按钮、Logo/支付图标、装饰（例如同批金币）。使用 animation_group_create(name,layerIds) 创建目录；需要嵌套时传 parentId。已有目录用 animation_group_assign 调整归属，不把整个项目塞到无意义的单一分组，不逐个元素创建空目录。分组不改变图层的坐标、动画及z值。
- UI 场景根节点为 Scene，目录分组可折叠展开；根节点、目录和图层的小眼睛会通过MCP修改可见性。animation_group_update 可改名、移动目录或隐藏整组；animation_group_remove只解散目录，保留图层。


逐帧 Grid 只允许汇总同一目标图层的时间序列，不允许把不同叠放层级放进同一次生成调用或同一张 Grid。不同目标图层分别调用 imagegen。每个格子与原目标层/区域的宽高比大体一致即可，并保持至少原区域的像素尺寸；格内元素的位置与原区域对齐，由SKILL逐帧视觉检查，比例和参考位置不作为MCP拒绝导入条件；Grid整体原生宽高也不得低于参考原图。若生成器的尺寸上限无法容纳，减少同一目标层每张Grid中的帧数、分多次独立生成，并按顺序合并时间轴；不能缩小每帧来凑整张Grid。不能先生成小格子再放大声称达标。
