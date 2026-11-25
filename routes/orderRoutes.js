import express from 'express';
import Order, { ORDER_STATUSES } from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { protect, admin } from '../middleware/auth.js';
import { escapeRegex, findProductByAnyId, generateOrderNumber, toPositiveInt } from '../utils/helpers.js';

const router = express.Router();

const PAYMENT_METHODS = ['Cash on Delivery'];

// ---------- স্টক হেল্পার ----------
const restoreStock = async (items) => {
  for (const it of items) {
    await Product.updateOne({ _id: it.product }, { $inc: { stock: it.quantity } });
    await Product.updateOne({ _id: it.product, stock: { $gt: 0 } }, { availability: true });
  }
};

// ---------- Create order ----------
router.post('/', protect, async (req, res) => {
  const reserved = []; // স্টক কেটে নেওয়া আইটেমগুলো — কোথাও ফেল করলে ফেরত দেওয়ার জন্য
  try {
    const { orderItems, shippingAddress, paymentMethod } = req.body;
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({ message: 'No order items' });
    }
    const addr = shippingAddress || {};
    if (!addr.street || !addr.city || !addr.phone || !addr.country) {
      return res.status(400).json({ message: 'Shipping address (street, city, phone, country) is required' });
    }
    const payment = paymentMethod || 'Cash on Delivery';
    if (!PAYMENT_METHODS.includes(payment)) {
      return res.status(400).json({ message: 'Unsupported payment method' });
    }

    // একই প্রডাক্ট একাধিকবার থাকলে একত্র করে নেওয়া হয়
    const merged = new Map();
    for (const item of orderItems) {
      const qty = parseInt(item.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({ message: 'Invalid quantity' });
      }
      const product = await findProductByAnyId(item.product);
      if (!product) return res.status(404).json({ message: `Product not found: ${item.product}` });
      const key = product._id.toString();
      if (merged.has(key)) merged.get(key).quantity += qty;
      else merged.set(key, { product, quantity: qty });
    }

    // দাম সবসময় সার্ভার থেকে — ক্লায়েন্টের দেওয়া দাম বিশ্বাস করা হয় না
    let itemsPrice = 0;
    const populatedItems = [];
    for (const { product, quantity } of merged.values()) {
      // স্টক ঠিকঠাক থাকলে atomic ভাবে কমানো হয়, যাতে দুজন একসাথে শেষ আইটেম কিনতে না পারে
      const updated = await Product.findOneAndUpdate(
        { _id: product._id, availability: true, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true }
      );
      if (!updated) {
        await restoreStock(reserved);
        return res.status(400).json({ message: `Insufficient stock for ${product.product_title}` });
      }
      reserved.push({ product: product._id, quantity });
      if (updated.stock <= 0) await Product.updateOne({ _id: product._id }, { availability: false });

      itemsPrice += product.price * quantity;
      populatedItems.push({
        product: product._id,
        product_title: product.product_title,
        product_image: product.product_image,
        price: product.price,
        quantity,
      });
    }
    itemsPrice = Number(itemsPrice.toFixed(2));

    const shippingPrice = itemsPrice > 500 ? 0 : 50;
    const taxPrice = Number((itemsPrice * 0.05).toFixed(2));
    const totalPrice = Number((itemsPrice + shippingPrice + taxPrice).toFixed(2));

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      user: req.user._id,
      orderItems: populatedItems,
      shippingAddress: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        country: addr.country,
        phone: addr.phone,
      },
      paymentMethod: payment,
      itemsPrice,
      shippingPrice,
      taxPrice,
      totalPrice,
      statusHistory: [{ status: 'Pending', note: 'Order placed' }],
    });

    res.status(201).json(order);
  } catch (error) {
    await restoreStock(reserved).catch(() => {});
    res.status(500).json({ message: error.message });
  }
});

// ---------- My orders ----------
router.get('/myorders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------- Admin: all orders (filter + search + pagination) ----------
router.get('/', protect, admin, async (req, res) => {
  try {
    const { status, search, paid } = req.query;
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 10), 100);
    const query = {};

    if (status && ORDER_STATUSES.includes(status)) query.status = status;
    if (paid === 'true') query.isPaid = true;
    if (paid === 'false') query.isPaid = false;

    if (search && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), 'i');
      const users = await User.find({ $or: [{ name: rx }, { email: rx }] }).select('_id');
      query.$or = [
        { orderNumber: rx },
        { 'shippingAddress.phone': rx },
        { user: { $in: users.map((u) => u._id) } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    res.json({ orders, page, pages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------- Get order by id ----------
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const ownerId = order.user?._id?.toString();
    if (ownerId !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    res.json(order);
  } catch (error) {
    res.status(404).json({ message: 'Order not found' });
  }
});

// ---------- User: cancel own order (শুধু Pending থাকলে) ----------
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (order.status !== 'Pending') {
      return res.status(400).json({ message: 'Only pending orders can be cancelled. Please contact support.' });
    }
    await restoreStock(order.orderItems);
    order.status = 'Cancelled';
    order.cancelledAt = new Date();
    order.statusHistory.push({ status: 'Cancelled', note: 'Cancelled by customer' });
    await order.save();
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------- Admin: update status ----------
router.put('/:id/status', protect, admin, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${ORDER_STATUSES.join(', ')}` });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status === status) return res.json(order);
    if (order.status === 'Cancelled') {
      return res.status(400).json({ message: 'Cancelled orders cannot be changed' });
    }
    if (order.status === 'Delivered') {
      return res.status(400).json({ message: 'Delivered orders cannot be changed' });
    }

    if (status === 'Cancelled') {
      await restoreStock(order.orderItems);
      order.cancelledAt = new Date();
    }
    if (status === 'Delivered') {
      order.isDelivered = true;
      order.deliveredAt = new Date();
      // Cash on Delivery: ডেলিভারির সময়ই টাকা পাওয়া যায়
      if (!order.isPaid) {
        order.isPaid = true;
        order.paidAt = new Date();
      }
    }
    order.status = status;
    order.statusHistory.push({ status, note: note || `Status changed to ${status}` });
    await order.save();

    const populated = await order.populate('user', 'name email phone');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------- Admin: mark paid / unpaid ----------
router.put('/:id/pay', protect, admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'Cancelled') {
      return res.status(400).json({ message: 'Cannot change payment of a cancelled order' });
    }
    const isPaid = req.body.isPaid === undefined ? !order.isPaid : !!req.body.isPaid;
    order.isPaid = isPaid;
    order.paidAt = isPaid ? new Date() : undefined;
    await order.save();
    const populated = await order.populate('user', 'name email phone');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------- Admin: delete order ----------
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    // চলমান অর্ডার মুছলে স্টক ফেরত যায়; ডেলিভারড/ক্যান্সেলড অর্ডারে স্টক অপরিবর্তিত
    if (!['Cancelled', 'Delivered'].includes(order.status)) {
      await restoreStock(order.orderItems);
    }
    await order.deleteOne();
    res.json({ message: 'Order removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
