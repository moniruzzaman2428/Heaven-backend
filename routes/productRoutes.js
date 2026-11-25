import express from 'express';
import Product from '../models/Product.js';
import Review from '../models/Review.js';
import { protect, admin } from '../middleware/auth.js';
import { escapeRegex, findProductByAnyId, toPositiveInt } from '../utils/helpers.js';

const router = express.Router();

// অ্যাডমিন ফর্ম থেকে আসা ডাটা পরিষ্কার করে — শুধু অনুমোদিত ফিল্ড নেয়
const parseProductBody = (b, creating = false) => {
  const out = {};
  ['product_title', 'product_image', 'category', 'description', 'brand', 'warranty', 'color'].forEach((k) => {
    if (b[k] !== undefined) out[k] = String(b[k]).trim();
  });
  if (b.price !== undefined) out.price = Number(b.price);
  if (b.stock !== undefined) out.stock = Math.max(0, Math.floor(Number(b.stock)));
  if (b.availability !== undefined) out.availability = b.availability === true || b.availability === 'true';
  if (b.Specification !== undefined) {
    const raw = Array.isArray(b.Specification) ? b.Specification : String(b.Specification).split('\n');
    out.Specification = raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (creating) {
    if (b.product_id) out.product_id = String(b.product_id).trim();
    if (b.rating !== undefined && b.rating !== '') out.rating = Math.min(5, Math.max(0, Number(b.rating)));
  }
  // স্টক বদলালে এবং availability আলাদা করে না দিলে, স্টক অনুযায়ী availability ঠিক করে দেয়
  if (out.stock !== undefined && out.availability === undefined) out.availability = out.stock > 0;
  return out;
};

const validateNumbers = (data) => {
  if (data.price !== undefined && (!Number.isFinite(data.price) || data.price < 0)) return 'Price must be a valid number';
  if (data.stock !== undefined && !Number.isFinite(data.stock)) return 'Stock must be a valid number';
  return null;
};

// GET /api/products - list with filters, search, pagination
router.get('/', async (req, res) => {
  try {
    const { category, search, brand, minPrice, maxPrice, sort, stock } = req.query;
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 12), 100);
    const query = {};

    if (category && category !== 'All Products' && category !== 'all') {
      query.category = { $regex: new RegExp(`^${escapeRegex(category)}$`, 'i') };
    }
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ product_title: rx }, { description: rx }, { brand: rx }, { product_id: rx }];
    }
    if (brand) query.brand = { $regex: new RegExp(escapeRegex(brand), 'i') };
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    // অ্যাডমিনের জন্য স্টক ফিল্টার: low (০–১০, স্টক শেষও ধরে) / out (শুধু ০)
    if (stock === 'low') query.stock = { $lte: 10 };
    if (stock === 'out') query.stock = { $lte: 0 };

    let sortOption = { createdAt: -1 };
    if (sort === 'price-asc') sortOption = { price: 1 };
    if (sort === 'price-desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { rating: -1 };
    if (sort === 'name') sortOption = { product_title: 1 };
    if (sort === 'stock-asc') sortOption = { stock: 1 };

    const skip = (page - 1) * limit;
    const [products, total] = await Promise.all([
      Product.find(query).sort(sortOption).skip(skip).limit(limit),
      Product.countDocuments(query),
    ]);

    res.json({ products, page, pages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/products/:id  (_id অথবা product_id)
router.get('/:id', async (req, res) => {
  try {
    const product = await findProductByAnyId(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: create
router.post('/', protect, admin, async (req, res) => {
  try {
    const data = parseProductBody(req.body, true);
    const numErr = validateNumbers(data);
    if (numErr) return res.status(400).json({ message: numErr });

    if (!data.product_id) data.product_id = `P${Date.now().toString(36).toUpperCase()}`;
    if (await Product.exists({ product_id: data.product_id })) {
      return res.status(400).json({ message: `Product ID "${data.product_id}" already exists` });
    }
    const product = await Product.create(data);
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: update
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const existing = await findProductByAnyId(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Product not found' });

    const data = parseProductBody(req.body, false);
    const numErr = validateNumbers(data);
    if (numErr) return res.status(400).json({ message: numErr });

    const product = await Product.findByIdAndUpdate(existing._id, data, { new: true, runValidators: true });
    res.json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: delete
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const existing = await findProductByAnyId(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Product not found' });
    await Review.deleteMany({ product: existing._id });
    await existing.deleteOne();
    res.json({ message: 'Product removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
