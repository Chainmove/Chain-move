import mongoose from "mongoose"

/**
 * Immutable record of a Stellar wallet ownership rebinding.
 * Historical transactions remain attributable to their original wallet;
 * this record bridges old → new for post-migration lookups without rewriting
 * any historical ownership references.
 */
export interface IWalletMigrationRecord {
  _id: any
  userId: string
  recoveryId: string
  network: string
  oldWalletAddress: string
  newWalletAddress: string
  migratedAt: Date
  authorisedBy: string[]
  stellarRebindTxHash?: string
  createdAt: Date
}

const WalletMigrationRecordSchema = new mongoose.Schema<IWalletMigrationRecord>(
  {
    userId: { type: String, required: true, index: true },
    recoveryId: { type: String, required: true, unique: true },
    network: { type: String, required: true },
    oldWalletAddress: { type: String, required: true, index: true },
    newWalletAddress: { type: String, required: true, index: true },
    migratedAt: { type: Date, required: true },
    authorisedBy: [{ type: String }],
    stellarRebindTxHash: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export default (mongoose.models.WalletMigrationRecord as mongoose.Model<IWalletMigrationRecord>) ||
  mongoose.model<IWalletMigrationRecord>("WalletMigrationRecord", WalletMigrationRecordSchema)
