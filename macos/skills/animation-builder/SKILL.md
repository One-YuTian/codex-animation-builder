---
name: animation-builder
description: 将参考图或描述制作成可编辑图层动画。先分析画面和动作节奏，自选合适时长与帧率，再分层、合图、预览，由用户手动导出。
---

# Codex Animation Builder

0. 创建/编排动画前先使用[动画分析与体积优先编排](../animation-planning/SKILL.md)。用户没有明确动作需求时主动识别元素、推荐最小必要动作并选档；有明确需求时按指定动作和画面决定FPS/时长。标准以1秒12FPS为起点，精细/极致仅在视觉目标需要时采用，不因画面简单就自动升档。简短说明动作、档位、时长、FPS、总帧数与理由后直接执行。
1. 新会话或新任务 `animation_open_editor(reset=true)`，再按原图尺寸 create；只有用户明确编辑已有项目才传 projectId 或 get(activate=true)。旧项目保留。
2. 创建画板时**显式传入分析选定的fps与duration**，不省略字段而落到工具兼容默认值。当前能力范围为1–24 FPS、0.5–3秒，这些是边界而非推荐参数。修改已有项目先读取原参数；只改素材/颜色等局部内容时保留节奏，调整节奏或动作时才重新分析。单独改变时长时保留FPS；若确需改FPS，明确按流畅度判断后用settings自动重定时。每个新任务单独项目，文件归入inputs/assets/temp/outputs。
3. 分层执行 [区域分层](../image-layering/SKILL.md)：先返回粗略坐标→prepare_regions 的 ImageMagick 参考裁剪与背景建议→互不连接的元素可合组一次imagegen（纯色背景，transparent_background=false）→process_layer(preparationId,parts)拆分并收集pendingLayers→全部处理完成后一次batch_layers(add:全部pendingLayer)加入画布并检查。尺寸比例在Skill中提出建议，MCP不因生成图大小或比例不符拒绝；只要内容可用就处理。图集分离需要时可增加间隔，拆分后恢复原画布位置。用户指定的背景色优先。禁止拿原参考裁片冒充生成层；允许原参考裁片用于生成输入。
4. 所有图层处理完后统一加入画布，新增元素使用Alpha加权视觉中心作为缩放/旋转中心；之后用 batch_layers 批量设置实例和关键帧，含 expectedRevision 防止覆盖用户修改。失败整批不保存。金额、按钮预计有动效时首次独立分层，同素材金币复用，不为每枚金币生图。
5. 合图执行 [合图](references/compose.md)；snapshot(frame=0) 后查看PNG再提交 review，80%通过。连续失败最多3次，成功后的后续修改可以重新审查。不可见元素的坐标、改名、分组不应让视觉审查失效；可见画面改变须重新审查。
6. 动画执行 [动画](references/animate.md)。普通缩放/平移/旋转用稀疏关键帧，通常2–6个转折点，禁止逐帧打点；逐帧动作才读 [序列帧](../frame-sequence/SKILL.md)。扫光读 [专门动效](../effect/SKILL.md)，形状遮罩/出纸裁剪读 [遮罩动效](../mask-effect/SKILL.md)，无需为遮罩生图。
7. 查看代表帧并 playback(playing=true)。在面板右上角由用户手动导出，见 [导出](references/export.md)。AI 不调用导出或绕过人工导出。

## 节省上下文

工具默认返回摘要；完整项目只在需要时 get(detail="full")，完整UI状态在 _meta 中供面板使用。不要打印 _meta、debugLogs、原始生图返回对象或任何Base64。不要为了检查一个字段把整个项目打印进上下文。读取技能一次即可，出错后只读相关段落。批量修改优先 batch_layers，不用额外MCP客户端逐层重复提交。

根节点为Scene；按主体、文案/按钮/金额、Logo、装饰建可折叠语义组，不将全部层塞入一个组。参考含透明区域且用户未要求不透明背景时，最终background=transparent；中间纯色应抠除。通过历史打开仅用于用户明确的已有项目请求，不作为规避新项目审查的方式。
