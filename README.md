# ai_movie · AI 视频创作平台

基于 ComfyUI 工作流的 AI 视频生产平台。创建项目 → 设定故事背景 → 拆分章节 → 编排镜头 →
为每个镜头指定首帧、尾帧与剧本提示词，异步生成并在线预览视频。支持**文生视频**与**图生视频**。

前端 Vue 3 + Vue Router + Vite，后端 Node/Express，数据以 JSON 文件落盘。

## 目录结构

```
api/
  video_minimax_h3_t2v.json   内置的 ComfyUI API 格式工作流（首次登录时作为默认模板导入）
  config/
    comfy.json                ComfyUI 地址与接口路径
    workflow.json             宽/高/时长的取值范围与默认值
  <模板ID>/                    新建模板时生成（workflow.json + meta.json），已 git-ignore
config/
  config.json                 端口、各类路径
  account.json                账号密码 —— 已 git-ignore，切勿提交
  account.example.json        模板，复制后改名使用
resources/
  images/                     首尾帧素材（上传的图片也落在这里）
  datas/                      业务数据 JSON，按用户隔离，已 git-ignore
    <用户名>_myproject.json     项目（含章节与镜头）
    <用户名>_template.json      模板元数据
server/
  index.js  config.js  auth.js  store.js  templates.js  workflow.js  comfy.js  jobs.js
  routes/   index.js  projects.js  templates.js  generate.js  helpers.js
web/                          Vue 3 SPA
scripts/
  mock-comfy.js               无 GPU 时用的假 ComfyUI
  e2e.js                      端到端冒烟测试
```

## 快速开始

```bash
npm run setup                                          # 安装前后端依赖
cp config/account.example.json config/account.json     # 然后修改账号密码
npm run build                                          # 构建前端到 web/dist
npm start                                              # http://localhost:3000
```

开发模式（两个终端）：

```bash
npm run dev        # 后端 :3000
npm run dev:web    # Vite :5173，代理 /api 与 /resources 到 :3000
```

## 页面

| 路由 | 说明 |
| --- | --- |
| `/` | 首页：平台介绍、功能、快速开始、开发文档 |
| `/login` | 登录 |
| `/console/projects` | 控制台 · 我的项目（上：用户信息与设置；左：导航；中：内容） |
| `/console/templates` | 控制台 · 模板 |
| `/chapter/:projectId/:chapterId` | 章节页，从项目编辑弹窗中**新窗口**打开（上：章节名；左：镜头列表；中：镜头编辑） |

「快速开始」需要先登录；未登录访问受保护路由会跳转登录页并在登录后回跳。

### 我的项目

分页列表，支持新增 / 编辑 / 删除与关键字搜索。新增弹窗字段：

- **模板** —— 取自模板列表，默认选中第一个
- **项目 ID** —— 自动生成 UUID，创建后不可修改
- **项目名称**
- **故事背景** —— 整个故事的简介，最多 500 字（超出部分服务端会截断）
- **章节** —— 点 `+ 添加章节` 追加标题输入框，序号从 1 开始，可上移/下移/删除

保存后，章节行出现「进入」按钮，在新窗口打开章节页。编辑项目时改动章节标题不会影响
该章节下已有的镜头。

### 章节页

左侧镜头列表，`+ 添加` 时**镜头序号自动生成**，只需填写镜头名称与备注。点击镜头进入编辑：
首帧、尾帧、剧本内容提示词、宽、高、时长，以及「生成视频」。首尾帧齐全时为图生视频，
只有提示词时为文生视频。删除镜头后其余镜头会自动重新编号。

### 模板

分页列表，支持新增 / 编辑 / 删除。新增字段：模板 ID（自动生成 UUID）、模板名称、
模板内容（JSON，带自检）、备注。保存后工作流写入 `./api/<模板ID>/workflow.json`。
被项目引用的模板不允许删除。

## 模板 JSON 与参数绑定

模板内容必须是 ComfyUI 的 **API 格式**（`Save (API Format)` 导出），即
`{ "<节点ID>": { "class_type": "...", "inputs": { ... } } }`；也接受 `{ "prompt": { ... } }`
外层包装。保存前会校验 JSON 以及每个节点的 `class_type` 与 `inputs`。

保存时自动扫描工作流，推导六个参数的写入位置：

| 参数 | 推导规则 |
| --- | --- |
| 首帧 / 尾帧 | `LoadImage` 节点，按 `_meta.title` 中的 `start`/`first`/`首` 与 `end`/`last`/`尾` 区分；否则按出现顺序取前两个 |
| 提示词 / 宽 / 高 | 同时含 `prompt`、`width`、`height` 的节点 |
| 时长 | 标题含 `duration`/`时长` 且有 `value` 的节点，否则取 `PrimitiveFloat` |
| 随机种子 | 含 `noise_seed` 或 `seed` 的节点，每次提交随机化 |

弹窗中的「自检」会先行显示推导结果；缺失项会在模板列表标红，该模板将不能用于生成。
宽高需为 32 的倍数（见 `api/config/workflow.json` 的 `step`），不合规的值会被就近取整。

## 生成链路

1. `POST /api/generate`（`projectId` + `chapterId` + `shotId`）——服务端读取镜头数据，
   把首尾帧推送到 ComfyUI 的 `/upload/image`，按模板绑定填充工作流，再 `POST /prompt`
   入队，**立即返回 `prompt_id`**，并把它记在镜头上。
2. 服务端以固定 `client_id` 常驻一条 ComfyUI WebSocket，收集 `progress` / `executing` /
   `execution_error` 事件。
3. 页面轮询 `GET /api/jobs/:promptId`，该接口把实时进度与 `GET /history/:promptId` 合并，
   最终状态与产物以 `/history` 为准。
4. `GET /api/view?filename=…&subfolder=…&type=output` 代理 ComfyUI 的 `/view`，透传
   `Range` 头以便播放器拖动；点击结果缩略图可全屏预览或下载。

`POST /api/jobs/:promptId/cancel` 调用 ComfyUI 的 `/interrupt`。

## 无 GPU 测试

```bash
node scripts/mock-comfy.js                              # 假 ComfyUI 监听 :8199
COMFY_URL=http://127.0.0.1:8199 PORT=3100 npm start     # 后端指向假服务
node scripts/e2e.js                                     # 47 项端到端断言
```

`scripts/e2e.js` 覆盖登录鉴权、模板增删改查与 JSON 自检、项目/章节/镜头增删改查与自动编号、
生成与轮询、视频代理、引用保护和分页搜索。

## 说明

- 数据文件采用「先写临时文件再 rename」的方式落盘，避免写入中断损坏项目列表。
- 任务记录保存在服务端内存（最近 200 条）；服务重启后，章节页仍可凭镜头上记录的
  `prompt_id` 从 ComfyUI 的 `/history` 恢复出结果。
- `resources/images` 与所有业务接口都需要登录会话。
