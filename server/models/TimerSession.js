import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One timed challenge window per device.
 *
 * A participant presses "start", gets `challengeMinutes` to create the
 * artwork and upload it, and the session is consumed by the submission.
 * The server owns the deadline — clearing browser storage does not buy
 * extra time, and starting again while a session is still running is refused.
 */
const timerSessionSchema = new Schema(
  {
    deviceToken: { type: String, required: true, unique: true, index: true },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    submissions: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** Anything never used is just clutter — sessions are short-lived. */
timerSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const TimerSession = model('TimerSession', timerSessionSchema);
export default TimerSession;
