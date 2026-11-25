import Review from '../models/Review.js';
import Product from '../models/Product.js';

// রিভিউ যোগ/মোছার পর প্রডাক্টের গড় রেটিং ও রিভিউ সংখ্যা নতুন করে হিসাব করে
export const updateProductRating = async (productId) => {
  const [stats] = await Review.aggregate([
    { $match: { product: productId } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.findByIdAndUpdate(productId, {
    rating: stats ? Number(stats.avg.toFixed(1)) : 0,
    numReviews: stats ? stats.count : 0,
  });
};
