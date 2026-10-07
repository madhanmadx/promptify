import mongoose from 'mongoose';
import { artUrl } from '../config.js';

const { Schema, model } = mongoose;

/** Submission statuses used across the whole event pipeline. */
export const STATUS = {
  SUBMITTED: 'submitted',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  JUDGING_COMPLETED: 'judging_completed',
  FINALIST: 'finalist',
};

const submissionSchema = new Schema(
  {
    submissionId: { type: String, required: true, unique: true, index: true },
    checkToken: { type: String, required: true, index: true },
    // browser that sent the entry — used to enforce one entry per participant
    deviceToken: { type: String, default: '', index: true },

    // ---- Step 1 : participant details ----
    fullName: { type: String, required: true, trim: true },
    college: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    year: { type: String, required: true, enum: ['1st', '2nd', '3rd', '4th'] },
    participation: { type: String, enum: ['individual', 'team'], default: 'individual' },
    teamName: { type: String, trim: true, default: '' },
    teamMembers: { type: [String], default: [] },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },

    // ---- Step 3 : the creation ----
    title: { type: String, required: true, trim: true },
    aiTool: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
    concept: { type: String, required: true, trim: true },
    theme: { type: String, trim: true, default: '' },

    // ---- Step 2 : the artwork (stored as a Buffer, served via /api/artwork/:id) ----
    artwork: {
      data: { type: Buffer, required: true },
      contentType: { type: String, required: true },
      filename: { type: String, default: 'artwork' },
      size: { type: Number, required: true },
    },

    // ---- workflow ----
    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.SUBMITTED,
      index: true,
    },
    flags: { type: [String], default: [] }, // prompt-mismatch | duplicate | stock-image | low-effort
    organizerNotes: { type: String, default: '' },
    isFinalist: { type: Boolean, default: false },
    finalistRank: { type: Number, default: 0 },
    award: { type: String, default: '' }, // Winner / Runner-up / ...

    verifiedAt: Date,
    rejectedAt: Date,

    // ---- the 30-minute challenge window this entry was made in ----
    // stamped when the participant pressed Start (empty for seeded/imported rows)
    challengeStartedAt: Date,
    challengeEndsAt: Date,
    challengeMinutes: Number,
  },
  { timestamps: true }
);

submissionSchema.index({ status: 1, createdAt: -1 });
submissionSchema.index({ title: 'text', fullName: 'text', college: 'text' });

/** Full detail — never expose the raw image buffer through JSON. */
submissionSchema.methods.toPublic = function () {
  const doc = this.toObject({ flattenObjectIds: true, versionKey: false });
  delete doc.artwork;
  delete doc.checkToken;
  delete doc.deviceToken;
  return {
    ...doc,
    artworkUrl: artUrl(`${this.submissionId}`),
    artworkSize: this.artwork?.size ?? 0,
    artworkType: this.artwork?.contentType ?? '',
  };
};

/** What a judge is allowed to see — identity is hidden for fair scoring. */
submissionSchema.methods.toAnonymised = function (extra = {}) {
  const doc = this.toObject({ flattenObjectIds: true, versionKey: false });
  return {
    submissionId: doc.submissionId,
    title: doc.title,
    aiTool: doc.aiTool,
    prompt: doc.prompt,
    concept: doc.concept,
    theme: doc.theme,
    status: doc.status,
    flags: doc.flags,
    artworkUrl: artUrl(`${doc.submissionId}`),
    createdAt: doc.createdAt,
    ...extra,
  };
};

export const Submission = model('Submission', submissionSchema);
export default Submission;
