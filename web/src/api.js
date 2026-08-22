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
  validateTemplate: (content) => post('/api/templates/validate', { content }),

  // projects
  projects: (params) => request(`/api/projects?${qs(params)}`),
  project: (id) => request(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (data) => post('/api/projects', data),
  updateProject: (id, data) => put(`/api/projects/${encodeURIComponent(id)}`, data),
  deleteProject: (id) => del(`/api/projects/${encodeURIComponent(id)}`),

  // chapters & shots
  chapter: (projectId, chapterId) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`),
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
  mergeShots: (projectId, chapterId) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/shots/merge`),

  // generation
  generate: (data) => post('/api/generate', data),
  job: (promptId) => request(`/api/jobs/${encodeURIComponent(promptId)}`),
  jobs: (limit = 20) => request(`/api/jobs?limit=${limit}`),
  cancel: (promptId) => post(`/api/jobs/${encodeURIComponent(promptId)}/cancel`),
};
