# Codex Animation Builder

## 0.7.10 统一 Node.js 启动入口

Windows、macOS、Linux 都安装 beta 根目录，统一通过 `node run.mjs` 启动，不再调用 PowerShell、sh 或平台专用启动脚本，也无需选择 `windows/` 子目录。旧 windows/ 包在 beta 中保留为相同内容的兼容副本。

`run.mjs` 按显式 `ANIMATION_NODE_BINARY`、宿主 `CODEX_MCP_NODE_PATH`、Codex primary runtime、当前 Node 的顺序选择 Node >=20.19。入口只使用 Node 内置模块，日志写 stderr，stdout 仅用于 MCP。

注意：宿主必须先能解析 `node` 命令，JavaScript 才能执行。Codex 的 stdio 清单没有自动将内置 Node 注入 PATH 的保证；若宿主报 `program not found`，需将 Codex 内置 Node 的 bin 目录加入该宿主 PATH。不能用 JavaScript 在自身尚未运行时查找解释器。本机测试包含真实 Codex 安装与根目录插件，不再只验证 windows/ 包。

验证：构建后执行 `node --test scripts/test-startup.mjs` 和 `node scripts/test-host-startup.mjs`；macOS 真机使用 `node scripts/test-macos-startup.mjs`。旧版启动说明仅作历史记录，以此节为准。

## 0.7.8 Windows 原生启动包

默认包的 `sh` 启动命令无法在没有 Bash 的 Windows 上运行，导致 MCP 工具与 UI 面板均无法加载。0.7.8 曾使用独立 Windows 包的 `node run.mjs`；0.7.9 已改为优先使用 Codex 内置 Node 的 PowerShell 启动器。

- Windows：使用 beta 分支的 `windows/` 目录作为插件根目录；下载/打包时使用整个目录。不要把 beta 根目录的 macOS 配置用于 Windows。
- macOS/Linux：继续使用 beta 根目录；保留 `sh scripts/launch.sh` 入口及 Homebrew/NVM/Volta 回退路径。
- 开发构建：`pnpm build`，然后 `pnpm build:beta` 和 `pnpm build:beta:windows`，分别生成 `artifacts/beta`、`artifacts/beta-windows`。`node scripts/build-beta.mjs <目录> --platform=win32` 可指定 Windows 输出位置。
- 验证：`pnpm test`；构建双平台包后执行 `pnpm test:startup`。Windows 检查使用不含 Bash 的 PATH、独立数据目录及真实浏览器；可用 `ANIMATION_TEST_BROWSER` 指定 Chrome。macOS 真机继续运行 `node scripts/test-macos-startup.mjs`。

安装新包后重新连接插件或重启 Codex。历史项目目录及 `ANIMATION_DATA_DIR` 覆盖规则保持兼容。

## 0.7.7 导出面板层级修复

时间轴建立独立堆叠上下文，防止关键帧标记越过时间轴遮挡导出弹窗。浏览器回归测试会先移除隔离以复现遮挡，再确认修复后弹窗像素不受底层标记影响。

## 0.7.6 批量图层和关键帧工具兼容

贝塞尔缓动参数改用四项数值数组，避免元组形式的 JSON Schema items 导致宿主工具解析失败，保留长度和控制点范围校验。安装验证检查 animation_batch_layers、animation_keyframes 以及全部工具的 Schema 兼容性。

## 0.7.5 Codex 宿主 MCP 发现修复

启动命令使用 `sh`；当前 Codex 宿主不会将绝对系统路径 `/bin/sh` 注册为插件 MCP 服务。启动器脚本参数仍通过 PLUGIN_ROOT 定位。回归验证同时覆盖宿主 plugin/read 的 mcpServers 与实际 MCP 工具调用。

## 0.7.4 macOS 启动修复

macOS/Linux 默认通过 `sh scripts/launch.sh` 启动，支持 PATH、Homebrew、Codex 内置 Node、NVM 和 Volta，要求 Node >=20.19。可用 ANIMATION_NODE_BINARY 指定可执行文件。启动器不下载或安装程序，stdout 仅用于 MCP。

独立 beta 构建：`pnpm build` 后执行 `node scripts/build-beta.mjs`，产物位于 `artifacts/beta`。

历史 0.7.7 及以前的 Windows 包需要手动替换 `mcp.json`；0.7.8 起请直接安装 Windows 构建包。0.7.9 的本地开发安装脚本也使用平台启动器，优先选择 Codex 内置 Node。

更新插件后重新连接或重启 Codex，旧会话无法自动替换启动失败的 MCP 连接。


## 0.7.3 金额扫光规划（Skill更新）

animation-planning识别货币符号/单位及价格奖励上下文中的金额，将局部金额扫光列为候选；不强制添加，不因金额自动升档，不覆盖明确动作要求，保留数值与可读性。本次仅更新Skill和发行元数据，运行时仍为0.7.2。

## 0.7.2 GIF优化体积保护

优化输出不保证更小；最终只选择不改变GIF画布尺寸、总播放时长与循环设置的更小候选。相同或更大时保留FFmpeg首次合成文件；Gifsicle加载/执行失败或输出结构异常也保留原文件。重复帧合并导致的帧数减少不再触发O1回退；只有播放元数据/结构异常时才尝试O1，且同样受体积保护。日志分别记录候选大小、选择原因和selectedSource，最终节省率不会因选择膨胀结果变为负数。

## 0.7.1 动画分析与体积优先编排（Skill更新）

新增animation-planning技能：先识别画面元素及适合动作，按尺寸、颜色/纹理、运动范围与帧预算选择标准/精细/极致。标准以1秒12FPS起步，大尺寸和多色复杂画面一般采用标准；画面简单不自动升档。用户明确动作优先，在保证质量与阅读的前提下减少GIF体积，不承诺未编码文件的大小。主Skill自动路由，统一替换旧帧率建议。本次仅更新Skill与发行元数据，运行时仍为0.7.0，导出仍由用户手动完成。

## 0.7.0 图形遮罩

新增animation_set_mask({projectId,layerIds,mask})，支持Pixi.Graphics的矩形、圆角矩形、圆、椭圆、坐标点多边形及inverse反向遮罩。space=canvas固定窗口，space=layer随图层视觉中心变换。mask=null移除，主体与扫光共同裁剪，快照/导出复用同一几何规则。新增mask-effect Skill用于出纸、局部揭示和不规则裁剪，无需生图。当前为静态几何，支持通过图层位移动画实现揭示，不支持遮罩点位关键帧或羽化。

## 0.6.4 宽松素材导入与非连接图集

- 不再按生成图相对原图的宽高下限、比例或2%误差拒绝导入。原尺寸/比例仅在Skill提示，内容可用即可，原生文件保留并等比适配。正常文件格式和内存上限仍由运行时处理。
- prepare_regions(combine=true)联合分析组内所有区域，返回atlas.background.color及atlas.preparationId。不连接、无相互遮挡的元素可合并一次生图，为拆分可增加间隔，不因最终z不同禁止合并。
- process_layer(preparationId:atlas.preparationId,parts:[{name,box,target,z,semantic}])一次抠图，按生成图实际像素box拆成独立assets与pendingLayers。target为原画布位置，恢复被间隔改变的布局；文字/按钮用语义框整体裁切。所有结果就绪后batch_layers(add:全部pendingLayers)统一加入画布。
- 保留MCP背景分析、软抠图、视觉中心及动画节奏分析。

## 0.6.3 动画节奏自适应（Skill更新）

Skill先分析画面、动作速度与幅度、动作先后、阅读停顿和循环衔接，主动选择并显式传入fps/duration，不再统一使用3秒24FPS。参数建议是判断参考而非固定预设；预览后根据速度与流畅度修正。关键帧和扫光范围由本次帧数计算，不套72帧模板。仅局部编辑保留既有节奏。

本次仅更新Skill和发行元数据，运行时仍为0.6.2；服务端兼容默认值不变，Skill必须显式传参。当前能力边界仍为0.5–3秒、1–24FPS。重载插件Skill后生效。

## 0.6.2 统一导入与视觉中心

- process_layer仅处理和保存素材，返回pendingLayer，不添加画布。所有图层就绪后一次batch_layers(add:全部pendingLayer)统一导入。
- 新导入元素按可见像素Alpha权重计算视觉中心，排除透明留白。缩放/旋转围绕固定视觉中心；预览、快照/导出、扫光和边界校验使用一致几何。x/y仍为未缩放框左上角，纯缩放无需手工补偿位移。
- 已有项目缺少transformOrigin标记时保留其原变换规则，避免旧关键帧位置变化。
- 保留原图完整宽高比、MCP区域配色与纯色抠图的约定。更新并重连加载0.6.2。

## 0.6.1 修正生成契约（历史版本）

- 区域裁剪只供MCP分析最佳背景色和局部细节参考；imagegen始终生成原图完整画布比例的纯色背景图，transparent_background=false，保留元素原始坐标。原生宽高不低于原图，比例校验容许2%舍入误差。
- prepare_regions按每层区域做ImageMagick量化与CIEDE2000配色分析，返回preparationId、background.color、原图完整画布及同宽高比建议尺寸。MCP保存配色，process_layer读取记录，禁止模型换色；用户指定颜色需在prepare_regions传入。
- process_layer完成MCP抠图、缩放和透明边裁切，返回pendingLayer；全部图层处理完后统一batch_layers添加并显示。
- 连续Alpha、引导双边平滑、去底色混合和数字孔洞处理保留。图像读写、量化、裁切和缩放用ImageMagick WASM；色差/Alpha计算为同进程TypeScript，无Python或远程模型依赖。不能保证单张色键图精确恢复透明玻璃或生成光照污染。
- 保留默认摘要、隐藏UI完整状态、批量动画编辑和连续失败3次的审查规则。

### 调用顺序

prepare_regions({projectId,assetId,regions:[{name:'金额',x:150,y:540,width:390,height:75}]}) → 使用返回的完整原图尺寸、比例及background.color生成一张纯色背景图 → process_layer({projectId,path:生成路径,name:'金额',preparationId:返回的preparationId,z:5,semantic:'amount'}) → 收集pendingLayer → 全部完成后batch_layers(add)统一导入 → snapshot检查。

更新插件并重连MCP后加载0.6.1，现有项目数据保留。

## 0.5.0 新 FFmpeg WASM 与成品预览

使用用户提供的 demo26/dist/umd FFmpeg核心，JS与WASM随插件发布，无需原目录或原生FFmpeg。新增动态WebP（压缩等级0–6，默认4）和透明WebM（VP9/alpha）导出。完成后导出弹窗显示成品预览；WebM静音自动循环播放，透明区域以棋格显示。WebP压缩等级影响编码耗时与文件大小，非GIF Loss，WebP编码质量当前为80。新格式保留独立FPS/时长设置、进度、取消、日志。


## 0.4.7 历史项目免审查

明确载入历史项目后，编辑和人工导出不再要求80%视觉审查，跨连接及重启保留该项目选择；保留已有审查记录，不补分。新建和restore副本保持原有流程。导出参数、边界及实际资源渲染检查仍执行。


## 0.4.6 历史项目

工具栏及空画板提供历史项目入口，支持名称/ID搜索，按最近修改时间排序，显示尺寸、FPS、时长和图层数。打开已保存项目保留资产、分组、关键帧与动效，刷新后继续显示已选项目。导出期间禁用切换。


## 0.4.5 GIF Loss

人工导出 GIF 时可设置 Loss 0–200（默认30）。0关闭有损压缩，保留 -O3 无损优化；实际参数传给 Gifsicle WASM，并记录在导出日志中。仅影响本次导出。


## 0.4.4 扫光 effect 技能

skills/effect 提供动效方案入口，references/sweep.md 说明独立目标提取与 MCP 配置。animation_update_layer 的 patch.effect 支持 type=sweep，包含 color、width、angle、opacity、startFrame、endFrame、direction；effect=null 移除。Pixi 复用原图与同纹理遮罩副本，用 alpha 遮罩裁切 Graphics/FillGradient 光带。快照及人工导出使用相同几何与透明度，时长调整自动重定时。新增 scripts/test-sweep.mjs 用真实浏览器检查黑色目标、透明孔洞和预览/导出的像素一致性。


## 0.4.2 比例和位置改为技能引导

比例只要求大体一致，不要求数值严格相等。删除MCP导入时的参考比例匹配拦截和resize_image(fill)的比例拒绝检查；比例不同的图片仍可导入，fit=canvas默认保持比例并适配画布，显式fill也可使用。原生分辨率下限继续保留，原始高分辨率资产继续保存。

技能要求每次imagegen生成后都单独对照原图，换算到参考画布后检查元素位置、中心锚点、边距、间距与遮挡位置一致，不只检查最终合成。比例与参考位置均只由SKILL生成指引和视觉检查执行，没有新增MCP比例阈值、参考坐标匹配或位置拒绝检查。已有画布边界和输入合法性检查仍按原功能执行。


## 0.4.1 独立图层生成与原生质量门禁

每个独立语义图层必须分别调用一次 Codex imagegen，不同z/遮挡深度不能共用一次生成调用或一个生成文件。技能要求记录逐层调用清单，合图前检查调用标识、原生宽高、画布比例及层内前景比例。同一目标图层的逐帧Grid只组合时间帧，不能混入其他叠放层级。

默认各生成图层输出完整参考画布的高分辨率图：原生宽和高分别不得低于参考原图，画布宽高比一致，前景内容保持对应原图层比例。不能比较总像素数替代两条边的检查，不能通过插值放大、非等比拉伸或裁掉内容冒充达标。生成器无法满足时报告无法达标，不能降低标准。

MCP import_image(fit="canvas") 在生成显示副本前，对实际文件的原生尺寸和比例做硬检查，以项目原始参考图为基准，未导入参考图时使用画布尺寸。低分辨率或错误比例直接拒绝，项目状态不变。高分辨率原生文件作为 nativeAsset 返回并保存在项目中；显示副本仅等比对齐画布。resize_image 的 fill 模式也拒绝非等比拉伸，需用 contain 保持比例。跨层级调用是否独立及前景语义形状仍由技能与视觉审查核对，MCP尺寸校验不会声称能验证 imagegen 调用历史。


## 0.4.0 图层目录与 ImageMagick WASM

导出目录按钮经 MCP 校验已完成任务后，使用 Codex MCP App 的 openai/files/open 宿主 API 打开实际输出目录，不再启动 Explorer 或其他子进程。不支持此能力的宿主会显示明确提示。API只承诺打开路径，未公开文件选中参数。协议见 https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#opening-local-files 。

MCP新增 group_create、group_update、group_assign、group_remove、scene_update、resize_image。组可以嵌套、改名、移动、隐藏或解散；解散保留图层。UI以目录显示组，支持折叠展开。Scene对应项目实际根节点，可控制整个画布可见性；图层与组的小眼睛通过MCP落盘，隐藏状态同步用于Pixi、快照和导出。分组不改变坐标和全局z顺序，旧项目自动补上Scene及空分组。

透明参考图且用户未指定不透明背景时，创建的动画保留透明；明确指定的纯色背景保持。技能区分中间纯色抠图背景与最终背景，不生成不必要的不透明底层。生成的全画布图集直接按路径 import_image(fit="canvas")，MCP对齐画布大小；也支持 width/height、contain及 resize_image。技能要求自动缩放并自动语义分组，不再询问用户是否缩放，也不在MCP前用脚本缩放图片。

运行时图片转换、RGBA读写、四角抠图、裁切、缩放、旋转、透明度、合成快照及GIF后备编码均使用用户指定目录的 magick.wasm，JS胶水与WASM复制在 server/wasm-tools/dist/imagemagick 中随包发布，不依赖原目录继续存在。每次命令清理虚拟文件并限制像素缓存内存；串行复用实例，避免虚拟文件名竞争。保留 FFmpeg/Gifsicle WASM 导出链路。运行时代码和生产依赖均不含Sharp/Gifenc；Sharp仅作为测试开发依赖独立校验WASM结果，不参与插件图片处理。提供的WASM未编译WebP支持，目前输入支持PNG、JPEG、GIF首帧，WebP会明确报错。


## 0.3.2 关键帧与导出设置

常规动画使用稀疏关键帧和曲线插值，不逐帧烘焙。提交关键帧时移除不影响动作的冗余中间点（位置误差≤0.25px），保留起止点；复杂动作中的必要关键帧保留。预览时长/FPS变化按原时间轴比例映射，落在同帧的关键帧按属性合并，同属性以后一个关键帧为准，不再出现重复帧错误。输入时长会对齐完整帧。

人工导出弹窗独立设置 FPS（1–24）和时长（≤3秒，按整帧步进）。完整原动画按导出时长重定时，并按导出 FPS 采样；关键帧间使用连续插值，导出帧数可以超过预览帧数。导出过程不修改项目预览设置、关键帧或 revision。PNG序列包含实际导出FPS、时长与帧数元数据。旧的 frames 参数继续兼容，不可与新的 FPS/时长参数混用。

导出完成后，顶部和导出弹窗提供文件夹图标，调用 App 专用 animation_reveal_export，在 Windows 文件资源管理器打开插件实际输出目录并选中文件。仅允许定位本服务记录的已完成导出任务，不能传任意路径启动程序。macOS 使用 open -R，Linux 打开所在目录。


本地 Node.js 插件，包含三个 SKILL、stdio MCP 服务和非内联预览面板。React 18、Galacean editor-ui、Lucide、Pixi.js 8。Node.js ≥20.19，pnpm 12。

## 0.3.1 面板图片传输修复

Codex 侧栏图片通过 App 专用 animation_read_asset 按绝对路径读取，每次最多48KB二进制分块，仅返回到 UI 元数据，不使用 base64。分块读取校验文件版本，最多同时加载2张图片，并限定 assets 真实目录和面板会话令牌。资源不上传外网，持久化项目仍保存路径。Codex 面板不再请求 localhost，CSP 的 connectDomains 为空；独立浏览器预览继续使用本机 HTTP 网关。

0.3.0 的模拟宿主允许 localhost，未覆盖真实宿主的访问失败；回归测试现禁止 iframe 所有网络连接，并拦截所有 localhost 请求，仍验证图片与项目切换正常。

## 0.3.0 预览面板

顶部移除 Logo，左侧显示项目面包屑，右侧仅播放/暂停、适应画布、重新加载、导出和运行中的取消按钮。左侧是只读层级树，中间是透明棋格画布，底部是只读时间轴，支持选中查看和定位预览。移除新建、导入、属性、参数编辑及曲线编辑控件。所有项目、素材、图层、关键帧、序列帧、FPS与时长修改均通过 MCP。

面板自动跟随 Codex 宿主深浅主题，独立预览跟随系统；切换主题不重建画布。文件只以路径传递，浏览器通过带随机令牌的本机二进制网关读取，不传 base64。

修复不同 MCP 连接缓存项目而无法同步的问题，current 每次读取磁盘中的活动项目。Pixi 仅加载当前实际可见资源，未使用的参考图或图集失败不会阻断画面；支持重试、明确错误提示和异步初始化后的最新项目加载。停止空闲 ticker，只在帧或数据变化时渲染。

## AI 工作流与人工导出

AI 执行拆图 → 合图 → 动画 → 审查预览，保存后结束，由用户点击“导出”。技能禁止 AI 调用导出或用脚本替代导出。animation_export、export_status、cancel_export 仅向 App 开放，启动还需面板会话凭证；模型调用被服务拒绝。

人工导出支持 GIF、当前帧 PNG、PNG 序列 ZIP、项目 JSON。单个后台 Worker 顺序处理帧，Sharp 单线程，不再启动 Chromium 渲染整个动画，不与项目操作共用长任务队列。显示进度、允许取消，超时120秒终止；动画总帧像素超过6400万时拒绝启动，需经 MCP 调整尺寸/FPS/时长，不静默降质。GIF 有一位透明度，半透明请使用 PNG 序列。24FPS GIF 交替使用4/5厘秒保持总时长。

快照仍供 AI 视觉审查使用，由 Sharp 按与 Pixi 相同的位置、缩放、中心旋转、透明度及序列帧模型合成单帧 PNG；不启动完整动画导出。视觉评分为 Codex 判断，不是自动相似度算法，≥0.8通过，最多3轮。

## 开发与本机安装

```powershell
pnpm install
pnpm build
pnpm test
pnpm preview
```

独立预览在 http://127.0.0.1:4318，仅绑定本机。生产运行不需要安装 Chromium；`pnpm browser:install` 仅供 Playwright 回归测试。服务启动为 `node dist/server.js`，stdout 仅 MCP 协议；默认数据目录为 `.animation-data`，可用 `ANIMATION_DATA_DIR` 覆盖。项目与图片不会在更新中删除。

本机通过 codex-animation-local 本地市场安装，标识 codex-animation-builder@codex-animation-local，绕开工作区 ZIP 上传权限要求：

```powershell
node scripts/prepare-local-install.mjs
codex plugin marketplace add "Q:\Projects\Codex Animation Builder\artifacts\local-marketplace" --json
codex plugin add codex-animation-builder@codex-animation-local --json
```

本地安装清单使用平台启动器和插件内 scripts/local-runtime.mjs，优先选择 Codex 内置 Node，指向当前开发目录的 dist/server.js，请保留开发目录。更新技能、工具目录或 UI 资源后，宿主可能需要重新打开插件面板或重启 Codex；正在运行的旧 MCP 连接无法由安装脚本热替换。`node scripts/diagnose-host.mjs --standalone` 用 Codex 自身解析器验证安装及工具发现；verify-local-install.mjs 验证安装缓存的启动清单。

animation_open_editor 注册 global 侧栏入口和 thread 内容面板入口，仅声明 fullscreen，不声明 inline。面板位置与保持打开由宿主控制。

## MCP 功能

| 工具（前缀 animation_） | 功能 |
|---|---|
| open_editor、current、list、get | 打开面板、同步活动项目、查询项目 |
| create、restore、settings | 创建、恢复、尺寸/背景/FPS/时长 |
| import_image | 通过绝对路径导入图片 |
| key_image、split_atlas、split_grid | 四角采样、语义子图/网格拆分 |
| add_layer、update_layer、remove_layer | 位置、尺寸、层级、可见、锁定与删除 |
| keyframes、sequence | 变换动画、运动曲线与序列帧 |
| playback | 播放、暂停与定位 |
| snapshot、review | 单帧快照与最多3轮视觉审查 |
| export、export_status、cancel_export | 仅面板：人工导出、进度、取消 |

FPS 1–24，时长≤3秒且为整数帧/FPS，画布1–4096像素，输入图片≤24MB。全部采样帧检查旋转包围盒，禁止超界。图层 x/y 为缩放后未旋转左上角，旋转围绕中心，角度为度，z越大越靠前。关键帧数组完整替换，frame从0开始。序列帧在目标图层固定尺寸内均匀分配。

拆图技能使用 Codex imagegen 生成全画布纯色背景图集，经四角分区采样、连通泛洪抠图和子图拆分保留原坐标；文字可用 boxes 显式合并语义单元。与背景连通且同色的真实内容无法自动区分，生图时需选择前景不存在的背景色。

图片保存在 assets 下，Asset.path 为绝对路径，网关仅允许 assets/uploads/exports 中的真实路径。旧嵌入图片项目读取时迁移为独立 PNG，并重置旧审查结果。项目 JSON 保存路径，恢复时资源文件必须存在。棋格仅为 CSS，PNG 的空白区保持透明。

## 验证和打包

`pnpm test` 验证边界、审查、拆图、序列帧、恢复、跨连接同步和快照透明度。`node scripts/smoke.mjs` 验证23个工具、模型导出拒绝、受限 MCP iframe 的真实 Pixi 渲染、跨进程同步、宿主主题和人工点击 JSON 下载。测试不导出用户动画，模拟宿主不等同真实 Codex 面板验证。

`pnpm package` 输出 artifacts/codex-animation-builder-0.4.2.zip，包含构建和源码，不包含依赖、浏览器或用户数据。解压后安装依赖即可运行。本机 Node 服务不支持网页/手机直接启动。
