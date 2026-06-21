import mongoose from "mongoose";

// Loose document type: keeps property access permissive while giving the model
// a concrete generic so `findById().lean()` resolves to a single document
// instead of mongoose's broken `Doc[] | Doc` overload union. `_id` is typed
// `any` (not Document's `unknown`) so `_id.toString()` stays valid.
export interface IUser {
  _id: any;
  [key: string]: any;
}

const NotificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    link: {
      type: String,
      trim: true,
    },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name."],
      trim: true,
    },
    fullName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: [/.+\@.+\..+/, "Please fill a valid email address"],
    },
    password: {
      type: String,
      minlength: 8,
    },
    phoneNumber: {
      type: String,
      sparse: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    bio: {
      type: String,
      trim: true,
      default: null,
    },
    privyUserId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    walletaddress: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    walletAddress: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["driver", "investor", "admin"],
      required: [true, "Please specify a role."],
      default: "investor",
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalInvested: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalReturns: {
      type: Number,
      default: 0,
      min: 0,
    },
    kycStatus: {
      type: String,
      enum: [
        "none",
        "pending",
        "approved_stage1",
        "pending_stage2",
        "approved_stage2",
        "rejected",
      ],
      default: "none",
      index: true,
    },
    kycDocuments: {
      type: [String],
      default: [],
    },
    kycRejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
    physicalMeetingDate: {
      type: Date,
      default: null,
    },
    physicalMeetingStatus: {
      type: String,
      enum: [
        "none",
        "scheduled",
        "approved",
        "rescheduled",
        "completed",
        "rejected_stage2",
      ],
      default: "none",
      index: true,
    },
    isKycVerified: {
      type: Boolean,
      default: false,
    },
    kycVerified: {
      type: Boolean,
      default: false,
    },
    notifications: {
      type: [NotificationSchema],
      default: [],
    },
    stellarPublicKey: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    stellarAccountType: {
      type: String,
      enum: ["external_wallet", "platform_managed", "unknown"],
      default: "unknown",
    },
    stellarLinkedAt: {
      type: Date,
      default: null,
    },
    stellarLastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

export default (mongoose.models.User ||
  mongoose.model<IUser>("User", UserSchema)) as mongoose.Model<IUser>;
