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
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'SLAY-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API：获取所有照片
app.get('/api/photos', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.json([]);
    
    const photos = files
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .map(file => ({
        url: `/uploads/${file}`,
        time: fs.statSync(path.join(uploadDir, file)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    res.json(photos);
  });
});

// API：照片上传
app.post('/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择照片' });
    }

    const photoData = {
      url: `/uploads/${req.file.filename}`,
      time: Date.now()
    };

    io.emit('new-photo', photoData);
    res.json({ success: true, photo: photoData });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// API：删除照片接口
app.post('/api/photos/delete', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false });

  const filename = path.basename(url);
  const filePath = path.join(uploadDir, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('删除文件失败:', err);
      return res.status(500).json({ success: false });
    }
    // 即时通知所有人与大屏移除该照片
    io.emit('photo-deleted', url);
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SLAY Photo Wall 运行于: http://localhost:${PORT}`);
});