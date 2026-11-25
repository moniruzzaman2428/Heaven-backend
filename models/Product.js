import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    product_id: { type: String, required: true, unique: true, trim: true },
    product_title: { type: String, required: true, trim: true },
    product_image: { type: String, required: true },
    category: { type: String, required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, required: true },
    Specification: { type: [String], default: [] },
    availability: { type: Boolean, default: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    numReviews: { type: Number, default: 0 },
    brand: { type: String, trim: true },
    warranty: { type: String, trim: true },
    color: { type: String, trim: true },
    stock: { type: Number, default: 50, min: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
