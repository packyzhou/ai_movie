<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from '../api';
import Modal from '../components/Modal.vue';
import Pager from '../components/Pager.vue';

const TYPE_LABELS = { image: '图片', video: '视频', text: '文本' };
const MODE_LABELS = { manual: '人工', ai: 'AI生成' };
const list = reactive({ items: [], page: 1, pages: 1, total: 0, pageSize: 10 });
const keyword = ref('');
const selectedStyleIds = ref([]);
const styles = ref([]);
const styleOpen = ref(false);
const styleName = ref('');
const styleError = ref('');
const styleSaving = ref(false);
const loading = ref(false);
const error = ref('');
const modalOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const editingId = ref('');
const templates = ref([]);
const generating = ref(false);
const generation = reactive({ status: '', message: '', promptId: '' });
let pollTimer = null;

const form = reactive({
  assetId: '', name: '', mode: 'manual', type: 'image', prompt: '', templateId: '', remark: '', styleIds: [], resources: [],
});
const isEdit = computed(() => !!editingId.value);
const matchingTemplates = computed(() => templates.value.filter((item) => (item.type || 'video') === form.type));

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

async function load(page = list.page) {
  loading.value = true;
  error.value = '';
  try {
    Object.assign(list, await api.assets({
      page,
      pageSize: list.pageSize,
      keyword: keyword.value,
      styles: selectedStyleIds.value.join(','),
    }));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadStyles() {
  styles.value = (await api.styles()).styles;
}

async function addStyle() {
  styleError.value = '';
  styleSaving.value = true;
  try {
    await api.createStyle({ name: styleName.value });
    styleName.value = '';
    await loadStyles();
  } catch (err) {
    styleError.value = err.message;
  } finally {
    styleSaving.value = false;
  }
}

async function removeStyle(style) {
  if (!confirm(`删除风格「${style.name}」？素材和项目中的该风格也会被移除。`)) return;
  styleError.value = '';
  try {
    await api.deleteStyle(style.styleId);
    selectedStyleIds.value = selectedStyleIds.value.filter((id) => id !== style.styleId);
    form.styleIds = form.styleIds.filter((id) => id !== style.styleId);
    await Promise.all([loadStyles(), load(1)]);
  } catch (err) {
    styleError.value = err.message;
  }
}

function styleNames(styleIds) {
  const selected = new Set(styleIds || []);
  return styles.value.filter((style) => selected.has(style.styleId)).map((style) => style.name);
}

function resetGeneration() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  generating.value = false;
  Object.assign(generation, { status: '', message: '', promptId: '' });
}

function assignForm(asset) {
  form.assetId = asset.assetId;
  form.name = asset.name || '';
  form.mode = asset.mode || 'manual';
  form.type = asset.type || 'image';
  form.prompt = asset.prompt || '';
  form.templateId = asset.templateId || '';
  form.remark = asset.remark || '';
  form.styleIds = [...(asset.styleIds || [])];
  form.resources = (asset.resources || []).map((item) => ({ ...item, inputMode: 'file', draft: '', busy: false }));
}

function openCreate() {
  editingId.value = '';
  assignForm({ assetId: uuid(), mode: 'manual', type: 'image', resources: [] });
  formError.value = '';
  resetGeneration();
  modalOpen.value = true;
}

async function openEdit(row) {
  formError.value = '';
  resetGeneration();
  try {
    const { asset } = await api.asset(row.assetId);
    editingId.value = asset.assetId;
    assignForm(asset);
    modalOpen.value = true;
  } catch (err) {
    error.value = err.message;
  }
}

function addResource() {
  form.resources.push({ path: '', name: '', kind: form.type, inputMode: 'file', draft: '', busy: false });
}

async function uploadResource(item, files) {
  const file = files && files[0];
  if (!file) return;
  formError.value = '';
  item.busy = true;
  try {
    Object.assign(item, await api.uploadAsset(file));
  } catch (err) {
    formError.value = err.message;
  } finally {
    item.busy = false;
  }
}

function onDrop(item, event) {
  uploadResource(item, event.dataTransfer.files);
}

async function saveDraft(item) {
  formError.value = '';
  item.busy = true;
  try {
    Object.assign(item, await api.createTextAsset(item.draft));
  } catch (err) {
    formError.value = err.message;
  } finally {
    item.busy = false;
  }
}

async function pollJob(promptId) {
  try {
    const { job } = await api.job(promptId);
    generation.status = job.status;
    generation.message = job.message;
    if (job.status === 'completed') {
      generating.value = false;
      form.resources = await Promise.all((job.videos || []).map(async (item) => {
        const resource = item.kind === 'text' && item.text
          ? await api.createTextAsset(item.text)
          : { path: item.url, name: item.filename, kind: item.kind || form.type };
        return { ...resource, inputMode: 'file', draft: '', busy: false };
      }));
      if (!form.resources.length) formError.value = '生成完成，但工作流没有返回可保存的文件资源';
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      generating.value = false;
      formError.value = job.error || job.message;
      return;
    }
    pollTimer = setTimeout(() => pollJob(promptId), 1500);
  } catch (err) {
    generating.value = false;
    formError.value = err.message;
  }
}

async function generate() {
  formError.value = '';
  generating.value = true;
  try {
    const { promptId, job } = await api.generateAsset({
      prompt: form.prompt,
      type: form.type,
      templateId: form.templateId,
    });
    Object.assign(generation, { status: job.status, message: job.message, promptId });
    pollJob(promptId);
  } catch (err) {
    generating.value = false;
    formError.value = err.message;
  }
}

async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const payload = {
      assetId: form.assetId,
      name: form.name,
      mode: form.mode,
      type: form.type,
      prompt: form.prompt,
      templateId: form.templateId,
      remark: form.remark,
      styleIds: form.styleIds,
      resources: form.resources.filter((item) => item.path).map(({ path, name, kind }) => ({ path, name, kind })),
    };
    if (form.mode === 'manual' && !payload.resources.length) throw new Error('请至少添加一个资源');
    if (form.mode === 'ai' && !payload.resources.length) throw new Error('请先生成资源');
    if (isEdit.value) await api.updateAsset(editingId.value, payload);
    else await api.createAsset(payload);
    modalOpen.value = false;
    resetGeneration();
    await load(isEdit.value ? list.page : 1);
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!confirm(`删除素材「${row.name}」？`)) return;
  try {
    await api.deleteAsset(row.assetId);
    await load(list.items.length === 1 && list.page > 1 ? list.page - 1 : list.page);
  } catch (err) {
    error.value = err.message;
  }
}

watch(() => form.type, () => {
  if (form.mode === 'ai' && !matchingTemplates.value.some((item) => item.templateId === form.templateId)) form.templateId = '';
});
watch(() => form.mode, resetGeneration);
onMounted(async () => {
  await Promise.all([
    load(1),
    loadStyles(),
    api.templates({ page: 1, pageSize: 100 }).then((data) => { templates.value = data.items; }),
  ]);
});
onUnmounted(resetGeneration);
</script>

<template>
  <div>
    <header class="head">
      <h1>素材库</h1>
      <div class="tools">
        <input v-model="keyword" placeholder="搜索素材名称 / ID" @keyup.enter="load(1)" />
        <button type="button" class="ghost-btn" @click="load(1)">搜索</button>
        <button type="button" class="ghost-btn" @click="styleOpen = true">风格管理</button>
        <button type="button" class="primary" @click="openCreate">+ 创建素材</button>
      </div>
    </header>
    <div v-if="styles.length" class="style-filter card">
      <span class="muted">按风格筛选（多选）</span>
      <label v-for="style in styles" :key="style.styleId" class="style-option">
        <input v-model="selectedStyleIds" type="checkbox" :value="style.styleId" @change="load(1)" />
        <span>{{ style.name }}</span>
      </label>
      <button v-if="selectedStyleIds.length" type="button" class="link" @click="selectedStyleIds = []; load(1)">清除</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card table-card">
      <table>
        <thead><tr><th>素材名称</th><th>模式</th><th>类型</th><th>风格</th><th>资源数</th><th>备注</th><th>更新时间</th><th class="right">操作</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" class="empty">载入中…</td></tr>
          <tr v-else-if="!list.items.length"><td colspan="8" class="empty">还没有符合条件的素材。</td></tr>
          <tr v-for="row in list.items" v-else :key="row.assetId">
            <td><button type="button" class="name" @click="openEdit(row)">{{ row.name }}</button><div class="mono muted">{{ row.assetId }}</div></td>
            <td><span class="badge">{{ MODE_LABELS[row.mode] }}</span></td>
            <td>{{ TYPE_LABELS[row.type] }}</td>
            <td><span v-for="name in styleNames(row.styleIds)" :key="name" class="badge style-badge">{{ name }}</span><span v-if="!styleNames(row.styleIds).length" class="muted">—</span></td>
            <td>{{ row.resources?.length || 0 }}</td>
            <td class="muted clip">{{ row.remark || '—' }}</td>
            <td class="muted">{{ new Date(row.updatedAt).toLocaleString() }}</td>
            <td class="right nowrap"><button type="button" class="link" @click="openEdit(row)">编辑</button><button type="button" class="link danger" @click="remove(row)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <Pager :page="list.page" :pages="list.pages" :total="list.total" @update:page="load" />
    </div>

    <Modal v-if="styleOpen" title="风格管理" @close="styleOpen = false">
      <div class="style-manager">
        <div class="style-create">
          <input v-model="styleName" maxlength="60" placeholder="输入风格名称" @keyup.enter="addStyle" />
          <button type="button" class="primary" :disabled="styleSaving || !styleName.trim()" @click="addStyle">
            {{ styleSaving ? '新增中…' : '新增风格' }}
          </button>
        </div>
        <div v-if="styles.length" class="style-list">
          <div v-for="style in styles" :key="style.styleId" class="style-row">
            <span>{{ style.name }}</span>
            <button type="button" class="link danger" @click="removeStyle(style)">删除</button>
          </div>
        </div>
        <p v-else class="muted">暂无风格。</p>
        <p v-if="styleError" class="error">{{ styleError }}</p>
      </div>
    </Modal>

    <Modal v-if="modalOpen" :title="isEdit ? '修改素材' : '创建素材'" wide @close="modalOpen = false">
      <div class="form">
        <div class="tabs">
          <button type="button" :class="{ active: form.mode === 'manual' }" @click="form.mode = 'manual'">人工</button>
          <button type="button" :class="{ active: form.mode === 'ai' }" @click="form.mode = 'ai'">AI生成</button>
        </div>
        <div class="row2">
          <label><span>素材 ID（自动生成，不可修改）</span><input :value="form.assetId" class="mono" disabled /></label>
          <label><span>素材名 *</span><input v-model="form.name" maxlength="120" placeholder="请输入素材名" /></label>
        </div>

        <div class="field">
          <span>风格（可多选）</span>
          <div v-if="styles.length" class="style-options">
            <label v-for="style in styles" :key="style.styleId" class="style-option">
              <input v-model="form.styleIds" type="checkbox" :value="style.styleId" />
              <span>{{ style.name }}</span>
            </label>
          </div>
          <span v-else class="muted small">暂无风格，可在“风格管理”中新增。</span>
        </div>

        <template v-if="form.mode === 'manual'">
          <div class="resource-head"><span>资源列表 *</span><button type="button" class="ghost-btn small" @click="addResource">+ 添加 item</button></div>
          <div v-if="!form.resources.length" class="empty-box">请添加图片、视频、文本文件，或手写文本。</div>
          <div v-for="(item, index) in form.resources" :key="index" class="resource-card">
            <div class="resource-tabs">
              <button type="button" :class="{ active: item.inputMode === 'file' }" @click="item.inputMode = 'file'">上传文件</button>
              <button type="button" :class="{ active: item.inputMode === 'text' }" @click="item.inputMode = 'text'">手写输入</button>
              <button type="button" class="link danger remove" @click="form.resources.splice(index, 1)">移除</button>
            </div>
            <label v-if="item.inputMode === 'file'" class="drop" @dragover.prevent @drop.prevent="onDrop(item, $event)">
              <input type="file" accept="image/*,video/*,.txt,.md" hidden @change="uploadResource(item, $event.target.files)" />
              <span>{{ item.busy ? '上传中…' : item.path ? item.name : '点击选择或拖拽图片 / 视频 / 文本文件' }}</span>
            </label>
            <div v-else class="text-entry"><textarea v-model="item.draft" rows="5" placeholder="输入 Markdown 文本内容" /><button type="button" class="ghost-btn small" :disabled="item.busy" @click="saveDraft(item)">保存为 md 文件</button></div>
            <div v-if="item.path" class="preview">
              <img v-if="item.kind === 'image'" :src="item.path" :alt="item.name" />
              <video v-else-if="item.kind === 'video'" :src="item.path" controls />
              <iframe v-else :src="item.path" :title="item.name" />
              <a class="link mono" :href="item.path" target="_blank">{{ item.path }}</a>
            </div>
          </div>
        </template>

        <template v-else>
          <label><span>生成类型 *</span><select v-model="form.type"><option value="image">图片</option><option value="video">视频</option><option value="text">文本</option></select></label>
          <label><span>AI 模板 *</span><select v-model="form.templateId"><option value="">{{ matchingTemplates.length ? '请选择同类型模板' : '暂无同类型模板' }}</option><option v-for="item in matchingTemplates" :key="item.templateId" :value="item.templateId">{{ item.name }}</option></select></label>
          <label><span>提示词 *</span><textarea v-model="form.prompt" rows="6" placeholder="请输入生成提示词" /></label>
          <div class="generation-row"><button type="button" class="primary" :disabled="generating || !form.templateId || !form.prompt.trim()" @click="generate">{{ generating ? '生成中…' : '生成并预览' }}</button><span v-if="generation.status" class="muted">{{ generation.message }}</span></div>
          <div v-if="form.resources.length" class="generated-grid">
            <div v-for="item in form.resources" :key="item.path" class="preview">
              <img v-if="item.kind === 'image'" :src="item.path" :alt="item.name" />
              <video v-else-if="item.kind === 'video'" :src="item.path" controls />
              <iframe v-else :src="item.path" :title="item.name" />
              <a class="link mono" :href="item.path" target="_blank">{{ item.name }}</a>
            </div>
          </div>
        </template>

        <label><span>备注</span><textarea v-model="form.remark" rows="2" maxlength="500" placeholder="素材说明、用途等" /></label>
        <p v-if="formError" class="error">{{ formError }}</p>
      </div>
      <template #footer><button type="button" class="ghost-btn" @click="modalOpen = false">取消</button><button type="button" class="primary" :disabled="saving || generating" @click="save">{{ saving ? '保存中…' : '保存' }}</button></template>
    </Modal>
  </div>
</template>

<style scoped>
.head,.tools,.resource-head,.generation-row{display:flex;align-items:center}.head{justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap}.head h1{margin:0;font-size:20px}.tools{gap:8px}.tools input{width:220px}.table-card{padding:6px 18px 16px}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12.5px}.right{text-align:right}.nowrap{white-space:nowrap}.nowrap .link+.link{margin-left:12px}.clip{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.empty{text-align:center;color:var(--muted);padding:34px}.name{background:none;border:0;padding:0;color:var(--text);font:inherit;font-weight:600;cursor:pointer}.form{display:flex;flex-direction:column;gap:15px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.tabs,.resource-tabs{display:flex;border-bottom:1px solid var(--border)}.tabs button,.resource-tabs button:not(.remove){padding:9px 16px;border:0;background:none;color:var(--muted);cursor:pointer}.tabs button.active,.resource-tabs button.active{color:var(--text);border-bottom:2px solid var(--accent)}.resource-head{justify-content:space-between}.resource-card,.empty-box{padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)}.empty-box{text-align:center;color:var(--muted)}.resource-tabs .remove{margin-left:auto}.drop{min-height:100px;margin-top:12px;border:1px dashed var(--border);border-radius:8px;display:grid;place-items:center;text-align:center;cursor:pointer}.drop:hover{border-color:var(--accent)}.text-entry{display:flex;flex-direction:column;align-items:flex-end;gap:8px;margin-top:12px}.preview{display:flex;flex-direction:column;gap:7px;margin-top:12px;min-width:0}.preview img,.preview video,.preview iframe{width:100%;max-height:280px;object-fit:contain;border:1px solid var(--border);border-radius:8px;background:#090b11}.preview iframe{height:180px}.preview a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.generation-row{gap:12px}.generated-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}@media(max-width:700px){.row2{grid-template-columns:1fr}.tools{flex-wrap:wrap}.tools input{width:100%}}
.style-filter,.style-options{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.style-filter{margin-bottom:14px;padding:10px 14px}.style-option{display:inline-flex;flex-direction:row;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--border);border-radius:999px;background:var(--surface-2);cursor:pointer}.style-option input{width:auto;margin:0;accent-color:var(--accent)}.style-option span{color:var(--text);font-size:12px}.style-badge{display:inline-block;margin:0 4px 4px 0}.style-manager{display:flex;flex-direction:column;gap:14px}.style-create{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.style-list{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:9px;overflow:hidden}.style-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border)}.style-row:last-child{border-bottom:0}
</style>
