import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Singleton document holding global event settings. */
const settingSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true },
    leaderboardRevealed: { type: Boolean, default: false },
    revealNames: { type: Boolean, default: false },
    minScores: { type: Number, default: 3 },
    submissionsOpen: { type: Boolean, default: true },
    theme: { type: String, default: 'Turning Imagination Into An Image' },
    winnerCount: { type: Number, default: 3 },
  },
  { timestamps: true }
);

export async function getSettings() {
  let doc = await Setting.findOne({ key: 'global' });
  if (!doc) doc = await Setting.create({ key: 'global' });
  return doc;
}

export const Setting = model('Setting', settingSchema);
export default Setting;
