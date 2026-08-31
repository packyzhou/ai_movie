async function request(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const send = (method) => (url, data) =>
  request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });

const post = send('POST');
const put = send('PUT');
const del = (url) => request(url, { method: 'DELETE' });

const qs = (params) =>
  Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export const api = {
  // auth
  me: () => request('/api/me'),
  login: (username, password) => post('/api/login', { username, password }),
  logout: () => post('/api/logout'),

  // reference
  options: () => request('/api/options'),
  resources: () => request('/api/resources'),
  uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    return request('/api/uploads', { method: 'POST', body: fd });
  },

  // templates
  templates: (params) => request(`/api/templates?${qs(params)}`),
  template: (id) => request(`/api/templates/${encodeURIComponent(id)}`),
  createTemplate: (data) => post('/api/templates', data),
  updateTemplate: (id, data) => put(`/api/templates/${encodeURIComponent(id)}`, data),
  deleteTemplate: (id) => del(`/api/templates/${encodeURIComponent(id)}`),
  validateTemplate: (content, type) => post('/api/templates/validate', { content, type }),

  // AI
  optimizePrompt: (prompt, settingContent = '') => post('/api/ai/optimize-prompt', { prompt, settingContent }),
  generateScript: (data) => post('/api/ai/generate-script', data),

  // assets
  assets: (params) => request(`/api/assets?${qs(params)}`),
  asset: (id) => request(`/api/assets/${encodeURIComponent(id)}`),
  createAsset: (data) => post('/api/assets', data),
  updateAsset: (id, data) => put(`/api/assets/${encodeURIComponent(id)}`, data),
  deleteAsset: (id) => del(`/api/assets/${encodeURIComponent(id)}`),
  generateAsset: (data) => post('/api/assets/generate', data),
  uploadAsset(file) {
    const fd = new FormData();
    fd.append('file', file);
    return request('/api/assets/uploads', { method: 'POST', body: fd });
  },
  createTextAsset: (content) => post('/api/assets/text', { content }),

  // settings
  settings: (params) => request(`/api/settings?${qs(params)}`),
  setting: (id) => request(`/api/settings/${encodeURIComponent(id)}`),
  createSetting: (data) => post('/api/settings', data),
  updateSetting: (id, data) => put(`/api/settings/${encodeURIComponent(id)}`, data),
  deleteSetting: (id) => del(`/api/settings/${encodeURIComponent(id)}`),

  // styles
  styles: () => request('/api/styles'),
  createStyle: (data) => post('/api/styles', data),
  updateStyle: (id, data) => put(`/api/styles/${encodeURIComponent(id)}`, data),
  deleteStyle: (id) => del(`/api/styles/${encodeURIComponent(id)}`),

  // projects
  projects: (params) => request(`/api/projects?${qs(params)}`),
  project: (id) => request(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (data) => post('/api/projects', data),
  updateProject: (id, data) => put(`/api/projects/${encodeURIComponent(id)}`, data),
  deleteProject: (id) => del(`/api/projects/${encodeURIComponent(id)}`),

  // chapters & shots
  chapter: (projectId, chapterId) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`),
  updateChapter: (projectId, chapterId, data) =>
    put(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`, data),
  createShot: (projectId, chapterId, data) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots`, data),
  updateShot: (projectId, chapterId, shotId, data) =>
    put(
      `/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}`,
      data
    ),
  deleteShot: (projectId, chapterId, shotId) =>
    del(
      `/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}`
    ),
  reorderShots: (projectId, chapterId, shotIds) =>
    put(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/reorder`, { shotIds }),
  mergeShots: (projectId, chapterId, data) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/merge`, data),
  unmergeShot: (projectId, chapterId, shotId) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}/unmerge`),

  // generation
  generate: (data) => post('/api/generate', data),
  job: (promptId) => request(`/api/jobs/${encodeURIComponent(promptId)}`),
  jobs: (limit = 20) => request(`/api/jobs?limit=${limit}`),
  cancel: (promptId) => post(`/api/jobs/${encodeURIComponent(promptId)}/cancel`),
};
