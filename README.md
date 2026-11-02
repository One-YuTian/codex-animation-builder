# Codex Animation Builder 0.7.5

预构建插件，无需 npm install。运行要求 Node.js >=20.19。

macOS/Linux：通过 sh scripts/launch.sh 启动，自动查找 PATH、Homebrew、Codex 内置 Node、NVM 和 Volta。支持 ANIMATION_NODE_BINARY 指定 Node 绝对路径。

0.7.5 修复 Codex 宿主忽略绝对启动命令 /bin/sh 导致技能已加载但 MCP 工具全部缺失的问题，命令改为 sh。已通过 Codex plugin/read 发现测试和35个工具、项目创建、面板资源读取验证。

Windows：安装前使用 mcp.windows.json 替换 mcp.json，通过 node run.mjs 启动。

更新后重新连接插件或重启 Codex。数据目录及已有项目保持不变，支持 ANIMATION_DATA_DIR 覆盖默认数据目录。
