import mongoose, { Document, Schema } from 'mongoose';

export interface ILoan extends Document {
  driverId: Schema.Types.ObjectId;
  vehicleId: Schema.Types.ObjectId;
  requestedAmount: number;
  totalAmountToPayBack?: number;
  totalFunded: number;
  fundingProgress: number;
  status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected' | 'Active' | 'Completed';
  loanTerm: number; // in months
  monthlyPayment: number;
  weeklyPayment?: number;
  interestRate: number;
  creditScore: number;
  purpose: string;
  collateral?: string;
  riskAssessment: 'Low' | 'Medium' | 'High';
  submittedDate: Date;
  adminNotes?: string;
  approvedDate?: Date;
  reviewedDate?: Date;
  downPaymentMade?: boolean;
  downPaymentAmount?: number;
  downPaymentDate?: Date;
  investorApprovals: Schema.Types.ObjectId[];
}

const LoanSchema: Schema = new Schema({
  driverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  requestedAmount: { type: Number, required: true },
  totalAmountToPayBack: { type: Number },
  totalFunded: { type: Number, default: 0 },
  fundingProgress: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['Pending', 'Under Review', 'Approved', 'Rejected', 'Active', 'Completed'],
    default: 'Pending',
  },
  loanTerm: { type: Number, required: true },
  monthlyPayment: { type: Number, required: true },
  weeklyPayment: { type: Number },
  interestRate: { type: Number, required: true },
  creditScore: { type: Number },
  purpose: { type: String },
  collateral: { type: String },
  riskAssessment: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
  },
  submittedDate: { type: Date, default: Date.now },
  adminNotes: { type: String },
  approvedDate: { type: Date },
  reviewedDate: { type: Date },
  downPaymentMade: { type: Boolean, default: false },
  downPaymentAmount: { type: Number, default: 0 },
  downPaymentDate: { type: Date },
  investorApprovals: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

// Pre-save middleware to calculate remaining amount
LoanSchema.virtual('remainingAmount').get(function() {
  const loan = this as unknown as { requestedAmount?: number; totalFunded?: number }
  return Number(loan.requestedAmount || 0) - Number(loan.totalFunded || 0)
});

export default (mongoose.models.Loan ||
  mongoose.model<ILoan>('Loan', LoanSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
