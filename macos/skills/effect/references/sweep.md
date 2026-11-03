# 扫光：独立图层、alpha 遮罩与渐变形状

先用 animation_get 确认扫光目标（文字、按钮、金属主体）是否已是独立透明图层。已有独立资源直接复用；否则按 image-layering 技能单独调用 imagegen 提取，再由 animation_import_image、animation_key_image、animation_split_atlas 生成透明资产。保留文字孔洞和半透明边缘，不对整个不透明海报加扫光，不混入其他遮挡层。

使用 animation_update_layer(projectId, layerId, patch) 设置下面的 patch：

```json
{"effect":{"type":"sweep","color":"#ffffff","width":0.25,"angle":20,"opacity":0.7,"startFrame":0,"endFrame":47,"direction":"forward"}}
```

示例中的0–47只是演示范围，不能直接套到所有项目；先按动作节奏选定时长/FPS，再将扫光阶段换算成本项目帧号。endFrame 必须小于总帧数，省略时取最后一帧；startFrame 小于 endFrame，至少2帧。width 是光带宽度占目标长边比例（0.02–1）；angle 为光带法线相对水平轴角度（-75–75度）；opacity 为强度（0–1）；forward 正向、reverse 反向。区间外无高光，起止时光带完全离开目标。改变参数提交完整 effect；移除传 patch.effect=null。无需给光带逐帧设置位置。

渲染器建立两个共享同一纹理的 Sprite：正常显示原图，以及不可作为普通内容绘制的相同遮罩副本。尺寸、位置、中心旋转、序列帧纹理保持一致。使用 setMask({mask: maskSprite, channel: "alpha"}) 按透明度裁切高光，避免黑色、蓝色内容因默认 red 通道消失。不要额外创建第二个可见的普通图片图层，否则原图会重复叠加。

炫光使用 Pixi.js Graphics 形状和 FillGradient，透明到指定颜色再到透明；移动光带，保持遮罩随目标变换。缓存复用纹理、遮罩、渐变，不每帧重建。图层、目录或 Scene 隐藏时一并隐藏高光，删除或关闭效果释放资源。使用 group_create/group_assign 归入目标语义目录。

快照及人工导出使用相同光带几何、帧进度与 alpha 裁切，不能只有预览出现效果。预览时长变化自动重定时扫光区间；独立导出时长/FPS 重采样原时间轴。

设置效果后获取 frame=0 的 snapshot，查看并提交最新 hash 的 review；另检查中心、边缘、文字孔洞等代表帧，确认无矩形底色、漏光、变暗、重影及遮挡错误。高光盖住细字时减小 opacity 或 width。边界帧没有光带是正常行为。完成后 animation_playback 预览，由用户点击导出，AI 不调用导出。

0.6起，扫光目标不是独立层时，先prepare_regions返回该文字/按钮的大致参考裁片及背景色，再按原图完整画布比例独立生成纯色背景图（transparent_background=false），process_layer(preparationId)保留数字孔洞；全部需要生成的层处理好后统一batch_layers(add)加入画布。不要对不透明整张海报配置扫光。修改已有项目且已有独立金额层时直接复用，仅更新effect，无需重新生图。
