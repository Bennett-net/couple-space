// ==================== 全局状态 ====================
let currentUser = null;
let token = null;
let socket = null;
let chatFileToSend = null;
let typingTimer = null;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  // 检查是否已登录
  const savedToken = localStorage.getItem('couple_space_token');
  const savedUser = localStorage.getItem('couple_space_user');
  if (savedToken && savedUser) {
    token = savedToken;
    currentUser = JSON.parse(savedUser);
    showMainApp();
    connectSocket();
    loadInitialData();
  }

  // 心情选择器
  document.querySelectorAll('.mood-option').forEach(el => {
    el.addEventListener('click', function() {
      document.querySelectorAll('.mood-option').forEach(e => e.classList.remove('selected'));
      this.classList.add('selected');
    });
  });

  // 回车登录
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  // 回车发送消息
  document.getElementById('chatInput').addEventListener('keydown', handleChatKeydown);
});

// ==================== Toast ====================
function showToast(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ==================== API 请求封装 ====================
async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('登录已过期');
  }
  return res.json();
}

// ==================== 认证 ====================
async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) {
    showToast('请输入账号和密码');
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error);
      return;
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('couple_space_token', token);
    localStorage.setItem('couple_space_user', JSON.stringify(currentUser));

    showMainApp();
    connectSocket();
    loadInitialData();
    showToast(`欢迎回来，${currentUser.display_name}~`);
  } catch (err) {
    showToast('登录失败，请重试');
  }
}

function logout() {
  localStorage.removeItem('couple_space_token');
  localStorage.removeItem('couple_space_user');
  token = null;
  currentUser = null;
  if (socket) socket.disconnect();
  document.getElementById('mainApp').classList.remove('active');
  document.getElementById('loginPage').classList.add('active');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function showMainApp() {
  document.getElementById('loginPage').classList.remove('active');
  document.getElementById('mainApp').classList.add('active');
}

// ==================== Socket.IO ====================
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authError', (msg) => {
    showToast(msg);
  });

  socket.on('newMessage', (message) => {
    appendMessage(message);
  });

  socket.on('userOnline', (user) => {
    document.getElementById('partnerStatus').classList.add('online');
  });

  socket.on('userOffline', (user) => {
    document.getElementById('partnerStatus').classList.remove('online');
  });

  socket.on('userTyping', (user) => {
    const typingEl = document.getElementById('chatTyping');
    document.getElementById('typingName').textContent = user.displayName;
    typingEl.style.display = 'flex';
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingEl.style.display = 'none';
    }, 3000);
  });

  socket.on('userStopTyping', () => {
    document.getElementById('chatTyping').style.display = 'none';
  });
}

// ==================== 加载初始数据 ====================
async function loadInitialData() {
  await Promise.all([
    loadMessages(),
    loadPartner(),
    checkOnlineStatus()
  ]);
}

async function loadPartner() {
  try {
    const partner = await api('/api/partner');
    document.getElementById('partnerName').textContent = partner.display_name;
  } catch (e) {}
}

async function checkOnlineStatus() {
  // Socket 会自动处理在线状态
}

// ==================== 聊天 ====================
async function loadMessages() {
  try {
    const messages = await api('/api/messages');
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    if (messages.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="empty-icon">💬</div>
          <p>还没有消息，来说第一句话吧~</p>
        </div>`;
    } else {
      messages.forEach(msg => appendMessage(msg, false));
    }
  } catch (e) {}
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('chatMessages');
  // 移除空状态
  const emptyEl = container.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();

  const isSelf = msg.sender_id === currentUser.id;
  const wrapper = document.createElement('div');
  wrapper.className = `chat-bubble ${isSelf ? 'self' : 'other'}`;

  const time = new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  let html = '';
  if (!isSelf) {
    html += `<div class="msg-sender">${msg.sender_name}</div>`;
  }

  if (msg.content) {
    html += `<div class="msg-text">${escapeHtml(msg.content)}</div>`;
  }

  if (msg.image_url) {
    html += `<img class="msg-image" src="${msg.image_url}" onclick="openImagePreview('${msg.image_url}')" loading="lazy">`;
  }

  if (msg.file_url && !msg.image_url) {
    const icon = getFileIcon(msg.file_name);
    html += `<div class="msg-file" onclick="window.open('${msg.file_url}')">
      <span>${icon}</span>
      <span>${msg.file_name || '文件'}</span>
    </div>`;
  }

  html += `<div class="msg-time">${time}</div>`;
  wrapper.innerHTML = html;
  container.appendChild(wrapper);

  if (scroll) {
    container.scrollTop = container.scrollHeight;
  }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();

  if (!content && !chatFileToSend) return;

  if (chatFileToSend) {
    // 有文件先上传
    uploadAndSend(content);
  } else if (content) {
    socket.emit('sendMessage', { content });
    input.value = '';
    input.style.height = 'auto';
  }
}

async function uploadAndSend(text) {
  const formData = new FormData();
  formData.append('file', chatFileToSend);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (data.url) {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(chatFileToSend.name);
      socket.emit('sendMessage', {
        content: text,
        imageUrl: isImage ? data.url : '',
        fileUrl: isImage ? '' : data.url,
        fileName: chatFileToSend.name
      });
    }
  } catch (e) {
    showToast('文件上传失败');
  }

  clearChatPreview();
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').style.height = 'auto';
}

function handleChatFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  chatFileToSend = file;
  const preview = document.getElementById('chatPreview');
  const previewImg = document.getElementById('chatPreviewImg');
  const previewName = document.getElementById('chatPreviewName');

  if (file.type.startsWith('image/')) {
    previewImg.src = URL.createObjectURL(file);
    previewImg.style.display = 'block';
  } else {
    previewImg.style.display = 'none';
  }
  previewName.textContent = file.name;
  preview.style.display = 'flex';

  // 自动发送
  sendMessage();
}

function clearChatPreview() {
  chatFileToSend = null;
  document.getElementById('chatPreview').style.display = 'none';
  document.getElementById('chatFileInput').value = '';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';

  // 正在输入状态
  if (socket && el.value.trim()) {
    socket.emit('typing');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('stopTyping'), 2000);
  }
}

// ==================== 日记 ====================
async function loadDiary() {
  try {
    const entries = await api('/api/diary');
    const container = document.getElementById('diaryList');
    if (entries.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>还没有日记，记录你们的每一天吧~</p></div>`;
      return;
    }

    container.innerHTML = entries.map(entry => `
      <div class="diary-card" onclick="viewDiaryDetail(${entry.id})">
        <div class="diary-header">
          <div class="diary-title">
            <span class="diary-mood">${entry.mood}</span>
            ${escapeHtml(entry.title)}
          </div>
          <span class="diary-meta">${entry.author_name}</span>
        </div>
        <div class="diary-content">${escapeHtml(entry.content)}</div>
        ${entry.image_url ? `<img class="diary-image" src="${entry.image_url}" loading="lazy">` : ''}
        <div class="diary-meta" style="margin-top:8px;">
          <span>${formatDate(entry.created_at)}</span>
          ${entry.updated_at !== entry.created_at ? '<span>已编辑</span>' : ''}
        </div>
        <div class="diary-actions" onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-secondary" onclick="editDiary(${entry.id})">编辑</button>
          <button class="btn btn-sm btn-secondary" onclick="deleteDiary(${entry.id})">删除</button>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function showDiaryEditor() {
  document.getElementById('diaryEditorTitle').textContent = '写日记';
  document.getElementById('diaryEditId').value = '';
  document.getElementById('diaryTitle').value = '';
  document.getElementById('diaryContent').value = '';
  document.getElementById('diaryImageInput').value = '';
  document.getElementById('diaryImagePreview').style.display = 'none';
  document.querySelector('.mood-option.selected')?.classList.remove('selected');
  document.querySelector('.mood-option[data-mood="😊"]').classList.add('selected');
  document.getElementById('diaryEditorModal').classList.add('active');
}

async function editDiary(id) {
  try {
    const entries = await api('/api/diary');
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    document.getElementById('diaryEditorTitle').textContent = '编辑日记';
    document.getElementById('diaryEditId').value = entry.id;
    document.getElementById('diaryTitle').value = entry.title;
    document.getElementById('diaryContent').value = entry.content;
    document.getElementById('diaryImagePreview').style.display = 'none';

    document.querySelectorAll('.mood-option').forEach(e => e.classList.remove('selected'));
    const moodEl = document.querySelector(`.mood-option[data-mood="${entry.mood}"]`);
    if (moodEl) moodEl.classList.add('selected');

    document.getElementById('diaryEditorModal').classList.add('active');
  } catch (e) {}
}

function closeDiaryEditor() {
  document.getElementById('diaryEditorModal').classList.remove('active');
}

async function saveDiary() {
  const id = document.getElementById('diaryEditId').value;
  const title = document.getElementById('diaryTitle').value.trim();
  const content = document.getElementById('diaryContent').value.trim();
  const mood = document.querySelector('.mood-option.selected')?.dataset.mood || '😊';

  if (!title || !content) {
    showToast('请填写标题和内容');
    return;
  }

  const body = { title, content, mood };

  // 处理配图
  const imageInput = document.getElementById('diaryImageInput');
  if (imageInput.files[0]) {
    const formData = new FormData();
    formData.append('file', imageInput.files[0]);
    try {
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (uploadData.url) body.image_url = uploadData.url;
    } catch (e) {}
  }

  const url = id ? `/api/diary/${id}` : '/api/diary';
  const method = id ? 'PUT' : 'POST';

  try {
    await api(url, { method, body: JSON.stringify(body) });
    closeDiaryEditor();
    loadDiary();
    showToast(id ? '日记已更新' : '日记已保存');
  } catch (e) {
    showToast('保存失败');
  }
}

async function deleteDiary(id) {
  if (!confirm('确定删除这篇日记吗？')) return;
  try {
    await api(`/api/diary/${id}`, { method: 'DELETE' });
    loadDiary();
    showToast('日记已删除');
  } catch (e) {}
}

function viewDiaryDetail(id) {
  // 点击日记卡片查看详情（简单实现：滚动到该卡片）
  // 实际可以用更好的方式展示
}

function previewDiaryImage(event) {
  const file = event.target.files[0];
  if (file) {
    const preview = document.getElementById('diaryImagePreview');
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  }
}

// ==================== 相册 ====================
async function loadAlbum() {
  try {
    const photos = await api('/api/album');
    const container = document.getElementById('albumGrid');
    if (photos.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🖼️</div><p>还没有照片，上传你们的甜蜜瞬间吧~</p></div>`;
      container.style.display = 'flex';
      return;
    }

    container.style.display = 'grid';
    container.innerHTML = photos.map(photo => `
      <div class="album-photo">
        <img src="${photo.image_url}" onclick="openImagePreview('${photo.image_url}')" loading="lazy">
        ${photo.caption ? `<div class="photo-caption">${escapeHtml(photo.caption)}</div>` : ''}
        <button class="photo-delete" onclick="event.stopPropagation(); deletePhoto(${photo.id})">✕</button>
      </div>
    `).join('');
  } catch (e) {}
}

async function handleAlbumUpload(event) {
  const files = event.target.files;
  if (!files.length) return;

  for (const file of files) {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('caption', '');

    try {
      const res = await fetch('/api/album', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
    } catch (e) {}
  }

  loadAlbum();
  showToast('照片上传完成');
}

async function deletePhoto(id) {
  if (!confirm('确定删除这张照片吗？')) return;
  try {
    await api(`/api/album/${id}`, { method: 'DELETE' });
    loadAlbum();
    showToast('照片已删除');
  } catch (e) {}
}

// ==================== 纪念日 ====================
async function loadReminders() {
  try {
    const reminders = await api('/api/reminders');
    const container = document.getElementById('reminderList');
    if (reminders.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>还没有纪念日，添加你们的特别日子吧~</p></div>`;
      return;
    }

    container.innerHTML = reminders.map(r => {
      const isToday = r.countdown === 0;
      const countdownClass = isToday ? 'today' : '';
      const daysText = isToday ? '今天' : (r.countdown > 0 ? r.countdown : '已过');
      const labelText = isToday ? '🎉' : (r.countdown > 0 ? '天后' : '');

      return `
        <div class="reminder-card">
          <div class="countdown">
            <div class="days ${countdownClass}">${daysText}</div>
            <div class="label">${labelText}</div>
          </div>
          <div class="reminder-info">
            <div class="reminder-title">
              ${escapeHtml(r.title)}
              <span class="reminder-type">${getTypeLabel(r.type)}</span>
            </div>
            ${r.description ? `<div class="reminder-desc">${escapeHtml(r.description)}</div>` : ''}
            <div class="reminder-date">${r.date}${r.recurring ? ' · 每年' : ''}</div>
          </div>
          <div class="reminder-actions">
            <button class="btn-icon" onclick="editReminder(${r.id})" title="编辑">✏️</button>
            <button class="btn-icon" onclick="deleteReminder(${r.id})" title="删除">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {}
}

function getTypeLabel(type) {
  const map = { anniversary: '纪念日', date: '约会', reminder: '提醒' };
  return map[type] || type;
}

function showReminderEditor() {
  document.getElementById('reminderEditorTitle').textContent = '添加纪念日';
  document.getElementById('reminderEditId').value = '';
  document.getElementById('reminderTitle').value = '';
  document.getElementById('reminderDesc').value = '';
  document.getElementById('reminderDate').value = '';
  document.getElementById('reminderRecurring').checked = true;
  document.getElementById('reminderType').value = 'anniversary';
  document.getElementById('reminderEditorModal').classList.add('active');
}

async function editReminder(id) {
  try {
    const reminders = await api('/api/reminders');
    const r = reminders.find(rem => rem.id === id);
    if (!r) return;

    document.getElementById('reminderEditorTitle').textContent = '编辑纪念日';
    document.getElementById('reminderEditId').value = r.id;
    document.getElementById('reminderTitle').value = r.title;
    document.getElementById('reminderDesc').value = r.description;
    document.getElementById('reminderDate').value = r.date;
    document.getElementById('reminderType').value = r.type;
    document.getElementById('reminderRecurring').checked = !!r.recurring;
    document.getElementById('reminderEditorModal').classList.add('active');
  } catch (e) {}
}

function closeReminderEditor() {
  document.getElementById('reminderEditorModal').classList.remove('active');
}

async function saveReminder() {
  const id = document.getElementById('reminderEditId').value;
  const title = document.getElementById('reminderTitle').value.trim();
  const description = document.getElementById('reminderDesc').value.trim();
  const date = document.getElementById('reminderDate').value;
  const type = document.getElementById('reminderType').value;
  const recurring = document.getElementById('reminderRecurring').checked;

  if (!title || !date) {
    showToast('请填写标题和日期');
    return;
  }

  const body = { title, description, date, type, recurring };

  const url = id ? `/api/reminders/${id}` : '/api/reminders';
  const method = id ? 'PUT' : 'POST';

  try {
    await api(url, { method, body: JSON.stringify(body) });
    closeReminderEditor();
    loadReminders();
    showToast(id ? '纪念日已更新' : '纪念日已添加');
  } catch (e) {
    showToast('保存失败');
  }
}

async function deleteReminder(id) {
  if (!confirm('确定删除这个纪念日吗？')) return;
  try {
    await api(`/api/reminders/${id}`, { method: 'DELETE' });
    loadReminders();
    showToast('纪念日已删除');
  } catch (e) {}
}

// ==================== Tab 切换 ====================
function switchTab(tab) {
  // 更新导航
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  // 更新页面
  document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
  document.getElementById(`${tab}Page`).classList.add('active');

  // 加载数据
  if (tab === 'diary') loadDiary();
  else if (tab === 'album') loadAlbum();
  else if (tab === 'reminders') loadReminders();
  else if (tab === 'chat') {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
  }
}

// ==================== 图片预览 ====================
function openImagePreview(url) {
  document.getElementById('imagePreviewFull').src = url;
  document.getElementById('imagePreviewModal').classList.add('active');
}

function closeImagePreview() {
  document.getElementById('imagePreviewModal').classList.remove('active');
}

// ==================== 设置 ====================
function showSettings() {
  document.getElementById('settingsUsername').textContent = currentUser.username;
  document.getElementById('settingsDisplayName').textContent = currentUser.display_name;
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

async function changePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;

  if (!oldPassword || !newPassword) {
    showToast('请填写原密码和新密码');
    return;
  }

  if (newPassword.length < 6) {
    showToast('新密码至少6位');
    return;
  }

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error);
    } else {
      showToast('密码修改成功');
      closeSettings();
    }
  } catch (e) {
    showToast('修改失败');
  }
}

// ==================== 工具函数 ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getFileIcon(filename) {
  if (!filename) return '📄';
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📊', xlsx: '📊',
    txt: '📝', zip: '📦', rar: '📦', mp4: '🎬', mov: '🎬'
  };
  return icons[ext] || '📎';
}
