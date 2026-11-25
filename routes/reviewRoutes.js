import express from 'express';
import Review from '../models/Review.js';
import { protect } from '../middleware/auth.js';
import { findProductByAnyId } from '../utils/helpers.js';
import { updateProductRating } from '../utils/rating.js';

const router = express.Router();

// GET /api/reviews/product/:id
router.get('/product/:id', async (req, res) => {
  try {
    const product = await findProductByAnyId(req.params.id);
    if (!product) return res.json([]);
    const reviews = await Review.find({ product: product._id }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/reviews/product/:id  — নতুন রিভিউ দেয় বা নিজের আগের রিভিউ আপডেট করে
router.post('/product/:id', protect, async (req, res) => {
  try {
    const product = await findProductByAnyId(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }
    if (!comment) return res.status(400).json({ message: 'Please write a short comment' });

    const review = await Review.findOneAndUpdate(
      { product: product._id, user: req.user._id },
      { rating, comment, name: req.user.name },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await updateProductRating(product._id);
    res.status(201).json(review);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE /api/reviews/:id — রিভিউয়ের মালিক অথবা অ্যাডমিন
router.delete('/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });
    const isOwner = review.user.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await review.deleteOne();
    await updateProductRating(review.product);
    res.json({ message: 'Review removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
