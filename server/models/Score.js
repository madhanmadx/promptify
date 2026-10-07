import mongoose from 'mongoose';
import { config, scoringTotal } from '../config.js';

const { Schema, model } = mongoose;

const scoreShape = {};
for (const cat of config.scoring) {
  scoreShape[cat.key] = { type: Number, min: 0, max: cat.max, required: true };
}

const scoreSchema = new Schema(
  {
    submission: { type: Schema.Types.ObjectId, ref: 'Submission', required: true },
    submissionId: { type: String, required: true, index: true },
    judge: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    judgeName: { type: String, default: '' },
    scores: { type: scoreShape, required: true },
    total: { type: Number, min: 0, max: scoringTotal, required: true },
    comment: { type: String, default: '' },
  },
  { timestamps: true }
);

scoreSchema.index({ submission: 1, judge: 1 }, { unique: true });

export const Score = model('Score', scoreSchema);
export default Score;
