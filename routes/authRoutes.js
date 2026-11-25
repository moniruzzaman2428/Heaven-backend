import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userPayload = (user, withToken = true) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  address: user.address,
  ...(withToken ? { token: generateToken(user._id) } : {}),
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide name, email and password' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please provide a valid email' });
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) return res.status(400).json({ message: 'User already exists' });

    // role কখনো body থেকে নেওয়া হয় না — নতুন ইউজার সবসময় 'user'
    const user = await User.create({ name, email, password, phone, lastLogin: new Date() });
    res.status(201).json(userPayload(user));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (user && (await user.comparePassword(password))) {
      if (user.isActive === false) {
        return res.status(403).json({ message: 'Your account has been blocked. Please contact support.' });
      }
      user.lastLogin = new Date();
      await user.save();
      res.json(userPayload(user));
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get profile
router.get('/profile', protect, async (req, res) => {
  res.json(userPayload(req.user, false));
});

// Update profile
router.put('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { name, email, phone, address, password, currentPassword } = req.body;

    if (email && email.toLowerCase() !== user.email) {
      if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please provide a valid email' });
      const taken = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
      if (taken) return res.status(400).json({ message: 'This email is already in use' });
      user.email = email;
    }
    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (address) user.address = { ...(user.address?.toObject?.() || {}), ...address };

    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters' });
      }
      if (!currentPassword || !(await user.comparePassword(currentPassword))) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      user.password = password;
    }

    const updated = await user.save();
    res.json(userPayload(updated));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
