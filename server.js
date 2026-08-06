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

// 读取/保存留言数据
function loadComments() {
  if (fs.existsSync(dataFile)) {
    try { return JSON.parse(fs.readFileSync(dataFile)); } catch(e) { return {}; }
  }
  return {};
}

function saveComment(filename, comment) {
  const comments = loadComments();
  comments[filename] = comment;
  fs.writeFileSync(dataFile, JSON.stringify(comments, null, 2));
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

app.get('/api/photos', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.json([]);
    const comments = loadComments();
    
    const photos = files
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .map(file => ({
        url: `/uploads/${file}`,
        comment: comments[file] || '',
        time: fs.statSync(path.join(uploadDir, file)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    res.json(photos);
  });
});

app.post('/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false });

    const comment = req.body.comment || '';
    if (comment) {
      saveComment(req.file.filename, comment);
    }

    const photoData = {
      url: `/uploads/${req.file.filename}`,
      comment: comment,
      time: Date.now()
    };

    io.emit('new-photo', photoData);
    res.json({ success: true, photo: photoData });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// API：删除照片接口（带密码验证）
app.post('/api/photos/delete', (req, res) => {
  const { url, password } = req.body;

  // 设置你的管理员密码（可在此随意修改）
  const ADMIN_PASSWORD = '1234';

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '密码错误，无权删除！' });
  }

  if (!url) return res.status(400).json({ success: false, message: '无效的照片路径' });

  const filename = path.basename(url);
  const filePath = path.join(uploadDir, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('删除文件失败:', err);
      return res.status(500).json({ success: false, message: '删除文件失败' });
    }
    // 即时通知所有人与大屏移除该照片
    io.emit('photo-deleted', url);
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SLAY Photo Wall running on port ${PORT}`);
});