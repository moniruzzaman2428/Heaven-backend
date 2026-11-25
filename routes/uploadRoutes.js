import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Admin: ছবি আপলোড → { url: '/uploads/xxx.jpg' }
router.post('/', protect, admin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image file received' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default router;
