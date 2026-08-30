import { rpc, xdr, Keypair, TransactionBuilder, Address, Operation } from "@stellar/stellar-sdk"
import { getStellarConfig } from "../lib/stellar/config"
import { getSorobanRpcServer, getStellarNetworkPassphrase } from "../lib/stellar/client"
import dbConnect from "../lib/dbConnect"
import StellarPoolAsset from "../models/StellarPoolAsset"
import * as fs from "fs"
import * as path from "path"

// Rent Configuration Constants
const DAY_IN_LEDGERS = 17280;
const WARNING_THRESHOLD_LEDGERS = 7 * DAY_IN_LEDGERS; // 7 days
const TARGET_EXTEND_TO_LEDGERS = 30 * DAY_IN_LEDGERS; // Extend to 30 days

// Budget Controls
const MAX_RENT_BUDGET_XLM_PER_BATCH = 10.0;
const MAX_TRANSACTION_FEE_XLM = 0.5;

// Checkpoint file path
const CHECKPOINT_FILE = path.join(process.cwd(), "evidence", "sweeper_checkpoint.json");

interface SweeperMetrics {
  expiryHorizonLedgers: number;
  extensionFailureCount: number;
  projectedRentXlm30Days: number;
}

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

async function runSweeper() {
  console.log("=== Starting ChainMove Rent Sweeper ===");

  const config = getStellarConfig();
  const mock = config.mock;

  // Initialize metrics
  const metrics: SweeperMetrics = {
    expiryHorizonLedgers: Infinity,
    extensionFailureCount: 0,
    projectedRentXlm30Days: 0.0,
  };

  if (mock) {
    console.log("[MOCK] Running in mockup mode. Simulating sweeper pass.");
    // Simulate database and RPC interactions
    const mockPools = [
      { id: "101", assetCode: "SHUT101" },
      { id: "102", assetCode: "KEKE102" }
    ];

    for (const pool of mockPools) {
      console.log(`[MOCK] Sweeping pool ${pool.id} (${pool.assetCode})...`);
      // Mock random current TTL
      const currentTtl = Math.floor(Math.random() * 10 * DAY_IN_LEDGERS) + 2 * DAY_IN_LEDGERS;
      console.log(`[MOCK] Current TTL: ${currentTtl} ledgers.`);
      
      if (currentTtl < WARNING_THRESHOLD_LEDGERS) {
        console.log(`[MOCK] TTL below threshold of ${WARNING_THRESHOLD_LEDGERS}. Extending to ${TARGET_EXTEND_TO_LEDGERS}...`);
        const estimatedRent = 0.05; // Mock XLM cost
        metrics.projectedRentXlm30Days += estimatedRent;
        console.log(`[MOCK] Simulated ExtendFootprintTTLOp successful. Cost: ${estimatedRent} XLM`);
      } else {
        console.log(`[MOCK] TTL is healthy. No action taken.`);
      }

      if (currentTtl < metrics.expiryHorizonLedgers) {
        metrics.expiryHorizonLedgers = currentTtl;
      }
    }

    writeCheckpoint("mock-checkpoint-last-run");
    writeMetrics(metrics);
    console.log("=== Sweeper Pass Completed ===");
    return;
  }

  // Live Mode
  try {
    await dbConnect();
    const activeAssets = await StellarPoolAsset.find({ status: "active" });
    if (activeAssets.length === 0) {
      console.log("No active pool assets found in database. Exiting.");
      return;
    }

    const rpcServer = getSorobanRpcServer();
    const networkPassphrase = getStellarNetworkPassphrase();

    // Prepare Operator account (needed to sign transaction footprint bumps)
    // Secure Key loaded from environment - fall back to a random keypair if not provided (will print info but not submit)
    const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
    if (!operatorSecret) {
      console.warn("WARNING: STELLAR_OPERATOR_SECRET is not set. Unable to sign/submit live extension transactions.");
    }
    const operatorKeypair = operatorSecret ? Keypair.fromSecret(operatorSecret) : Keypair.random();

    console.log(`Sweeping ${activeAssets.length} active pool assets...`);

    let rentSpentThisBatch = 0.0;

    for (const asset of activeAssets) {
      const contractId = asset.contractId;
      if (!contractId) {
        console.log(`Skipping asset for pool ${asset.poolId} - no contract ID set.`);
        continue;
      }

      console.log(`Analyzing Pool ID: ${asset.poolId}, Contract ID: ${contractId}`);

      // Query contract instance TTL using getLedgerEntries
      try {
        const contractKey = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          key: xdr.ScVal.scvSymbol("Admin"), // Instance properties are tied to the instance
          durability: (xdr.ContractDataDurability as any).instance ? (xdr.ContractDataDurability as any).instance() : (xdr.ContractDataDurability as any).Instance ?? (xdr.ContractDataDurability as any).persistent?.()
        }));

        const response = await rpcServer.getLedgerEntries(contractKey);
        
        if (response.entries && response.entries.length > 0) {
          const entry = response.entries[0];
          const liveUntilLedger = entry.liveUntilLedgerSeq ?? 0;
          const latestLedger = await getLatestLedgerSeq(rpcServer);
          const currentTtl = liveUntilLedger - latestLedger;

          console.log(`Instance Storage TTL: ${currentTtl} ledgers.`);

          if (currentTtl < metrics.expiryHorizonLedgers) {
            metrics.expiryHorizonLedgers = currentTtl;
          }

          if (currentTtl < WARNING_THRESHOLD_LEDGERS) {
            console.log(`TTL is below threshold of ${WARNING_THRESHOLD_LEDGERS}. Extending...`);
            
            // Build Extend TTL operation
            // In a real implementation we would call RPC simulation to calculate correct rent first
            const estimatedRent = 0.1; // Placeholder for simulation
            
            if (rentSpentThisBatch + estimatedRent > MAX_RENT_BUDGET_XLM_PER_BATCH) {
              console.warn(`Rent budget limit reached! Skipping extension for contract ${contractId}`);
              metrics.extensionFailureCount++;
              continue;
            }

            if (!operatorSecret) {
              console.log("[DRY-RUN] Operator secret missing, skipping actual submission.");
              metrics.projectedRentXlm30Days += estimatedRent;
              continue;
            }

            // Retry mechanism
            let success = false;
            for (let retry = 1; retry <= 3; retry++) {
              try {
                const sourceAcc = await rpcServer.getAccount(operatorKeypair.publicKey());
                const tx = new TransactionBuilder(sourceAcc, {
                  fee: (parseFloat(MAX_TRANSACTION_FEE_XLM.toString()) * 10000000).toString(),
                  networkPassphrase,
                })
                .addOperation(
                  Operation.extendFootprintTtl({
                    extendTo: TARGET_EXTEND_TO_LEDGERS,
                  })
                )
                .setTimeout(30)
                .build();

                // Set footprint resources
                // In Soroban, extendFootprintTtl requires read-only footprints representing the keys to bump.
                // Normally simulation sets this. We simulate the transaction first.
                const simResponse = await rpcServer.simulateTransaction(tx);
                if (rpc.Api.isSimulationSuccess(simResponse)) {
                  const preparedTx: any = rpc.assembleTransaction(tx, simResponse);
                  preparedTx.sign(operatorKeypair);
                  const sendResponse: any = await rpcServer.sendTransaction(preparedTx);
                  
                  if (sendResponse.status !== "PENDING" && sendResponse.status !== "SUCCESS") {
                    throw new Error(`RPC send failed: ${sendResponse.status}`);
                  }
                  
                  console.log(`Successfully extended TTL for contract ${contractId} on try ${retry}.`);
                  rentSpentThisBatch += estimatedRent;
                  metrics.projectedRentXlm30Days += estimatedRent;
                  success = true;
                  break;
                } else {
                  throw new Error("Simulation failed: " + JSON.stringify(simResponse));
                }
              } catch (e: any) {
                console.error(`Attempt ${retry} failed to extend TTL for contract ${contractId}:`, e.message);
                if (retry === 3) {
                  metrics.extensionFailureCount++;
                  // Trigger operators alert
                  triggerOperatorAlert(contractId, currentTtl, e.message);
                } else {
                  // Exponential backoff
                  await new Promise(r => setTimeout(r, Math.pow(2, retry) * 1000));
                }
              }
            }
          } else {
            console.log("TTL is healthy. No extension required.");
          }
        }
      } catch (err: any) {
        console.error(`Error processing contract ${contractId}:`, err.message);
        metrics.extensionFailureCount++;
      }
    }

    writeCheckpoint(activeAssets[activeAssets.length - 1].poolId);
    writeMetrics(metrics);
  } catch (dbErr: any) {
    console.error("Database connection or query failed:", dbErr.message);
  }

  console.log("=== Sweeper Pass Completed ===");
}

async function getLatestLedgerSeq(rpcServer: rpc.Server): Promise<number> {
  try {
    const info = await rpcServer.getLatestLedger();
    return info.sequence;
  } catch {
    // Return a default placeholder if RPC fails
    return 100000;
  }
}

function writeCheckpoint(lastPoolId: string) {
  ensureDirectoryExistence(CHECKPOINT_FILE);
  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({
      lastPoolIdProcessed: lastPoolId,
      timestamp: new Date().toISOString()
    }, null, 2)
  );
  console.log(`Saved checkpoint: lastPoolIdProcessed = ${lastPoolId}`);
}

function writeMetrics(metrics: SweeperMetrics) {
  const metricsFile = path.join(process.cwd(), "evidence", "sweeper_metrics.json");
  ensureDirectoryExistence(metricsFile);
  fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
  console.log("Metrics saved successfully:", metrics);
}

function triggerOperatorAlert(contractId: string, currentTtlLedgers: number, errorMsg: string) {
  console.error(`!!! OPERATOR ALERT !!!`);
  console.error(`Contract ${contractId} is critically low on TTL (${currentTtlLedgers} ledgers left).`);
  console.error(`Extension attempt failed with error: ${errorMsg}`);
  console.error(`Immediate manual recovery action required!`);
}

// Automatically execute if run directly
if (require.main === module) {
  runSweeper().catch(err => {
    console.error("Sweeper execution failed:", err);
    process.exit(1);
  });
}
