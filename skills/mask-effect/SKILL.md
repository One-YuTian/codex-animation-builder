---
name: mask-effect
description: 为Codex Animation Builder创建图形遮罩、裁剪窗口、不规则多边形、反向遮罩或出纸/揭示效果。通过MCP配置Pixi.js内置形状或坐标点，不需要为遮罩生图。
---

# 图形遮罩动效

复用用户正在编辑的项目，先get确认目标layerId、尺寸、位置和已有shapeMask。遮罩是图层的裁剪属性，不是需要imagegen生成的图片，也不是盖住内容的可见白色图层。

## 创建与移除

调用animation_set_mask({projectId,layerIds:[目标ID],mask})。同一配置可绑定多个图层，每层独立保存；已有遮罩会被替换。mask=null移除，locked图层须先解锁。也可通过update_layer.patch.shapeMask或batch_layers.update.patch.shapeMask修改。

mask格式：

```json
{"space":"canvas","inverse":false,"shape":{"type":"rect","x":100,"y":80,"width":500,"height":450}}
```

- rect：x/y为左上角，width/height为宽高。
- roundedRect：矩形字段加radius，实际圆角不超过短边的一半。
- circle：x/y为圆心，radius为半径。
- ellipse：x/y为中心，radiusX/radiusY为水平/垂直半径。
- polygon：points:[{x,y},...]，至少3个不共线点，最多256点。按轮廓顺/逆时针依次给点，自动闭合；使用简单不自交轮廓，凹多边形也可。不要把原图像素坐标和局部坐标混用。

```json
{"space":"canvas","inverse":false,"shape":{"type":"polygon","points":[{"x":100,"y":80},{"x":600,"y":80},{"x":560,"y":520},{"x":350,"y":450},{"x":140,"y":520}]}}
```

## 坐标与效果

space=canvas（默认）：坐标为画布像素，窗口固定，目标图层移动/缩放/旋转时窗口不动。适合账单从出纸槽拉出、固定区域揭示和界面裁剪。
space=layer：坐标为目标图层未缩放素材框内部像素，左上角(0,0)，随图层视觉中心变换。适合照片圆角、局部形状裁切。
inverse=false保留形状内部，true挖掉形状内部。遮罩同时裁切原图层和其扫光，不改变原始纹理、像素、位置、视觉中心或其他层。

出纸效果：先设置固定canvas矩形/多边形窗口，再用已有关键帧移动账单图层；槽口前沿按原有z遮挡。不需要给遮罩逐帧生图。当前遮罩几何为静态配置，不能声称支持遮罩点位关键帧、羽化或贝塞尔路径；需要变形时先说明当前能力边界。动作时长/FPS按画面需求分析，不能固定3秒24FPS。

## 验证

配置后snapshot(frame=0)实际查看并review；检查动画中段与结束：可见区域、边缘、凹角、反向区域、扫光都须正确。预览使用Pixi.Graphics的rect/roundRect/circle/ellipse/poly，快照/导出使用相同坐标与形状规则；曲线边缘采样可能有轻微像素差异。删除/移除遮罩必须恢复完整图层，隐藏目标时不能留下可见遮罩。playback预览后由用户手动导出，不自动导出。
