<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import Modal from '../components/Modal.vue';
import Pager from '../components/Pager.vue';

const BINDING_LABELS = {
  firstFrame: '首帧',
  lastFrame: '尾帧',
  prompt: '提示词',
  width: '宽度',
  height: '高度',
  duration: '时长',
};

const list = reactive({ items: [], page: 1, pages: 1, total: 0, pageSize: 10 });
const keyword = ref('');
const loading = ref(false);
const error = ref('');

const modalOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const editingId = ref(null);
const check = ref(null);

const form = reactive({ templateId: '', name: '', type: 'video', content: '', remark: '' });
const TYPE_LABELS = { video: '视频', image: '图片', text: '文本' };

const isEdit = computed(() => !!editingId.value);

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

async function load(page = list.page) {
  loading.value = true;
  error.value = '';
  try {
    Object.assign(list, await api.templates({ page, pageSize: list.pageSize, keyword: keyword.value }));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.templateId = uuid();
  form.name = '';
  form.type = 'video';
  form.content = '';
  form.remark = '';
  check.value = null;
  formError.value = '';
  modalOpen.value = true;
}

async function openEdit(row) {
  formError.value = '';
  check.value = null;
  try {
    const { template } = await api.template(row.templateId);
    editingId.value = template.templateId;
    form.templateId = template.templateId;
    form.name = template.name;
    form.type = template.type || 'video';
    form.content = template.content;
    form.remark = template.remark || '';
    modalOpen.value = true;
  } catch (err) {
    error.value = err.message;
  }
}

/** Self-check: parse the JSON and report which parameters could be bound. */
async function selfCheck() {
  formError.value = '';
  check.value = null;
  try {
    check.value = await api.validateTemplate(form.content, form.type);
  } catch (err) {
    formError.value = err.message;
  }
}

function formatJson() {
  try {
    form.content = JSON.stringify(JSON.parse(form.content), null, 2);
    formError.value = '';
  } catch (err) {
    formError.value = `JSON 格式化失败：${err.message}`;
  }
}

async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const payload = {
      templateId: form.templateId,
      name: form.name,
      type: form.type,
      content: form.content,
      remark: form.remark,
    };
    const res = isEdit.value ? await api.updateTemplate(editingId.value, payload) : await api.createTemplate(payload);
    modalOpen.value = false;
    await load(isEdit.value ? list.page : 1);
    if (res.missing && res.missing.length) {
      error.value = `模板已保存，但以下参数未能自动绑定：${res.missing.map((k) => BINDING_LABELS[k] || k).join('、')}。该模板暂时无法用于生成。`;
    }
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!confirm(`删除模板「${row.name}」？./api/${row.templateId}/ 下的工作流文件也会被删除。`)) return;
  try {
    await api.deleteTemplate(row.templateId);
    await load(list.items.length === 1 && list.page > 1 ? list.page - 1 : list.page);
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(() => load(1));
</script>

<template>
  <div>
    <header class="head">
      <h1>模板</h1>
      <div class="tools">
        <input v-model="keyword" placeholder="搜索模板名称 / ID" @keyup.enter="load(1)" />
        <button type="button" class="ghost-btn" @click="load(1)">搜索</button>
        <button type="button" class="primary" @click="openCreate">+ 新建模板</button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="card table-card">
      <table>
        <thead>
          <tr>
            <th>模板名称</th>
            <th>类型</th>
            <th>节点数</th>
            <th>参数绑定</th>
            <th>备注</th>
            <th>更新时间</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="empty">载入中…</td>
          </tr>
          <tr v-else-if="!list.items.length">
            <td colspan="7" class="empty">还没有模板，点击「新建模板」粘贴 ComfyUI API 格式工作流。</td>
          </tr>
          <tr v-for="row in list.items" v-else :key="row.templateId">
            <td>
              <button type="button" class="name" @click="openEdit(row)">{{ row.name }}</button>
              <span v-if="row.builtin" class="badge">内置</span>
              <div class="mono muted">{{ row.templateId }}</div>
            </td>
            <td><span class="badge">{{ TYPE_LABELS[row.type || 'video'] }}</span></td>
            <td>{{ row.nodeCount }}</td>
            <td>
              <span v-if="!row.missing || !row.missing.length" class="badge completed">全部就绪</span>
              <span v-else class="badge failed" :title="row.missing.join(', ')">
                缺 {{ row.missing.map((k) => BINDING_LABELS[k] || k).join('、') }}
              </span>
            </td>
            <td class="muted clip">{{ row.remark || '—' }}</td>
            <td class="muted">{{ new Date(row.updatedAt).toLocaleString() }}</td>
            <td class="right nowrap">
              <button type="button" class="link" @click="openEdit(row)">编辑</button>
              <button type="button" class="link danger" @click="remove(row)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <Pager :page="list.page" :pages="list.pages" :total="list.total" @update:page="load" />
    </div>

    <Modal v-if="modalOpen" :title="isEdit ? '编辑模板' : '新建模板'" wide @close="modalOpen = false">
      <div class="form">
        <div class="row2">
          <label>
            <span>模板 ID（自动生成，不可修改）</span>
            <input :value="form.templateId" class="mono" readonly disabled />
          </label>
          <label>
            <span>模板名称 <em>*</em></span>
            <input v-model="form.name" maxlength="120" required placeholder="例如：MiniMax H3 首尾帧" />
          </label>
        </div>

        <label>
          <span>模板类型 <em>*</em></span>
          <select v-model="form.type">
            <option value="video">视频</option>
            <option value="image">图片</option>
            <option value="text">文本</option>
          </select>
        </label>

        <label>
          <span>
            模板内容（ComfyUI API 格式 JSON）<em>*</em>
            <small class="muted">保存前会自检</small>
          </span>
          <textarea
            v-model="form.content"
            rows="14"
            class="mono code"
            spellcheck="false"
            placeholder='{ "3": { "class_type": "KSampler", "inputs": { ... } } }'
          />
        </label>

        <div class="check-row">
          <button type="button" class="ghost-btn small" @click="selfCheck">自检</button>
          <button type="button" class="ghost-btn small" @click="formatJson">格式化</button>
          <template v-if="check">
            <span class="badge completed">JSON 有效 · {{ check.nodeCount }} 个节点</span>
            <span v-if="check.missing.length" class="badge failed">
              未绑定：{{ check.missing.map((k) => BINDING_LABELS[k] || k).join('、') }}
            </span>
            <span v-else class="badge completed">模板所需参数全部绑定成功</span>
          </template>
        </div>

        <div v-if="check && Object.keys(check.bindings).length" class="bindings">
          <div v-for="(b, k) in check.bindings" :key="k" class="binding">
            <span class="muted">{{ BINDING_LABELS[k] || k }}</span>
            <code>{{ b.path }}</code>
          </div>
          <div v-if="check.seed" class="binding">
            <span class="muted">随机种子</span>
            <code>{{ check.seed.path }}</code>
          </div>
        </div>

        <label>
          <span>备注</span>
          <input v-model="form.remark" maxlength="500" placeholder="用途、注意事项…" />
        </label>

        <p v-if="formError" class="error">{{ formError }}</p>
        <p class="muted small">保存后工作流会写入 ./api/{{ form.templateId }}/workflow.json。</p>
      </div>

      <template #footer>
        <button type="button" class="ghost-btn" @click="modalOpen = false">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.head h1 {
  margin: 0;
  font-size: 20px;
}
.tools {
  display: flex;
  gap: 8px;
}
.tools input {
  width: 220px;
}
.table-card {
  padding: 6px 18px 16px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
th {
  text-align: left;
  padding: 12px 10px;
  color: var(--muted);
  font-weight: 500;
  font-size: 12.5px;
  border-bottom: 1px solid var(--border);
}
td {
  padding: 11px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
tbody tr:last-child td {
  border-bottom: none;
}
.right {
  text-align: right;
}
.nowrap {
  white-space: nowrap;
}
.nowrap .link + .link {
  margin-left: 12px;
}
.clip {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  text-align: center;
  color: var(--muted);
  padding: 34px 0;
}
.name {
  background: none;
  border: none;
  padding: 0;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.name:hover {
  color: var(--accent);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
em {
  color: var(--danger);
  font-style: normal;
}
.code {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bindings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 6px 16px;
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 12px;
}
.binding {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.binding code {
  font-size: 11.5px;
  color: var(--accent);
}
.small {
  font-size: 12px;
}
</style>
