---
name: image-layering
description: 生成纯色背景分层素材，可将互不连接的元素合并为一张图集以减少生图。MCP分析区域配色、抠图并拆分，全部处理后统一加入画布，使用视觉中心变换。
---

# 分层与非连接元素图集

1. 复用当前项目；新任务才打开编辑器并创建画板。以原图尺寸创建项目，原始参考图 reference=true 导入，保留原像素。
2. 观察参考图，给出每层内容的粗略 `{name,x,y,width,height,z}`，坐标以原图左上角为原点。主体、按钮、金额、装饰按独立遮挡层级规划；预计会动的金额与按钮首次独立。
3. 生图前调用 `animation_prepare_regions(projectId,assetId,regions,padding=12)`。互不相连、无互相遮挡的元素可组成一个生成组，传combine=true；MCP会联合分析组内所有区域，返回atlas.background.color和共享atlas.preparationId。MCP 用 ImageMagick 裁剪内容区域，只用于颜色分析和局部细节参考；通过量化及CIELAB/CIEDE2000算法返回 background.color、minDeltaE、备选色、preparationId、generationCanvas及suggestedNativeSize。背景色必须取MCP返回值，模型不能自行指定；用户已指定颜色时作为backgroundColor传给MCP，由MCP保留并返回。
4. 按生成组调用imagegen，必须transparent_background=false，用MCP返回颜色填充背景。**不同区域且互不连接、无相互遮挡的元素可以一次生成在同一张图中，即使最终z不同也可以**。若原图靠得太近，图集中适当增加间隔，确保描边、阴影、光晕也不相连，不共享底板；需要补绘的下层、相互遮挡或无法分离的元素单独生成。一个按钮的底板和文字保持一个语义单元，金额字符不要拆成单字。
5. 提示仍建议原图完整画布比例、原始位置和足够清晰的尺寸；这是**Skill的生成指导，不是MCP硬门槛**。实际生成图只要目标内容、文案、形状可用，即使原生尺寸或宽高比不符也直接使用，不为凑尺寸/比例反复生图。MCP保留原生图并等比适配，不声称低清素材变成高分辨率。图集允许为分离重排，最终用target还原布局。
6. 查看每张结果，单元素调用process_layer(projectId,path,name,preparationId,z,semantic)，收集pendingLayer。图集使用atlas.preparationId，按**生成图实际原生像素**标注每个元素的parts:[{name,box:{x,y,width,height},target:{x,y,width,height},z,semantic}]。box框住独立元素及边缘，框之间互不重叠；target是原画布最终区域，不能带入图集为拆分新增的间隔。名字与预处理区域相同可由MCP回填其区域，精确布局优先显式target。MCP一次抠图后按box逐个裁切，返回独立assets和pendingLayers；文字/按钮用语义框整体拆出，不依赖连通域把字符错误拆开。**处理阶段不加入画布**，把单元素pendingLayer或图集pendingLayers汇总。
7. 所有图层处理成功后，统一 `animation_batch_layers(projectId,expectedRevision,add:全部pendingLayer)`，一次加入画布并渲染。未全部就绪前不逐张导入，不使用其他添加接口提前显示。处理失败先修正该层，保留已处理资源。
8. 统一导入后snapshot(frame=0)查看合图，检查位置、比例、透明边缘、孔洞及遮挡关系，再review。下层遮挡缺口由该层独立生图补绘。动画可继续用batch_layers设置；完整时间轴仅需要时get(detail="full")。

## 视觉中心

所有新加入画布的元素由MCP根据资源可见像素Alpha权重计算视觉中心，忽略透明留白与近透明杂点；transformOrigin=visual-center，pivotX/pivotY为归一化资源坐标。缩放和旋转围绕固定的视觉中心进行，预览、导出和越界校验共用变换几何。x/y仍表示未缩放素材框左上角；纯缩放动画只改scaleX/scaleY，**无需补偿x/y**。不要以原图整张画布中心、图层透明边框中心替代视觉中心。

## 抠图与质量

背景选择用ImageMagick采样量化后CIEDE2000最大最小色差搜索，候选中等饱和度，避免荧光色。生成前若minDeltaE低则检查与前景混淆风险；生成后抠图由MCP完成，不调用imagegen移除背景。MCP使用连续Alpha、原图引导双边细化与颜色去混，默认Lab内阈值4、外阈值18、despill=1、smoothRadius=1。数字孔洞默认清除；前景含底色时用connected并核查孔洞。单图颜色解混是估计，不能保证精确恢复透明玻璃或生成光照污染。

不强制一层一次生图：空间独立且无连接/遮挡的元素优先同图生成再拆分，不因最终层级不同禁止合并；同一金币纹理可实例化复用。原图裁片不能作为最终分层素材。文件归inputs/assets/temp/outputs，最终透明外部保持透明，中间纯色不成为最终背景。按主体、按钮/金额、装饰建立语义分组。

## 调用纪律

禁止打印完整imagegen返回对象、image_url、Base64、字节或_meta；只输出路径、尺寸、ID，展示用图片工具。只读取一次技能，默认工具摘要；局部编辑仅处理受影响层，不盲目重试、不绕过审查。
