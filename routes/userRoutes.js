import express from 'express';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Review from '../models/Review.js';
import { protect, admin } from '../middleware/auth.js';
import { escapeRegex, isObjectId, toPositiveInt } from '../utils/helpers.js';
import { updateProductRating } from '../utils/rating.js';

const router = express.Router();
router.use(protect, admin); // এই ফাইলের সব রাউট শুধু অ্যাডমিনের জন্য

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// শেষ সক্রিয় অ্যাডমিনকে নামানো/ব্লক/ডিলিট করা ঠেকায়
const isLastActiveAdmin = async (user) => {
  if (user.role !== 'admin' || user.isActive === false) return false;
  const others = await User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: user._id } });
  return others === 0;
};

// GET /api/users?search=&role=&status=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const { search, role, status } = req.query;
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 10), 100);
    const query = {};

    if (role === 'user' || role === 'admin') query.role = role;
    if (status === 'active') query.isActive = { $ne: false };
    if (status === 'blocked') query.isActive = false;
    if (search && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), 'i');
      query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(query).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    // প্রতিটি ইউজারের অর্ডার সংখ্যা ও মোট খরচ
    const stats = await Order.aggregate([
      { $match: { user: { $in: users.map((u) => u._id) }, status: { $ne: 'Cancelled' } } },
      { $group: { _id: '$user', orders: { $sum: 1 }, spent: { $sum: '$totalPrice' } } },
    ]);
    const statMap = Object.fromEntries(stats.map((s) => [s._id.toString(), s]));
    users.forEach((u) => {
      const s = statMap[u._id.toString()];
      u.orderCount = s?.orders || 0;
      u.totalSpent = Number((s?.spent || 0).toFixed(2));
    });

    res.json({ users, page, pages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/:id — প্রোফাইল + অর্ডার হিস্টোরি
router.get('/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(20);
    res.json({ user, orders });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users — অ্যাডমিন নতুন ইউজার/অ্যাডমিন বানাতে পারবে
router.post('/', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please provide a valid email' });
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (await User.findOne({ email: String(email).toLowerCase() })) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: role === 'admin' ? 'admin' : 'user',
    });
    const { password: _pw, ...safe } = user.toObject();
    res.status(201).json(safe);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT /api/users/:id — নাম, ফোন, রোল, ব্লক/আনব্লক, পাসওয়ার্ড রিসেট
router.put('/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isSelf = user._id.toString() === req.user._id.toString();
    const { name, email, phone, role, isActive, password, address } = req.body;

    if (role !== undefined && role !== user.role) {
      if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
      if (isSelf) return res.status(400).json({ message: "You can't change your own role" });
      if (role === 'user' && (await isLastActiveAdmin(user))) {
        return res.status(400).json({ message: 'At least one active admin is required' });
      }
      user.role = role;
    }
    if (isActive !== undefined && !!isActive !== user.isActive) {
      if (isSelf) return res.status(400).json({ message: "You can't block your own account" });
      if (!isActive && (await isLastActiveAdmin(user))) {
        return res.status(400).json({ message: 'At least one active admin is required' });
      }
      user.isActive = !!isActive;
    }
    if (email && email.toLowerCase() !== user.email) {
      if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please provide a valid email' });
      if (await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } })) {
        return res.status(400).json({ message: 'This email is already in use' });
      }
      user.email = email;
    }
    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (address) user.address = { ...(user.address?.toObject?.() || {}), ...address };
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      user.password = password;
    }

    await user.save();
    const { password: _pw, ...safe } = user.toObject();
    res.json(safe);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You can't delete your own account" });
    }
    if (await isLastActiveAdmin(user)) {
      return res.status(400).json({ message: 'At least one active admin is required' });
    }

    // ইউজারের রিভিউ মুছে সংশ্লিষ্ট প্রডাক্টের রেটিং আবার হিসাব করা হয়। অর্ডারগুলো রেকর্ডের জন্য থেকে যায়।
    const reviews = await Review.find({ user: user._id }).select('product');
    await Review.deleteMany({ user: user._id });
    const productIds = new Map(reviews.map((r) => [r.product.toString(), r.product]));
    for (const pid of productIds.values()) await updateProductRating(pid);

    await user.deleteOne();
    res.json({ message: 'User removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
