# Codex Animation Builder 0.7.4

预构建插件，无需 npm install。运行要求 Node.js >=20.19。

macOS/Linux：插件通过 /bin/sh scripts/launch.sh 启动，自动查找 PATH、Homebrew、Codex 内置 Node、NVM 和 Volta。可用 ANIMATION_NODE_BINARY 指定 Node 绝对路径。独立启动：sh scripts/launch.sh --web。

Windows：安装前使用 mcp.windows.json 替换 mcp.json，通过 node run.mjs 启动。

修复 macOS GUI 环境找不到 Node 导致面板入口与动画工具全部不可用。更新后重新连接插件或重启 Codex。

默认数据目录：Windows 为 %LOCALAPPDATA%/codex-animation-builder/.animation-data；其他平台为 ~/.local/share/codex-animation-builder/.animation-data。可用 ANIMATION_DATA_DIR 指定已有数据目录。

随附 FFmpeg、Gifsicle 和 ImageMagick WASM；加载路径相对于插件文件，支持包含空格的路径。

验证：macOS 最小 PATH 下发现35个工具、创建项目、读取面板资源；源码55项回归测试通过。界面需重新连接后在宿主中打开验证。
