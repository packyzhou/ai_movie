<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import Modal from '../components/Modal.vue';

const list = ref([]);
const loading = ref(false);
const error = ref('');
const modalOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const editingId = ref('');
const DEFAULT_CONTENT = `【画风】电影感写实，轻微柔光晕染
【细致度】高（布料纹理、水面反光可见）
【色调】主色深蓝紫 + 辅色霓虹粉青，冷调
【光影】霓虹光源，阴影偏蓝紫，高对比
【质感】胶片颗粒，略带模糊
【氛围】繁华又孤寂的赛博朋克夜
【约束】全程保持以上画风、色调、光影、质感、氛围不变。`;
const form = reactive({ settingId: '', name: '', content: DEFAULT_CONTENT, remark: '' });

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    list.value = (await api.settings({ page: 1, pageSize: 100 })).items;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = '';
  Object.assign(form, { settingId: uuid(), name: '', content: DEFAULT_CONTENT, remark: '' });
  formError.value = '';
  modalOpen.value = true;
}

async function openEdit(row) {
  try {
    const { setting } = await api.setting(row.settingId);
    editingId.value = setting.settingId;
    Object.assign(form, setting);
    formError.value = '';
    modalOpen.value = true;
  } catch (err) {
    error.value = err.message;
  }
}

async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const payload = { settingId: form.settingId, name: form.name, content: form.content, remark: form.remark };
    if (editingId.value) await api.updateSetting(editingId.value, payload);
    else await api.createSetting(payload);
    modalOpen.value = false;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!confirm(`删除设定模板「${row.name}」？`)) return;
  try {
    await api.deleteSetting(row.settingId);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="head">
      <h1>设定模板</h1>
      <button type="button" class="primary" @click="openCreate">+ 新建设定</button>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="card table-card">
      <table>
        <thead><tr><th>设定名称</th><th>设定内容</th><th>备注</th><th>更新时间</th><th class="right">操作</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="5" class="empty">载入中…</td></tr>
          <tr v-else-if="!list.length"><td colspan="5" class="empty">还没有设定模板，点击右上角开始创建。</td></tr>
          <tr v-for="row in list" v-else :key="row.settingId">
            <td><button type="button" class="name" @click="openEdit(row)">{{ row.name }}</button><div class="mono muted">{{ row.settingId }}</div></td>
            <td class="content-preview">{{ row.content }}</td>
            <td class="muted">{{ row.remark || '—' }}</td>
            <td class="muted">{{ new Date(row.updatedAt).toLocaleString() }}</td>
            <td class="right nowrap"><button type="button" class="link" @click="openEdit(row)">编辑</button><button type="button" class="link danger" @click="remove(row)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="modalOpen" :title="editingId ? '编辑设定模板' : '新建设定模板'" wide @close="modalOpen = false">
      <div class="form">
        <div class="row2">
          <label><span>设定 ID（自动生成，不可修改）</span><input :value="form.settingId" class="mono" disabled /></label>
          <label><span>设定名称 *</span><input v-model="form.name" maxlength="120" placeholder="例如：赛博朋克电影感" /></label>
        </div>
        <label><span>设定内容 *</span><textarea v-model="form.content" rows="16" maxlength="20000" placeholder="输入画风、色调、光影、质感、氛围和约束…" /></label>
        <label><span>备注</span><input v-model="form.remark" maxlength="500" placeholder="用途、适用场景等" /></label>
        <p v-if="formError" class="error">{{ formError }}</p>
      </div>
      <template #footer><button type="button" class="ghost-btn" @click="modalOpen = false">取消</button><button type="button" class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button></template>
    </Modal>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}.head h1{margin:0;font-size:20px}.table-card{padding:6px 18px 16px}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12.5px}.right{text-align:right}.nowrap{white-space:nowrap}.nowrap .link+.link{margin-left:12px}.empty{text-align:center;color:var(--muted);padding:34px}.name{background:none;border:0;padding:0;color:var(--text);font:inherit;font-weight:600;cursor:pointer}.name:hover{color:var(--accent)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.muted{color:var(--muted)}.content-preview{max-width:420px;white-space:pre-wrap;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}.form{display:flex;flex-direction:column;gap:15px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:700px){.row2{grid-template-columns:1fr}}
</style>
