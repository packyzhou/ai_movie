<script setup>
import { session } from '../session';

const FEATURES = [
  {
    icon: '🎬',
    title: '项目化创作',
    text: '一个项目就是一部片子：设定故事背景，拆分章节，再把每个章节拆成一个个镜头，条理清晰地推进创作。',
  },
  {
    icon: '🖼️',
    title: '图生视频 / 文生视频',
    text: '为镜头指定首帧与尾帧图片即为图生视频；只写剧本提示词、不给参考图则退化为文生视频。',
  },
  {
    icon: '🧩',
    title: '模板即工作流',
    text: '把 ComfyUI 导出的 API 格式工作流粘贴为模板，平台自动识别首帧、尾帧、提示词、宽高与时长的接入点。',
  },
  {
    icon: '📡',
    title: '异步生成与实时进度',
    text: '提交后立即返回 prompt_id，页面通过轮询展示排队位置、采样步数与百分比，完成后可直接预览视频。',
  },
];

const STEPS = [
  { n: 1, title: '登录平台', text: '使用 config/account.json 中配置的账号登录，首次登录会自动生成一个内置模板。' },
  { n: 2, title: '准备模板', text: '在「模板」中粘贴 ComfyUI API 格式工作流 JSON，保存后写入 ./api/<模板ID>/workflow.json。' },
  { n: 3, title: '新建项目', text: '在「我的项目」中新建项目：选择模板、填写项目名称与故事背景，并逐条添加章节标题。' },
  { n: 4, title: '编写镜头', text: '点击章节标题进入章节页，添加镜头并填写首帧、尾帧、剧本提示词、宽、高、时长。' },
  { n: 5, title: '生成并预览', text: '点击「生成视频」，等待进度条走完，点击结果缩略图即可全屏预览或下载。' },
];

const DOCS = [
  {
    title: '数据存储',
    body: '所有业务数据以 JSON 文件保存在 ./resources/datas/ 下，按用户隔离：项目为 <用户名>_myproject.json，模板为 <用户名>_template.json。模板的工作流本体单独存放在 ./api/<模板ID>/workflow.json。',
  },
  {
    title: '模板 JSON 要求',
    body: '必须是 ComfyUI 的 API 格式（Save (API Format) 导出），即 { "<节点ID>": { "class_type": "...", "inputs": { ... } } } 的对象；也接受 { "prompt": { ... } } 外层包装。保存前会做 JSON 自检并校验每个节点的 class_type 与 inputs。',
  },
  {
    title: '参数自动绑定',
    body: '保存模板时会扫描工作流：LoadImage 节点按标题中的 start/first/首、end/last/尾 分别绑定首帧与尾帧；同时含 prompt、width、height 的节点绑定提示词与宽高；标题含 duration/时长 的数值节点绑定时长；含 noise_seed / seed 的节点用于每次随机种子。缺失项会在模板列表中标红提示。',
  },
  {
    title: '生成链路',
    body: 'POST /api/generate 上传首尾帧到 ComfyUI 的 /upload/image，按模板绑定填充工作流，再 POST /prompt 入队并立刻返回 prompt_id；服务端通过 WebSocket 收集进度，页面轮询 GET /api/jobs/:promptId，最终结果以 /history 为准，视频经 /api/view 代理播放（支持 Range 拖动）。',
  },
];
</script>

<template>
  <div class="home">
    <header class="nav">
      <span class="brand">🎞️ AI Movie</span>
      <nav>
        <a href="#features">功能</a>
        <a href="#quickstart">快速开始</a>
        <a href="#docs">开发文档</a>
        <router-link class="cta small" :to="session.user ? '/console' : '/login'">
          {{ session.user ? '进入控制台' : '登录' }}
        </router-link>
      </nav>
    </header>

    <section class="hero">
      <h1>AI 视频创作平台</h1>
      <p class="lede">
        基于 ComfyUI 工作流的一站式 AI 视频生产工具。创建项目、写下故事背景、拆分章节与镜头，
        为每个镜头指定首帧、尾帧与剧本提示词，即可批量产出视频；支持 <strong>文生视频</strong> 与
        <strong>图生视频</strong> 两种形式。
      </p>
      <div class="hero-actions">
        <router-link class="cta" to="/console">快速开始 →</router-link>
        <a class="ghost" href="#docs">阅读开发文档</a>
      </div>
      <p class="tip">首次点击「快速开始」需要先登录。</p>
    </section>

    <section id="features" class="block">
      <h2>平台能做什么</h2>
      <div class="cards">
        <article v-for="f in FEATURES" :key="f.title" class="card feature">
          <span class="icon">{{ f.icon }}</span>
          <h3>{{ f.title }}</h3>
          <p>{{ f.text }}</p>
        </article>
      </div>
    </section>

    <section id="quickstart" class="block">
      <h2>快速开始</h2>
      <ol class="steps">
        <li v-for="s in STEPS" :key="s.n">
          <span class="num">{{ s.n }}</span>
          <div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.text }}</p>
          </div>
        </li>
      </ol>
      <router-link class="cta" to="/console">立即开始 →</router-link>
    </section>

    <section id="docs" class="block">
      <h2>开发文档</h2>
      <div class="cards docs">
        <article v-for="d in DOCS" :key="d.title" class="card">
          <h3>{{ d.title }}</h3>
          <p>{{ d.body }}</p>
        </article>
      </div>
    </section>

    <footer class="foot">AI Movie · ComfyUI 视频生产平台</footer>
  </div>
</template>

<style scoped>
.home {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 20px 60px;
}
.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 0;
  position: sticky;
  top: 0;
  background: rgba(11, 13, 20, 0.88);
  backdrop-filter: blur(8px);
  z-index: 10;
}
.brand {
  font-weight: 700;
  font-size: 17px;
}
.nav nav {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 14px;
}
.nav nav a {
  color: var(--muted);
  text-decoration: none;
}
.nav nav a:hover {
  color: var(--text);
}
.hero {
  padding: 70px 0 50px;
  text-align: center;
}
.hero h1 {
  margin: 0 0 18px;
  font-size: clamp(32px, 5vw, 50px);
  background: linear-gradient(100deg, #a5b4fc, #22d3ee);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lede {
  max-width: 720px;
  margin: 0 auto;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.85;
}
.lede strong {
  color: var(--text);
}
.hero-actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin: 30px 0 10px;
  flex-wrap: wrap;
}
.cta {
  display: inline-block;
  padding: 12px 26px;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
}
.cta.small {
  padding: 7px 15px;
  font-size: 13px;
  color: #fff !important;
}
.ghost {
  padding: 12px 26px;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  text-decoration: none;
}
.tip {
  color: var(--muted);
  font-size: 13px;
}
.block {
  padding: 46px 0;
  border-top: 1px solid var(--border);
}
.block h2 {
  margin: 0 0 26px;
  font-size: 22px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.cards h3 {
  margin: 10px 0 8px;
  font-size: 16px;
}
.cards p {
  margin: 0;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.8;
}
.feature .icon {
  font-size: 26px;
}
.docs {
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.steps {
  list-style: none;
  margin: 0 0 26px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.steps li {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.steps .num {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
}
.steps h3 {
  margin: 3px 0 4px;
  font-size: 15px;
}
.steps p {
  margin: 0;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.8;
}
.foot {
  padding-top: 30px;
  border-top: 1px solid var(--border);
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
