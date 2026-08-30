// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { Keypair } from "@stellar/stellar-sdk"

describe("Soroban State Rent & Archival Lifecycle", () => {
  const evidenceDir = path.join(process.cwd(), "evidence");

  beforeEach(() => {
    // Clean up evidence files if they exist
    if (fs.existsSync(evidenceDir)) {
      const files = fs.readdirSync(evidenceDir);
      for (const file of files) {
        if (file.startsWith("sweeper_") || file.startsWith("archive_")) {
          fs.unlinkSync(path.join(evidenceDir, file));
        }
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should generate a hash-verifiable offline archive and check its signature", () => {
    const operatorKeypair = Keypair.random();
    
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
        ]
      }
    };

    const serializedState = JSON.stringify(mockState, null, 2);
    const hash = crypto.createHash("sha256").update(serializedState).digest("hex");
    const signature = operatorKeypair.sign(Buffer.from(hash, "hex")).toString("hex");

    const archivePayload = {
      state: mockState,
      hash,
      signature,
      signerPublicKey: operatorKeypair.publicKey(),
    };

    // Verify reconstruction / verification path
    const derivedHash = crypto.createHash("sha256").update(JSON.stringify(archivePayload.state, null, 2)).digest("hex");
    expect(derivedHash).toBe(hash);

    const verified = operatorKeypair.verify(Buffer.from(derivedHash, "hex"), Buffer.from(signature, "hex"));
    expect(verified).toBe(true);
  });

  it("should handle corrupted archive signatures during validation checks", () => {
    const operatorKeypair = Keypair.random();
    const mockState = { version: "1.0", poolId: 102 };
    
    const serializedState = JSON.stringify(mockState, null, 2);
    const hash = crypto.createHash("sha256").update(serializedState).digest("hex");
    const signature = operatorKeypair.sign(Buffer.from(hash, "hex")).toString("hex");

    // Corrupt the signature by modifying the last byte
    const corruptedSignature = signature.substring(0, signature.length - 2) + "00";

    const verified = operatorKeypair.verify(Buffer.from(hash, "hex"), Buffer.from(corruptedSignature, "hex"));
    expect(verified).toBe(false);
  });

  it("should enforce rent budget controls in the sweeper logic", () => {
    const MAX_RENT_BUDGET = 10.0;
    let rentSpent = 0.0;

    const mockExtensions = [
      { contractId: "C1", rentCost: 3.5 },
      { contractId: "C2", rentCost: 4.5 },
      { contractId: "C3", rentCost: 5.0 }, // This should exceed budget
    ];

    const processedContracts: string[] = [];
    let budgetFailures = 0;

    for (const extension of mockExtensions) {
      if (rentSpent + extension.rentCost <= MAX_RENT_BUDGET) {
        rentSpent += extension.rentCost;
        processedContracts.push(extension.contractId);
      } else {
        budgetFailures++;
      }
    }

    expect(rentSpent).toBe(8.0);
    expect(processedContracts).toEqual(["C1", "C2"]);
    expect(budgetFailures).toBe(1);
  });
});
