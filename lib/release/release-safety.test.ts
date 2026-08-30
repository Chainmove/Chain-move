import { strict as assert } from "node:assert";
import { validateReleaseManifest, type ReleaseManifest } from "./manifest";
import { checkBackupFreshness, runPreflightChecks } from "./preDeployChecks";
import { isFieldReadAllowed, assertZeroReadsOfDeprecatedField } from "./migrations";
import { isUserInCanaryCohort, runCanaryProbes, evaluateRollbackTrigger } from "./canary";

const validManifest: ReleaseManifest = {
  releaseId: "rel-001",
  releaseTag: "v2.1.0",
  contractAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  wasmHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  networkPassphrase: "Test SDF Network ; September 2015",
  dbSchemaVersion: "20260722_001",
  canaryPercentage: 15,
  createdAt: new Date().toISOString(),
  requiredChecks: {
    backupFreshness: true,
    dryRunMigration: true,
    contractIdentity: true,
  },
};

// 1. Manifest Validation Tests
const validRes = validateReleaseManifest(validManifest);
assert.equal(validRes.valid, true);

const invalidRes = validateReleaseManifest({ ...validManifest, contractAddress: "invalid" });
assert.equal(invalidRes.valid, false);
assert.ok(invalidRes.errors.length > 0);

// 2. Preflight Check Tests
runPreflightChecks(validManifest).then((res) => {
  assert.equal(res.passed, true);
  assert.equal(res.checks.length, 3);
});

// 3. Expand-Contract Migration Tests
const migration = {
  id: "mig-001",
  sourceField: "oldAddress",
  targetField: "newWalletAddress",
  phase: "contract" as const,
  deprecatedReadsAllowed: false,
};

assert.equal(isFieldReadAllowed(migration, "newWalletAddress"), true);
assert.equal(isFieldReadAllowed(migration, "oldAddress"), false);

const zeroReadsCheck = assertZeroReadsOfDeprecatedField(migration, 0);
assert.equal(zeroReadsCheck.safeToContract, true);

const nonZeroReadsCheck = assertZeroReadsOfDeprecatedField(migration, 5);
assert.equal(nonZeroReadsCheck.safeToContract, false);

// 4. Canary Routing & Probe Tests
const inCohort = isUserInCanaryCohort("user-123", 100);
assert.equal(inCohort, true);

const outCohort = isUserInCanaryCohort("user-123", 0);
assert.equal(outCohort, false);

runCanaryProbes([
  { operation: "wallet.read", run: async () => true },
  { operation: "investment.check", run: async () => true },
]).then((probeRes) => {
  assert.equal(probeRes.allPassed, true);
  assert.equal(probeRes.passedCount, 2);
});

// 5. Automated Rollback Trigger Tests
const healthyRollback = evaluateRollbackTrigger(0.5, 2.0, 0);
assert.equal(healthyRollback.triggered, false);

const failedProbeRollback = evaluateRollbackTrigger(0.1, 2.0, 1);
assert.equal(failedProbeRollback.triggered, true);

const highErrorRollback = evaluateRollbackTrigger(5.0, 2.0, 0);
assert.equal(highErrorRollback.triggered, true);
