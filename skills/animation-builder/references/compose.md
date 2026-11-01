# 合图

区域分层见 ../../image-layering/SKILL.md。记录生成组和对应语义层；互不连接、无互相遮挡的元素可共享一次生图，再以生成图实际像素box拆分。原图比例与清晰度仅为Skill建议，MCP不按相对尺寸或比例拒绝。

1. 所有层先process_layer(preparationId)处理并收集pendingLayer，全部就绪后统一batch_layers(add)加入画布，再snapshot检查。process_layer 会返回原图坐标 placement；检查文字、比例、层级、遮挡与补绘。不要重新裁切原始参考图作为最终素材。
2. 一次 batch_layers 修正位置、语义、尺寸和z；需要读原关键帧时 get(detail="full")，其余用摘要。
3. snapshot(frame=0)，用本地图像查看工具读取PNG，检查文案、Logo、边缘、孔洞和整体构图。查看后以实际判断给出score/notes/snapshotHash，再 review。
4. score<0.8时先定位差异，仅修正受影响层。连续3次失败停止；通过后后续局部编辑可重新审查，不消耗终身三次额度。不得伪造视觉分数。
