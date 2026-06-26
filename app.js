const state = {
  apiUrl: localStorage.getItem('apiUrl') || 'http://localhost:3000',
  token: localStorage.getItem('token') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  currentDept: 'All'
};

const $ = (id) => document.getElementById(id);

$('apiUrl').value = state.apiUrl;

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`;
}

function showApp() {
  $('loginSection').classList.add('hidden');
  $('dashboardSection').classList.remove('hidden');
  $('userPill').textContent = state.user ? `${state.user.username} • ${state.user.role}` : 'User';
  applyRoleView();
  loadAll();
}

function showLogin() {
  $('loginSection').classList.remove('hidden');
  $('dashboardSection').classList.add('hidden');
}

async function api(path, options = {}) {
  const res = await fetch(`${state.apiUrl}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

$('loginBtn').addEventListener('click', async () => {
  $('loginMsg').textContent = 'Logging in...';
  try {
    state.apiUrl = $('apiUrl').value.trim().replace(/\/$/, '');
    const data = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('apiUrl', state.apiUrl);
    localStorage.setItem('token', state.token);
    localStorage.setItem('user', JSON.stringify(state.user));
    $('loginMsg').textContent = 'Login successful.';
    showApp();
  } catch (err) {
    $('loginMsg').textContent = err.message;
  }
});

$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  state.token = '';
  state.user = null;
  showLogin();
});

$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('uploadMsg').textContent = 'Uploading...';
  try {
    const form = new FormData();
    form.append('title', $('title').value.trim());
    form.append('category', `${$('department').value} - ${$('category').value}`);
    form.append('description', $('description').value.trim());
    form.append('file', $('file').files[0]);

    await fetch(`${state.apiUrl}/api/documents`, {
      method: 'POST',
      headers: authHeaders(),
      body: form
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    });

    $('uploadForm').reset();
    $('category').value = 'General';
    $('uploadMsg').textContent = 'Uploaded successfully.';
    loadAll();
  } catch (err) {
    $('uploadMsg').textContent = err.message;
  }
});

$('searchInput').addEventListener('input', debounce(loadFiles, 300));
$('filterCategory').addEventListener('change', loadFiles);
$('filterDepartment').addEventListener('change', () => {
  state.currentDept = $('filterDepartment').value || 'All';
  setActiveNav(state.currentDept);
  updatePageTitle();
  loadFiles();
});
document.querySelectorAll('.nav[data-dept]').forEach(btn => btn.addEventListener('click', () => {
  state.currentDept = btn.dataset.dept;
  $('filterDepartment').value = state.currentDept === 'All' ? '' : state.currentDept;
  setActiveNav(state.currentDept);
  updatePageTitle();
  loadFiles();
}));

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function loadAll() {
  await Promise.all([checkHealth(), loadStats(), loadFiles()]);
}

async function checkHealth() {
  try {
    await api('/api/health');
    $('serverStatus').textContent = 'Online';
  } catch {
    $('serverStatus').textContent = 'Offline';
  }
}

async function loadStats() {
  try {
    const stats = await api('/api/stats', { headers: authHeaders() });
    $('totalFiles').textContent = stats.total_files;
    $('totalSize').textContent = formatBytes(stats.total_bytes);
    $('categoryList').innerHTML = stats.categories.length
      ? stats.categories.map(c => `<span class="chip">${escapeHtml(c.category)}: ${c.count}</span>`).join('')
      : '<span class="muted">No files yet.</span>';
  } catch (err) {
    console.error(err);
  }
}

async function loadFiles() {
  try {
    const q = encodeURIComponent($('searchInput').value.trim());
    const type = $('filterCategory').value;
    const dept = $('filterDepartment').value;
    const category = encodeURIComponent(type ? `${dept ? dept + ' - ' : ''}${type}` : '');
    let files = await api(`/api/documents?q=${q}&category=${category}`, { headers: authHeaders() });
    if (dept && !type) files = files.filter(f => parseCategory(f.category).department === dept);
    $('fileTable').innerHTML = files.length ? files.map(fileRow).join('') : '<tr><td colspan="7">No files found.</td></tr>';
  } catch (err) {
    $('fileTable').innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
  }
}

function fileRow(f) {
  return `
    <tr>
      <td><strong>${escapeHtml(f.title)}</strong><br><span class="muted small">${escapeHtml(f.description || '')}</span></td>
      <td><span class="chip">${escapeHtml(parseCategory(f.category).department)}</span></td>
      <td>${escapeHtml(parseCategory(f.category).type)}</td>
      <td>${escapeHtml(f.original_name)}</td>
      <td>${formatBytes(f.size_bytes)}</td>
      <td>${new Date(f.created_at).toLocaleString()}</td>
      <td class="actions">
        <a href="${f.url}" target="_blank"><button class="link">Open</button></a>
        <button class="danger" onclick="deleteFile(${f.id})">Delete</button>
      </td>
    </tr>`;
}

async function deleteFile(id) {
  if (!confirm('Delete this file?')) return;
  try {
    await api(`/api/documents/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadAll();
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function parseCategory(category) {
  const text = String(category || 'General');
  if (text.includes(' - ')) {
    const [department, ...rest] = text.split(' - ');
    return { department, type: rest.join(' - ') || 'General' };
  }
  return { department: 'Shared', type: text };
}

function setActiveNav(dept) {
  document.querySelectorAll('.nav[data-dept]').forEach(btn => btn.classList.toggle('active', btn.dataset.dept === dept));
}

function updatePageTitle() {
  $('pageTitle').textContent = state.currentDept === 'All' ? 'Dashboard' : `${state.currentDept} Department`;
  $('currentDept').textContent = state.currentDept;
}

function applyRoleView() {
  const role = state.user?.role || 'admin';
  if (role !== 'admin') {
    const dept = role === 'operation' ? 'Operation' : role === 'maintenance' ? 'Maintenance' : 'Shared';
    state.currentDept = dept;
    $('department').value = dept;
    $('department').disabled = true;
    $('filterDepartment').value = dept;
    $('filterDepartment').disabled = true;
  }
  setActiveNav(state.currentDept);
  updatePageTitle();
}

if (state.token) showApp();
