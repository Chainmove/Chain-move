import mongoose, { Document, Schema } from 'mongoose';

export interface IVehicle extends Document {
  name: string;
  identifier?: string;
  type: string;
  year: number;
  price: number;
  roi: number;
  features: string[];
  image?: string;
  status: 'Available' | 'Financed' | 'Reserved' | 'Maintenance' | 'Retired';
  specifications: {
    engine: string;
    fuelType: string;
    mileage: string;
    transmission: string;
    color: string;
    vin: string;
  };
  addedDate: Date;
  popularity: number;
  driverId?: Schema.Types.ObjectId;
  fundingStatus: 'Open' | 'Funded' | 'Active'; // Tracks the investment state
  totalFundedAmount: number;
}

const VehicleSchema: Schema = new Schema({
  name: { type: String, required: true },
  identifier: { type: String, trim: true, unique: true, sparse: true },
  type: { type: String, required: true },
  year: { type: Number, required: true },
  price: { type: Number, required: true },
  roi: { type: Number, required: true },
  features: { type: [String], default: [] },
  image: { type: String },
  status: {
    type: String,
    enum: ['Available', 'Financed', 'Reserved', 'Maintenance', 'Retired'],
    default: 'Available',
  },
  specifications: {
    engine: { type: String },
    fuelType: { type: String },
    mileage: { type: String },
    transmission: { type: String },
    color: { type: String },
    vin: { type: String, unique: true },
  },
  addedDate: { type: Date, default: Date.now },
  popularity: { type: Number, default: 0 },
  driverId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
  fundingStatus: {
    type: String,
    enum: ['Open', 'Funded', 'Active'],
    default: 'Open', // Starts as open for investment
  },
  totalFundedAmount: { type: Number, default: 0 },
});

export default (mongoose.models.Vehicle ||
  mongoose.model<IVehicle>('Vehicle', VehicleSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
