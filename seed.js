import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Product from './models/Product.js';
import Category from './models/Category.js';
import User from './models/User.js';
import Order from './models/Order.js';
import Review from './models/Review.js';
import { generateOrderNumber } from './utils/helpers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productsPath = path.join(__dirname, '../frontend/public/product.json');
const categoriesPath = path.join(__dirname, '../frontend/public/categories.json');

const DAY = 24 * 60 * 60 * 1000;

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected for seeding...');

    // Clear existing
    await Promise.all([
      Product.deleteMany({}),
      Category.deleteMany({}),
      User.deleteMany({}),
      Order.deleteMany({}),
      Review.deleteMany({}),
    ]);

    // Categories
    const catData = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
    const categories = catData
      .filter((c) => c.category !== 'All Products')
      .map((c) => ({ name: c.category, slug: c.slug }));
    await Category.insertMany(categories);
    console.log(`Seeded ${categories.length} categories`);

    // Products
    const prodData = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    const products = prodData.map((p) => ({
      ...p,
      stock: Math.floor(Math.random() * 80) + 10,
    }));
    const createdProducts = await Product.insertMany(products);
    console.log(`Seeded ${createdProducts.length} products`);

    // Users
    await User.create({
      name: 'Admin',
      email: 'admin@gadgetheaven.com',
      password: 'admin123',
      role: 'admin',
      phone: '01700000000',
    });
    const demo = await User.create({
      name: 'Demo User',
      email: 'user@gadgetheaven.com',
      password: 'user123',
      role: 'user',
      phone: '01800000000',
      address: { street: 'House 12, Road 3', city: 'Mymensingh', state: 'Mymensingh', zip: '2200', country: 'Bangladesh' },
    });
    const extra = await User.create([
      { name: 'Rahim Uddin', email: 'rahim@example.com', password: 'user123', phone: '01711111111' },
      { name: 'Karima Akter', email: 'karima@example.com', password: 'user123', phone: '01922222222' },
      { name: 'Blocked Sample', email: 'blocked@example.com', password: 'user123', isActive: false },
    ]);
    console.log('Seeded admin, demo user and sample users');

    // Sample orders — অ্যাডমিন ড্যাশবোর্ড চার্টে ডাটা দেখানোর জন্য
    const buyers = [demo, extra[0], extra[1]];
    const statuses = ['Delivered', 'Delivered', 'Delivered', 'Shipped', 'Processing', 'Pending', 'Cancelled', 'Delivered'];
    for (let i = 0; i < 16; i++) {
      const buyer = buyers[i % buyers.length];
      const status = statuses[i % statuses.length];
      const picked = [createdProducts[(i * 3) % createdProducts.length], createdProducts[(i * 5 + 1) % createdProducts.length]];
      const unique = [...new Map(picked.map((p) => [p._id.toString(), p])).values()];
      const items = unique.map((p, idx) => ({
        product: p._id,
        product_title: p.product_title,
        product_image: p.product_image,
        price: p.price,
        quantity: idx + 1,
      }));
      const itemsPrice = Number(items.reduce((s, it) => s + it.price * it.quantity, 0).toFixed(2));
      const shippingPrice = itemsPrice > 500 ? 0 : 50;
      const taxPrice = Number((itemsPrice * 0.05).toFixed(2));
      const createdAt = new Date(Date.now() - (i % 14) * DAY - Math.floor(Math.random() * 6) * 3600 * 1000);
      await Order.create({
        orderNumber: generateOrderNumber(),
        user: buyer._id,
        orderItems: items,
        shippingAddress: {
          street: buyer.address?.street || 'Sample Road',
          city: buyer.address?.city || 'Dhaka',
          state: buyer.address?.state,
          zip: buyer.address?.zip,
          country: 'Bangladesh',
          phone: buyer.phone || '01700000000',
        },
        itemsPrice,
        shippingPrice,
        taxPrice,
        totalPrice: Number((itemsPrice + shippingPrice + taxPrice).toFixed(2)),
        status,
        isDelivered: status === 'Delivered',
        deliveredAt: status === 'Delivered' ? createdAt : undefined,
        isPaid: status === 'Delivered',
        paidAt: status === 'Delivered' ? createdAt : undefined,
        cancelledAt: status === 'Cancelled' ? createdAt : undefined,
        statusHistory: [{ status: 'Pending', note: 'Order placed', at: createdAt }, ...(status !== 'Pending' ? [{ status, at: createdAt }] : [])],
        createdAt,
      });
    }
    console.log('Seeded sample orders');

    console.log('\n✅ Seeding completed successfully!');
    console.log('   Admin: admin@gadgetheaven.com / admin123');
    console.log('   User : user@gadgetheaven.com / user123');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
