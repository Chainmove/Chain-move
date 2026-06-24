import mongoose, { Document, Schema } from 'mongoose';

export interface IInvestment extends Document {
  investorId: Schema.Types.ObjectId;
  loanId: Schema.Types.ObjectId;
  vehicleId: Schema.Types.ObjectId;
  amount: number;
  status: 'Funding' | 'Active' | 'Completed';
  monthlyReturn: number;
  date: Date;
}

const InvestmentSchema: Schema = new Schema({
  investorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  loanId: { type: Schema.Types.ObjectId, ref: 'Loan', required: false },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Active', 'Completed'],
    default: 'Active',
  },
  monthlyReturn: { type: Number, required: true },
  date: { type: Date, default: Date.now },
});

export default (mongoose.models.Investment ||
  mongoose.model<IInvestment>('Investment', InvestmentSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;