import express from 'express';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, admin);

const TZ = process.env.TIMEZONE || 'Asia/Dhaka';

// GET /api/admin/stats?days=14
router.get('/stats', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 90);
    const DAY = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - (days + 1) * DAY);
    const monthAgo = new Date(Date.now() - 30 * DAY);
    const notCancelled = { status: { $ne: 'Cancelled' } };

    const [
      totalUsers,
      newUsers,
      totalProducts,
      totalOrders,
      revenueAgg,
      statusAgg,
      salesAgg,
      topProducts,
      lowStock,
      recentOrders,
      categoryAgg,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: monthAgo } }),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([
        { $match: notCancelled },
        { $group: { _id: null, revenue: { $sum: '$totalPrice' }, paid: { $sum: { $cond: ['$isPaid', '$totalPrice', 0] } } } },
      ]),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { createdAt: { $gte: since }, ...notCancelled } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
            revenue: { $sum: '$totalPrice' },
            orders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: notCancelled },
        { $unwind: '$orderItems' },
        {
          $group: {
            _id: '$orderItems.product',
            title: { $first: '$orderItems.product_title' },
            image: { $first: '$orderItems.product_image' },
            sold: { $sum: '$orderItems.quantity' },
            revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
          },
        },
        { $sort: { sold: -1 } },
        { $limit: 5 },
      ]),
      Product.find({ stock: { $lte: 10 } }).sort({ stock: 1 }).limit(8).select('product_title product_image stock category product_id'),
      Order.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(6),
      Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    // দিনের হিসাবে খালি দিনগুলোতে 0 বসিয়ে ধারাবাহিক সিরিজ বানানো
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
    const salesMap = Object.fromEntries(salesAgg.map((s) => [s._id, s]));
    const salesByDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = fmt.format(new Date(Date.now() - i * DAY));
      salesByDay.push({
        date: key,
        revenue: Number((salesMap[key]?.revenue || 0).toFixed(2)),
        orders: salesMap[key]?.orders || 0,
      });
    }

    const ordersByStatus = Object.fromEntries(statusAgg.map((s) => [s._id, s.count]));

    res.json({
      totals: {
        users: totalUsers,
        newUsers,
        products: totalProducts,
        orders: totalOrders,
        revenue: Number((revenueAgg[0]?.revenue || 0).toFixed(2)),
        paidRevenue: Number((revenueAgg[0]?.paid || 0).toFixed(2)),
        pendingOrders: ordersByStatus.Pending || 0,
      },
      ordersByStatus,
      salesByDay,
      topProducts,
      lowStock,
      recentOrders,
      productsByCategory: categoryAgg.map((c) => ({ category: c._id, count: c.count })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
