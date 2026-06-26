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
    const files = await getVisibleFiles('');
    const totalBytes = files.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0);
    const counts = {};
    files.forEach(f => {
      const label = f.category || 'General';
      counts[label] = (counts[label] || 0) + 1;
    });

    $('totalFiles').textContent = files.length;
    $('totalSize').textContent = formatBytes(totalBytes);
    const entries = Object.entries(counts);
    $('categoryList').innerHTML = entries.length
      ? entries.map(([category, count]) => `<span class="chip">${escapeHtml(category)}: ${count}</span>`).join('')
      : '<span class="muted">No files yet.</span>';
  } catch (err) {
    console.error(err);
  }
}

function userDepartment() {
  const role = state.user?.role || 'admin';
  if (role === 'operation') return 'Operation';
  if (role === 'maintenance') return 'Maintenance';
  return role === 'admin' ? 'All' : 'Shared';
}

function canSeeFile(file) {
  const role = state.user?.role || 'admin';
  if (role === 'admin') return true;
  const dept = userDepartment();
  const fileDept = parseCategory(file.category).department;
  return fileDept === dept || fileDept === 'Shared';
}

async function getVisibleFiles(queryText) {
  const q = encodeURIComponent(queryText || '');
  let files = await api(`/api/documents?q=${q}`, { headers: authHeaders() });
  return files.filter(canSeeFile);
}

async function loadFiles() {
  try {
    const type = $('filterCategory').value;
    const dept = $('filterDepartment').value;
    let files = await getVisibleFiles($('searchInput').value.trim());

    if (dept) files = files.filter(f => parseCategory(f.category).department === dept);
    if (type) files = files.filter(f => parseCategory(f.category).type === type);

    $('fileTable').innerHTML = files.length ? files.map(fileRow).join('') : '<tr><td colspan="7">No files found.</td></tr>';
  } catch (err) {
    $('fileTable').innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
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
        <a href="${f.url}" download="${escapeHtml(f.original_name)}"><button class="link">Download</button></a>
        ${state.user?.role === 'admin' ? `<button class="danger" onclick="deleteFile(${f.id})">Delete</button>` : ''}
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

  if (role === 'admin') {
    state.currentDept = 'All';
    $('department').disabled = false;
    $('filterDepartment').disabled = false;
    document.querySelectorAll('.nav[data-dept]').forEach(btn => btn.classList.remove('hidden'));
  } else {
    const dept = userDepartment();
    state.currentDept = dept;
    $('department').value = dept;
    $('department').disabled = true;
    $('filterDepartment').value = dept;
    $('filterDepartment').disabled = true;

    document.querySelectorAll('.nav[data-dept]').forEach(btn => {
      const visible = btn.dataset.dept === dept || btn.dataset.dept === 'Shared';
      btn.classList.toggle('hidden', !visible);
    });
  }

  setActiveNav(state.currentDept);
  updatePageTitle();
}

if (state.token) showApp();
