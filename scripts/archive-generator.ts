import { Keypair } from "@stellar/stellar-sdk"
import { getStellarConfig } from "../lib/stellar/config"
import dbConnect from "../lib/dbConnect"
import StellarPoolAsset from "../models/StellarPoolAsset"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"

// Config
const ARCHIVE_DIR = path.join(process.cwd(), "evidence");

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

async function runArchiver() {
  console.log("=== Starting ChainMove State Archiver ===");

  const config = getStellarConfig();
  const mock = config.mock;

  // Key for signing archives (operator key)
  const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
  const operatorKeypair = operatorSecret ? Keypair.fromSecret(operatorSecret) : Keypair.random();

  if (mock) {
    console.log("[MOCK] Running in mockup mode. Generating mock archive.");
    
    const mockState = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      poolId: 101,
      assetCode: "SHUT101",
      contractState: {
        totalInvested: "1000000000",
        totalRepaid: "250000000",
        active: false,
        investors: [
          { address: "GDQP237FBX5QQYNZPXZV2N5JM2CBY2QAVXFFPT45M5D7KOP7ZP273322", units: 50, invested: "500000000" },
          { address: "GBNLJJ2E2QAPWZHGP5U5JM2CBY2QAVXFFPT45M5D7KOP7ZP273299", units: 50, invested: "500000000" }
        ]
      }
    };

    const serializedState = JSON.stringify(mockState, null, 2);
    const hash = crypto.createHash("sha256").update(serializedState).digest("hex");
    
    // Sign the hash with operator key
    const signature = operatorKeypair.sign(Buffer.from(hash, "hex")).toString("hex");

    const archivePayload = {
      state: mockState,
      hash,
      signature,
      signerPublicKey: operatorKeypair.publicKey(),
    };

    const archiveFile = path.join(ARCHIVE_DIR, `archive_pool_101.json`);
    ensureDirectoryExistence(archiveFile);
    fs.writeFileSync(archiveFile, JSON.stringify(archivePayload, null, 2));

    console.log(`[MOCK] Mock archive successfully written to ${archiveFile}`);
    console.log(`[MOCK] State hash: ${hash}`);
    console.log(`[MOCK] State signature: ${signature}`);
    console.log("=== State Archiver Pass Completed ===");
    return;
  }

  // Live Mode
  try {
    await dbConnect();
    
    // For this demonstration, we query closed/inactive pools to archive them
    const inactiveAssets = await StellarPoolAsset.find({ status: "closed" });
    if (inactiveAssets.length === 0) {
      console.log("No closed pool assets found in database to archive.");
      return;
    }

    for (const asset of inactiveAssets) {
      console.log(`Archiving closed Pool ID: ${asset.poolId}`);

      const statePayload = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        poolId: asset.poolId,
        assetCode: asset.assetCode,
        contractState: {
          issuerPublicKey: asset.issuerPublicKey,
          distributionPublicKey: asset.distributionPublicKey,
          contractId: asset.contractId,
          status: asset.status,
          network: asset.network,
          metadata: asset.metadata,
        }
      };

      const serializedState = JSON.stringify(statePayload, null, 2);
      const hash = crypto.createHash("sha256").update(serializedState).digest("hex");
      
      const signature = operatorKeypair.sign(Buffer.from(hash, "hex")).toString("hex");

      const archivePayload = {
        state: statePayload,
        hash,
        signature,
        signerPublicKey: operatorKeypair.publicKey(),
      };

      const archiveFile = path.join(ARCHIVE_DIR, `archive_pool_${asset.poolId}.json`);
      ensureDirectoryExistence(archiveFile);
      fs.writeFileSync(archiveFile, JSON.stringify(archivePayload, null, 2));

      console.log(`Archive successfully written to ${archiveFile}`);
      console.log(`State hash: ${hash}`);
    }

  } catch (err: any) {
    console.error("Archiving failed:", err.message);
  }

  console.log("=== State Archiver Pass Completed ===");
}

// Automatically execute if run directly
if (require.main === module) {
  runArchiver().catch(err => {
    console.error("Archiver execution failed:", err);
    process.exit(1);
  });
}
