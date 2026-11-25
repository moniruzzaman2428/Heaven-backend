import express from 'express';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { protect, admin } from '../middleware/auth.js';
import { escapeRegex, slugify } from '../utils/helpers.js';

const router = express.Router();

// GET /api/categories?withCount=true
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().sort({ name: 1 }).lean();
    if (req.query.withCount === 'true') {
      const counts = await Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
      const map = Object.fromEntries(counts.map((c) => [String(c._id).toLowerCase(), c.count]));
      categories.forEach((c) => {
        c.productCount = map[c.name.toLowerCase()] || 0;
      });
    }
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get unique categories from products (fallback)
router.get('/from-products', async (req, res) => {
  try {
    const cats = await Product.distinct('category');
    res.json(cats.map((c, i) => ({ id: i + 1, category: c, slug: slugify(c) })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: create
router.post('/', protect, admin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Category name is required' });
    const dup = await Category.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (dup) return res.status(400).json({ message: 'Category already exists' });
    const category = await Category.create({
      name,
      slug: slugify(name) || `cat-${Date.now()}`,
      description: req.body.description,
      image: req.body.image,
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: update (নাম বদলালে ওই ক্যাটাগরির সব প্রডাক্টেও নাম বদলে যায়)
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });

    const oldName = category.name;
    const name = req.body.name !== undefined ? String(req.body.name).trim() : oldName;
    if (!name) return res.status(400).json({ message: 'Category name is required' });

    if (name.toLowerCase() !== oldName.toLowerCase()) {
      const dup = await Category.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i'), _id: { $ne: category._id } });
      if (dup) return res.status(400).json({ message: 'Another category with this name already exists' });
    }

    category.name = name;
    category.slug = slugify(name) || category.slug;
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.image !== undefined) category.image = req.body.image;
    await category.save();

    if (name !== oldName) {
      await Product.updateMany({ category: oldName }, { category: name });
    }
    res.json(category);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: delete (প্রডাক্ট থাকলে মুছতে দেয় না)
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    const used = await Product.countDocuments({ category: category.name });
    if (used > 0) {
      return res.status(400).json({
        message: `This category has ${used} product(s). Move or delete them first.`,
      });
    }
    await category.deleteOne();
    res.json({ message: 'Category removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
