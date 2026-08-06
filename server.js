const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'public', 'uploads');
const dataFile = path.join(__dirname, 'photos_data.json');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 读取/保存数据（留言与点赞数）
function loadData() {
  if (fs.existsSync(dataFile)) {
    try { return JSON.parse(fs.readFileSync(dataFile)); } catch(e) { return {}; }
  }
  return {};
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'SLAY-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 获取所有照片数据（含点赞量与时间）
app.get('/api/photos', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.json([]);
    const db = loadData();
    
    const photos = files
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .map(file => {
        const itemData = db[file] || {};
        const stat = fs.statSync(path.join(uploadDir, file));
        return {
          url: `/uploads/${file}`,
          comment: itemData.comment || '',
          likes: itemData.likes || 0,
          time: stat.mtimeMs,
          formattedTime: new Date(stat.mtimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      })
      .sort((a, b) => b.time - a.time);

    res.json(photos);
  });
});

// 点赞接口
app.post('/api/photos/like', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false });

  const filename = path.basename(url);
  const db = loadData();

  if (!db[filename]) db[filename] = {};
  db[filename].likes = (db[filename].likes || 0) + 1;

  saveData(db);

  // 实时向所有人与大屏广播最新点赞数据
  io.emit('like-updated', { url, likes: db[filename].likes });
  res.json({ success: true, likes: db[filename].likes });
});

// 上传接口
app.post('/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false });

    const comment = req.body.comment || '';
    const db = loadData();
    db[req.file.filename] = { comment, likes: 0 };
    saveData(db);

    const photoData = {
      url: `/uploads/${req.file.filename}`,
      comment: comment,
      likes: 0,
      time: Date.now(),
      formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.emit('new-photo', photoData);
    res.json({ success: true, photo: photoData });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 带密码删除接口
app.post('/api/photos/delete', (req, res) => {
  const { url, password } = req.body;
  const ADMIN_PASSWORD = '1234'; // 默认密码

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '密码错误，无权删除！' });
  }

  if (!url) return res.status(400).json({ success: false, message: '无效路径' });

  const filename = path.basename(url);
  const filePath = path.join(uploadDir, filename);

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ success: false });
    
    // 清除 json 记录
    const db = loadData();
    delete db[filename];
    saveData(db);

    io.emit('photo-deleted', url);
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SLAY Photo Wall running on port ${PORT}`);
});