import { API_BASE } from './config';

function token() { return localStorage.getItem('planforge-token'); }

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `request_failed_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  createOrg: (body) => request('/api/orgs/activate', { method: 'POST', body: JSON.stringify(body) }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  recover: (email, recoveryCode, newPassword) => request('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email, recoveryCode, newPassword }) }),
  regenerateRecoveryCode: () => request('/api/auth/recovery-code/regenerate', { method: 'POST' }),
  forgotPassword: (email) => request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPasswordWithEmailCode: (email, code, newPassword) => request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) }),
  me: () => request('/api/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  members: () => request('/api/team/members'),
  addMember: (email, name) => request('/api/team/members', { method: 'POST', body: JSON.stringify({ email, name }) }),
  removeMember: (id) => request(`/api/team/members/${id}`, { method: 'DELETE' }),
  resetMemberPassword: (id) => request(`/api/team/members/${id}/reset-password`, { method: 'POST' }),

  getOrg: () => request('/api/org'),
  updateOrg: (body) => request('/api/org', { method: 'PATCH', body: JSON.stringify(body) }),

  tasks: () => request('/api/tasks'),
  createTask: (task) => request('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, patch) => request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  deleteSeries: (recurrenceId, fromDate) => request(`/api/tasks/series/${recurrenceId}?fromDate=${fromDate}`, { method: 'DELETE' }),

  plan: (prompt) => request('/api/plan', { method: 'POST', body: JSON.stringify({ prompt }) }),
};

export function saveToken(t) { localStorage.setItem('planforge-token', t); }
export function clearToken() { localStorage.removeItem('planforge-token'); }
export function hasToken() { return !!token(); }
