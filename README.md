# Codex Animation Builder 0.7.3

预构建插件；只需 Node.js >=20.19，无需 npm install 或源码目录。

启动：node run.mjs
独立预览：node run.mjs --web

默认数据目录：Windows 为 %LOCALAPPDATA%/codex-animation-builder/.animation-data；其他平台为 ~/.local/share/codex-animation-builder/.animation-data。可用 ANIMATION_DATA_DIR 指定已有数据目录。

随附配套 FFmpeg WASM 与 JS 胶水，支持 GIF、动态 WebP 和透明 WebM。
