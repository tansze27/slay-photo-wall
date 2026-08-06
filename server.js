const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 配置 Cloudinary（从环境变量读取）
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 设置上传存储为 Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'slay-photo-wall',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp']
  }
});

const upload = multer({ storage: storage });

const dataFile = path.join(__dirname, 'photos_data.json');

function loadData() {
  if (fs.existsSync(dataFile)) {
    try { return JSON.parse(fs.readFileSync(dataFile)); } catch(e) { return []; }
  }
  return [];
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 获取所有照片
app.get('/api/photos', (req, res) => {
  const photos = loadData();
  res.json(photos.sort((a, b) => b.time - a.time));
});

// 点赞
app.post('/api/photos/like', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false });

  const photos = loadData();
  const photo = photos.find(p => p.url === url);

  if (photo) {
    photo.likes = (photo.likes || 0) + 1;
    saveData(photos);
    io.emit('like-updated', { url, likes: photo.likes });
    return res.json({ success: true, likes: photo.likes });
  }

  res.status(404).json({ success: false });
});

// 上传照片到云端
app.post('/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false });

    const comment = req.body.comment || '';
    const now = Date.now();
    const photos = loadData();

    const photoData = {
      url: req.file.path, // Cloudinary 云端图片 URL
      public_id: req.file.filename,
      comment: comment,
      likes: 0,
      time: now,
      formattedTime: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    photos.unshift(photoData);
    saveData(photos);

    io.emit('new-photo', photoData);
    res.json({ success: true, photo: photoData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// 删除照片（同时从云端和数据表中移除）
app.post('/api/photos/delete', async (req, res) => {
  const { url, password } = req.body;
  const ADMIN_PASSWORD = '1234';

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '密码错误！' });
  }

  let photos = loadData();
  const targetPhoto = photos.find(p => p.url === url);

  if (targetPhoto && targetPhoto.public_id) {
    try {
      await cloudinary.uploader.destroy(targetPhoto.public_id);
    } catch (e) {
      console.error('Cloudinary delete error:', e);
    }
  }

  photos = photos.filter(p => p.url !== url);
  saveData(photos);

  io.emit('photo-deleted', url);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SLAY Photo Wall running on port ${PORT}`);
});