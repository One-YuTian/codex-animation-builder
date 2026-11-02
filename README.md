# Codex Animation Builder 0.7.7

预构建插件，无需 npm install。运行要求 Node.js >=20.19。

## 更新

- 0.7.7：时间轴建立独立堆叠上下文，关键帧标记不再遮挡导出弹窗。
- 0.7.6：贝塞尔缓动 Schema 改为四项数值数组，修复批量图层与关键帧工具在宿主中缺失的问题，保留长度和控制点范围校验。
- 保留 0.7.5 的 macOS Node 查找及宿主 MCP 发现修复。

验证：56 项回归测试、TypeScript 检查、Codex 宿主发现、35 个 MCP 工具及 Schema 校验、真实浏览器弹窗像素对比均通过。

macOS/Linux：通过 sh scripts/launch.sh 启动，自动查找 PATH、Homebrew、Codex 内置 Node、NVM 和 Volta。支持 ANIMATION_NODE_BINARY 指定 Node 绝对路径。

Windows：安装前使用 mcp.windows.json 替换 mcp.json，通过 node run.mjs 启动。

更新后重新连接插件或重启 Codex。支持 ANIMATION_DATA_DIR 覆盖默认数据目录，更新保留已有项目。
