import Product from '../models/Product.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export const isObjectId = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v);

// Regex special character escape (search/category ফিল্টারে injection ঠেকাতে)
export const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// _id অথবা product_id দুটোর যেকোনোটা দিয়ে প্রডাক্ট খুঁজে বের করে
export const findProductByAnyId = async (id) => {
  if (!id) return null;
  const key = String(id);
  if (isObjectId(key)) {
    const byId = await Product.findById(key);
    if (byId) return byId;
  }
  return Product.findOne({ product_id: key });
};

export const slugify = (s = '') =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const toPositiveInt = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const generateOrderNumber = () =>
  `GH-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
