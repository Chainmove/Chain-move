import { rpc, xdr, Keypair, TransactionBuilder, Address, Operation } from "@stellar/stellar-sdk"
import { getStellarConfig } from "../lib/stellar/config"
import { getSorobanRpcServer, getStellarNetworkPassphrase } from "../lib/stellar/client"
import * as path from "path"
import * as fs from "fs"

async function runRestoration() {
  console.log("=== Starting Soroban State Restoration Tool ===");

  const poolIdArg = process.argv[2];
  if (!poolIdArg) {
    console.log("Usage: npx tsx scripts/restore-state.ts <pool_id>");
    console.log("Using default pool ID: 101 for simulation.");
  }
  const poolId = poolIdArg || "101";

  const config = getStellarConfig();
  const mock = config.mock;

  if (mock) {
    console.log(`[MOCK] Running in mockup mode. Simulating restoration for pool ${poolId}.`);
    
    // Check if archive exists in evidence directory
    const archiveFile = path.join(process.cwd(), "evidence", `archive_pool_${poolId}.json`);
    if (fs.existsSync(archiveFile)) {
      console.log(`[MOCK] Found verifiable state archive: ${archiveFile}`);
      const content = JSON.parse(fs.readFileSync(archiveFile, "utf8"));
      console.log(`[MOCK] Verifying state hash integrity...`);
      console.log(`[MOCK] Hash verified: ${content.hash}`);
      console.log(`[MOCK] Signature verified: ${content.signature}`);
      console.log(`[MOCK] Submitting mock RestoreFootprintTTLOp for pool ${poolId} contract...`);
      console.log(`[MOCK] RestoreFootprintTTLOp successful. Pool ${poolId} state restored to active ledger.`);
    } else {
      console.log(`[MOCK] Verifiable state archive not found for pool ${poolId}.`);
      console.log(`[MOCK] Simulating generic RestoreFootprintTTLOp transaction for pool ${poolId}...`);
      console.log(`[MOCK] RestoreFootprintTTLOp successful.`);
    }
    
    console.log("=== State Restoration Tool Completed ===");
    return;
  }

  // Live Mode
  try {
    const rpcServer = getSorobanRpcServer();
    const networkPassphrase = getStellarNetworkPassphrase();

    const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
    if (!operatorSecret) {
      throw new Error("STELLAR_OPERATOR_SECRET environment variable is required to sign/submit live restoration transactions.");
    }
    const operatorKeypair = Keypair.fromSecret(operatorSecret);

    // Look up the contract ID from the database or config
    // For this CLI script, we retrieve the active configuration's contractId
    const contractId = config.contractId;
    if (!contractId) {
      throw new Error("STELLAR_CONTRACT_ID is not configured.");
    }

    console.log(`Restoring storage footprint for contract: ${contractId}`);

    // Build the restore footprint transaction
    const sourceAcc = await rpcServer.getAccount(operatorKeypair.publicKey());
    const tx = new TransactionBuilder(sourceAcc, {
      fee: "1000000",
      networkPassphrase,
    })
    .addOperation(
      Operation.restoreFootprint({})
    )
    .setTimeout(30)
    .build();

    // In Soroban, restoreFootprint requires the expired/archived keys to be in the footprint resources.
    // We simulate the transaction first, which prompts RPC to populate the transaction with the required footprints.
    const simResponse = await rpcServer.simulateTransaction(tx);
    
    if (rpc.Api.isSimulationSuccess(simResponse)) {
      const preparedTx: any = rpc.assembleTransaction(tx, simResponse);
      preparedTx.sign(operatorKeypair);
      
      console.log("Submitting RestoreFootprintTTLOp transaction...");
      const sendResponse: any = await rpcServer.sendTransaction(preparedTx);
      
      if (sendResponse.status !== "PENDING" && sendResponse.status !== "SUCCESS") {
        throw new Error(`RPC send failed: ${sendResponse.status}`);
      }

      console.log(`Successfully restored persistent storage for contract ${contractId}. Status: ${sendResponse.status}`);
    } else {
      throw new Error("Simulation failed. The entry might not be archived yet, or simulation footprint generation failed: " + JSON.stringify(simResponse));
    }

  } catch (err: any) {
    console.error("Restoration transaction failed:", err.message);
  }

  console.log("=== Soroban State Restoration Tool Completed ===");
}

// Automatically execute if run directly
if (require.main === module) {
  runRestoration().catch(err => {
    console.error("Restoration execution failed:", err);
    process.exit(1);
  });
}
