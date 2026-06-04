const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'couple-space-secret-key-2024';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ==================== Express + HTTP + Socket.IO ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ==================== 数据库初始化 ====================
const db = new Database(path.join(__dirname, 'couple_space.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    file_url TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS diary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    mood TEXT DEFAULT '😊',
    image_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS album_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uploader_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploader_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    date TEXT NOT NULL,
    type TEXT DEFAULT 'anniversary',
    recurring INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  );
`);

// 预设两个用户（首次初始化时创建）
const initUsers = () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c === 0) {
    const hash = bcrypt.hashSync('123456', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)').run('boy', hash, '他');
    db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)').run('girl', hash, '她');
    console.log('✅ 初始账号已创建: boy / girl，默认密码: 123456');
  }
};
initUsers();

// ==================== 文件上传配置 ====================
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|mov|avi|pdf|doc|docx|xls|xlsx|txt|zip|rar)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'));
    }
  }
});

// ==================== JWT 中间件 ====================
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
};

// ==================== 认证 API ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ id: user.id, username: user.username, display_name: user.display_name }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, avatar: user.avatar } });
});

app.post('/api/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) return res.status(400).json({ error: '原密码错误' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true });
});

// ==================== 聊天 API ====================
app.get('/api/messages', authMiddleware, (req, res) => {
  const { before, limit = 50 } = req.query;
  let messages;
  if (before) {
    messages = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.id < ? ORDER BY m.id DESC LIMIT ?
    `).all(before, parseInt(limit));
  } else {
    messages = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      ORDER BY m.id DESC LIMIT ?
    `).all(parseInt(limit));
  }
  res.json(messages.reverse());
});

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  const url = `/uploads/${req.file.filename}`;
  res.json({
    url,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// ==================== 日记 API ====================
app.get('/api/diary', authMiddleware, (req, res) => {
  const entries = db.prepare(`
    SELECT d.*, u.display_name as author_name
    FROM diary_entries d JOIN users u ON d.author_id = u.id
    ORDER BY d.created_at DESC
  `).all();
  res.json(entries);
});

app.post('/api/diary', authMiddleware, (req, res) => {
  const { title, content, mood, image_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
  const result = db.prepare('INSERT INTO diary_entries (author_id, title, content, mood, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, title, content, mood || '😊', image_url || '');
  const entry = db.prepare('SELECT d.*, u.display_name as author_name FROM diary_entries d JOIN users u ON d.author_id = u.id WHERE d.id = ?').get(result.lastInsertRowid);
  res.json(entry);
});

app.put('/api/diary/:id', authMiddleware, (req, res) => {
  const { title, content, mood, image_url } = req.body;
  const entry = db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: '日记不存在' });
  db.prepare('UPDATE diary_entries SET title=?, content=?, mood=?, image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title, content, mood || '😊', image_url || '', req.params.id);
  const updated = db.prepare('SELECT d.*, u.display_name as author_name FROM diary_entries d JOIN users u ON d.author_id = u.id WHERE d.id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/diary/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM diary_entries WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== 相册 API ====================
app.get('/api/album', authMiddleware, (req, res) => {
  const photos = db.prepare(`
    SELECT a.*, u.display_name as uploader_name
    FROM album_photos a JOIN users u ON a.uploader_id = u.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(photos);
});

app.post('/api/album', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择照片' });
  const image_url = `/uploads/${req.file.filename}`;
  const caption = req.body.caption || '';
  const result = db.prepare('INSERT INTO album_photos (uploader_id, image_url, caption) VALUES (?, ?, ?)')
    .run(req.user.id, image_url, caption);
  const photo = db.prepare('SELECT a.*, u.display_name as uploader_name FROM album_photos a JOIN users u ON a.uploader_id = u.id WHERE a.id = ?').get(result.lastInsertRowid);
  res.json(photo);
});

app.delete('/api/album/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM album_photos WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== 纪念日 API ====================
app.get('/api/reminders', authMiddleware, (req, res) => {
  const reminders = db.prepare(`
    SELECT r.*, u.display_name as creator_name
    FROM reminders r JOIN users u ON r.creator_id = u.id
    ORDER BY r.date ASC
  `).all();

  // 计算倒计时
  const now = new Date();
  const enriched = reminders.map(r => {
    const target = new Date(r.date);
    // 如果是重复纪念日，计算今年的日期
    if (r.recurring) {
      target.setFullYear(now.getFullYear());
      if (target < now) target.setFullYear(now.getFullYear() + 1);
    }
    const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    return { ...r, countdown: diffDays };
  });

  res.json(enriched);
});

app.post('/api/reminders', authMiddleware, (req, res) => {
  const { title, description, date, type, recurring } = req.body;
  if (!title || !date) return res.status(400).json({ error: '标题和日期不能为空' });
  const result = db.prepare('INSERT INTO reminders (creator_id, title, description, date, type, recurring) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, title, description || '', date, type || 'anniversary', recurring !== undefined ? (recurring ? 1 : 0) : 1);
  const reminder = db.prepare('SELECT r.*, u.display_name as creator_name FROM reminders r JOIN users u ON r.creator_id = u.id WHERE r.id = ?').get(result.lastInsertRowid);
  res.json(reminder);
});

app.put('/api/reminders/:id', authMiddleware, (req, res) => {
  const { title, description, date, type, recurring } = req.body;
  db.prepare('UPDATE reminders SET title=?, description=?, date=?, type=?, recurring=? WHERE id=?')
    .run(title, description || '', date, type || 'anniversary', recurring ? 1 : 0, req.params.id);
  const reminder = db.prepare('SELECT r.*, u.display_name as creator_name FROM reminders r JOIN users u ON r.creator_id = u.id WHERE r.id = ?').get(req.params.id);
  res.json(reminder);
});

app.delete('/api/reminders/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== 用户信息 ====================
app.get('/api/partner', authMiddleware, (req, res) => {
  const partner = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE id != ?').get(req.user.id);
  res.json(partner);
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ==================== Socket.IO 实时聊天 ====================
const onlineUsers = new Map(); // socketId -> { userId, username, displayName }

io.on('connection', (socket) => {
  console.log(`🔌 新连接: ${socket.id}`);

  // 用户认证
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      onlineUsers.set(socket.id, {
        userId: decoded.id,
        username: decoded.username,
        displayName: decoded.display_name
      });
      socket.userId = decoded.id;
      console.log(`✅ 用户 ${decoded.display_name} 已上线`);
      io.emit('userOnline', { userId: decoded.id, displayName: decoded.display_name });
    } catch {
      socket.emit('authError', '认证失败');
    }
  });

  // 发送消息
  socket.on('sendMessage', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return socket.emit('authError', '请先登录');

    const { content, imageUrl, fileUrl, fileName } = data;
    const result = db.prepare('INSERT INTO messages (sender_id, content, image_url, file_url, file_name) VALUES (?, ?, ?, ?, ?)')
      .run(user.userId, content || '', imageUrl || '', fileUrl || '', fileName || '');

    const message = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(result.lastInsertRowid);

    io.emit('newMessage', message);
  });

  // 正在输入
  socket.on('typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.broadcast.emit('userTyping', { userId: user.userId, displayName: user.displayName });
  });

  socket.on('stopTyping', () => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.broadcast.emit('userStopTyping', { userId: user.userId });
  });

  // 断开连接
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      console.log(`👋 用户 ${user.displayName} 已下线`);
      io.emit('userOffline', { userId: user.userId, displayName: user.displayName });
    }
    onlineUsers.delete(socket.id);
  });
});

// ==================== 启动服务器 ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════╗
║     💑 Couple Space 情侣私密空间      ║
║     专属二人的私密聊天互动平台        ║
╠══════════════════════════════════════╣
║  服务地址: http://localhost:${PORT}     ║
║  初始账号: boy / girl                ║
║  初始密码: 123456                    ║
║  ⚠️  首次登录后请立即修改密码!        ║
╚══════════════════════════════════════╝
  `);
});
