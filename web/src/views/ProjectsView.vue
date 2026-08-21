<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import Modal from '../components/Modal.vue';
import Pager from '../components/Pager.vue';

const BACKGROUND_MAX = 500;

const list = reactive({ items: [], page: 1, pages: 1, total: 0, pageSize: 10 });
const keyword = ref('');
const loading = ref(false);
const error = ref('');

const templates = ref([]);
const modalOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const editingId = ref(null);

const form = reactive({
  projectId: '',
  name: '',
  templateId: '',
  background: '',
  chapters: [],
});

const isEdit = computed(() => !!editingId.value);
const backgroundLeft = computed(() => BACKGROUND_MAX - form.background.length);

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

async function load(page = list.page) {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.projects({ page, pageSize: list.pageSize, keyword: keyword.value });
    Object.assign(list, res);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadTemplates() {
  const res = await api.templates({ page: 1, pageSize: 100 });
  templates.value = res.items;
}

function resetForm() {
  form.projectId = uuid();
  form.name = '';
  form.templateId = templates.value.length ? templates.value[0].templateId : '';
  form.background = '';
  form.chapters = [{ key: uuid(), chapterId: '', title: '' }];
  formError.value = '';
}

async function openCreate() {
  await loadTemplates();
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEdit(row) {
  await loadTemplates();
  const { project } = await api.project(row.projectId);
  editingId.value = project.projectId;
  form.projectId = project.projectId;
  form.name = project.name;
  form.templateId = project.templateId;
  form.background = project.background || '';
  form.chapters = (project.chapters || []).map((c) => ({
    key: c.chapterId,
    chapterId: c.chapterId,
    title: c.title,
    shotCount: (c.shots || []).length,
  }));
  if (!form.chapters.length) form.chapters.push({ key: uuid(), chapterId: '', title: '' });
  formError.value = '';
  modalOpen.value = true;
}

function addChapter() {
  form.chapters.push({ key: uuid(), chapterId: '', title: '' });
}

function removeChapter(i) {
  form.chapters.splice(i, 1);
  if (!form.chapters.length) addChapter();
}

function moveChapter(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= form.chapters.length) return;
  const [row] = form.chapters.splice(i, 1);
  form.chapters.splice(j, 0, row);
}

async function save() {
  formError.value = '';
  const chapters = form.chapters
    .map((c) => ({ chapterId: c.chapterId || undefined, title: c.title.trim() }))
    .filter((c) => c.title);
  if (!chapters.length) {
    formError.value = '至少需要一个章节标题';
    return;
  }

  saving.value = true;
  try {
    const payload = {
      projectId: form.projectId,
      name: form.name,
      templateId: form.templateId,
      background: form.background,
      chapters,
    };
    if (isEdit.value) await api.updateProject(editingId.value, payload);
    else await api.createProject(payload);
    modalOpen.value = false;
    await load(isEdit.value ? list.page : 1);
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!confirm(`删除项目「${row.name}」？该操作不可撤销。`)) return;
  try {
    await api.deleteProject(row.projectId);
    // Stepping back a page avoids landing on an empty last page.
    await load(list.items.length === 1 && list.page > 1 ? list.page - 1 : list.page);
  } catch (err) {
    error.value = err.message;
  }
}

/** Chapters open in a new tab, as specified. */
function openChapter(chapter) {
  if (!chapter.chapterId) {
    formError.value = '请先保存项目，然后再进入章节';
    return;
  }
  window.open(`/chapter/${encodeURIComponent(form.projectId)}/${encodeURIComponent(chapter.chapterId)}`, '_blank');
}

const templateName = (id) => {
  const t = templates.value.find((x) => x.templateId === id);
  return t ? t.name : id;
};

onMounted(async () => {
  await loadTemplates();
  await load(1);
});
</script>

<template>
  <div>
    <header class="head">
      <h1>我的项目</h1>
      <div class="tools">
        <input v-model="keyword" placeholder="搜索项目名称 / ID" @keyup.enter="load(1)" />
        <button type="button" class="ghost-btn" @click="load(1)">搜索</button>
        <button type="button" class="primary" @click="openCreate">+ 新建项目</button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="card table-card">
      <table>
        <thead>
          <tr>
            <th>项目名称</th>
            <th>模板</th>
            <th>章节</th>
            <th>镜头</th>
            <th>更新时间</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="empty">载入中…</td>
          </tr>
          <tr v-else-if="!list.items.length">
            <td colspan="6" class="empty">还没有项目，点击右上角「新建项目」开始创作。</td>
          </tr>
          <tr v-for="row in list.items" v-else :key="row.projectId">
            <td>
              <button type="button" class="name" @click="openEdit(row)">{{ row.name }}</button>
              <div class="mono muted">{{ row.projectId }}</div>
            </td>
            <td>{{ templateName(row.templateId) }}</td>
            <td>{{ row.chapterCount }}</td>
            <td>{{ row.shotCount }}</td>
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

    <Modal v-if="modalOpen" :title="isEdit ? '编辑项目' : '新建项目'" wide @close="modalOpen = false">
      <div class="form">
        <div class="row2">
          <label>
            <span>模板 <em>*</em></span>
            <select v-model="form.templateId" required>
              <option v-for="t in templates" :key="t.templateId" :value="t.templateId">{{ t.name }}</option>
            </select>
          </label>
          <label>
            <span>项目 ID（不可修改）</span>
            <input :value="form.projectId" class="mono" readonly disabled />
          </label>
        </div>

        <label>
          <span>项目名称 <em>*</em></span>
          <input v-model="form.name" maxlength="120" required placeholder="例如：无名之辈 · 第一季" />
        </label>

        <label>
          <span>
            故事背景
            <small class="muted">（整个故事的简介，最多 {{ BACKGROUND_MAX }} 字，剩余 {{ backgroundLeft }}）</small>
          </span>
          <textarea
            v-model="form.background"
            rows="5"
            :maxlength="BACKGROUND_MAX"
            placeholder="用几句话交代世界观、主要人物与核心冲突…"
          />
        </label>

        <div class="chapters">
          <div class="chapters-head">
            <span>章节</span>
            <button type="button" class="ghost-btn small" @click="addChapter">+ 添加章节</button>
          </div>
          <ul>
            <li v-for="(c, i) in form.chapters" :key="c.key">
              <span class="seq">{{ i + 1 }}</span>
              <input v-model="c.title" placeholder="章节标题" maxlength="200" />
              <button type="button" class="mini" title="上移" :disabled="i === 0" @click="moveChapter(i, -1)">↑</button>
              <button
                type="button"
                class="mini"
                title="下移"
                :disabled="i === form.chapters.length - 1"
                @click="moveChapter(i, 1)"
              >
                ↓
              </button>
              <button
                v-if="isEdit && c.chapterId"
                type="button"
                class="mini go"
                title="进入章节页（新窗口）"
                @click="openChapter(c)"
              >
                进入{{ c.shotCount ? ` (${c.shotCount})` : '' }}
              </button>
              <button type="button" class="mini danger" title="删除" @click="removeChapter(i)">✕</button>
            </li>
          </ul>
          <p class="muted small">保存项目后，点击章节的「进入」可在新窗口中编辑该章节的镜头。</p>
        </div>

        <p v-if="formError" class="error">{{ formError }}</p>
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
  align-items: center;
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
  gap: 16px;
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
.chapters-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--muted);
}
.chapters ul {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chapters li {
  display: flex;
  align-items: center;
  gap: 7px;
}
.seq {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--muted);
}
.mini {
  flex: 0 0 auto;
  padding: 5px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
}
.mini:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--accent);
}
.mini:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.mini.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.mini.go {
  color: var(--accent);
}
.small {
  font-size: 12px;
}
</style>
