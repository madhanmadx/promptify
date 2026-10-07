import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Atomic sequence generator, so IDs always read PF-2026-001, 002, 003 … */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model('Counter', counterSchema);

export async function nextSequence(name) {
  const doc = await Counter.findByIdAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

export default Counter;
