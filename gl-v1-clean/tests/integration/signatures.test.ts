import { createPublicKey } from "crypto";
import { postTransaction } from "../../src/engine/posting";
import { readAllEntries } from "../../src/chain/writer";
import {
  generateTestKeyPair,
  signPayload,
  computePublicKeyFingerprint,
} from "../../src/chain/signatures";
import {
  InvalidModuleSignatureError,
  UnregisteredModuleKeyError,
} from "../../src/engine/types";
import { knex } from "../../src/db/connection";
import type { ModuleSignature } from "../../src/chain/types";
import type { TransactionSubmission } from "../../src/engine/types";
import {
  setupTestTenant,
  cleanupTestTenant,
  closeKnex,
} from "./helpers";

function derPublicKeyToPem(derBuf: Buffer): string {
  return createPublicKey({ key: derBuf, format: "der", type: "spki" })
    .export({ format: "pem", type: "spki" }) as string;
}

beforeAll(async () => { await setupTestTenant(); });
beforeEach(async () => { await cleanupTestTenant(); });
afterEach(async () => { await cleanupTestTenant(); });
afterAll(async () => { await closeKnex(); });

async function registerSigningModule(
  moduleId: string,
  pemPublicKey: string | null,
  allowedTypes: string[] = ["MANUAL_JOURNAL", "CUSTOMER_INVOICE"]
): Promise<void> {
  await knex("registered_modules")
    .insert({
      module_id: moduleId,
      display_name: `Test Signing Module (${moduleId})`,
      public_key: pemPublicKey,
      allowed_transaction_types: allowedTypes,
      is_active: true,
    })
    .onConflict("module_id")
    .merge(["public_key", "display_name"]);
}

function baseSubmission(overrides: Partial<TransactionSubmission> = {}): TransactionSubmission {
  return {
    transaction_type: "MANUAL_JOURNAL",
    date: "2026-03-10",
    period_id: "2026-03",
    description: "Signature integration test",
    lines: [
      { account_code: "1000", description: "Bank",   net_amount: "100.00" },
      { account_code: "3100", description: "Equity", net_amount: "-100.00" },
    ],
    source: { module_id: "test-module" },
    ...overrides,
  };
}

describe("Module digital signatures", () => {
  it("accepts a correctly signed transaction and stores the signature on the chain entry", async () => {
    const { publicKey: derPub, privateKey: derPriv } = generateTestKeyPair();
    const pemPub = derPublicKeyToPem(derPub);
    const sigModuleId = "signing-module-1";
    await registerSigningModule(sigModuleId, pemPub);

    const sub = baseSubmission({ idempotency_key: "sig-valid-001" });
    const sig64 = signPayload(sub, derPriv);
    const moduleSig: ModuleSignature = {
      module_id: sigModuleId,
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(derPub),
    };

    const result = await postTransaction({ ...sub, module_signature: moduleSig });
    expect(result.status).toBe("POSTED");

    const entries = readAllEntries("2026-03");
    const txEntry = entries.find((e) => e.type === "TRANSACTION");
    expect(txEntry).toBeDefined();
    expect(txEntry!.module_signature).not.toBeNull();
    expect(txEntry!.module_signature!.module_id).toBe(sigModuleId);
    expect(txEntry!.module_signature!.algorithm).toBe("Ed25519");
    expect(txEntry!.module_signature!.signature).toBe(sig64);
  });

  it("rejects a transaction signed with the wrong private key", async () => {
    const { publicKey: derPub } = generateTestKeyPair();
    const { privateKey: wrongPriv } = generateTestKeyPair();
    const pemPub = derPublicKeyToPem(derPub);
    const sigModuleId = "signing-module-2";
    await registerSigningModule(sigModuleId, pemPub);

    const sub = baseSubmission({ idempotency_key: "sig-invalid-001" });
    const sig64 = signPayload(sub, wrongPriv);
    const moduleSig: ModuleSignature = {
      module_id: sigModuleId,
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(derPub),
    };

    await expect(
      postTransaction({ ...sub, module_signature: moduleSig })
    ).rejects.toThrow(InvalidModuleSignatureError);
  });

  it("accepts an unsigned transaction from a registered module (signatures optional)", async () => {
    const result = await postTransaction(
      baseSubmission({ idempotency_key: "sig-unsigned-001" })
    );
    expect(result.status).toBe("POSTED");

    const entries = readAllEntries("2026-03");
    const txEntry = entries.find((e) => e.type === "TRANSACTION");
    expect(txEntry).toBeDefined();
    expect(txEntry!.module_signature).toBeNull();
  });

  it("accepts a transaction from an unregistered source module with no signature", async () => {
    const result = await postTransaction(baseSubmission({
      source: { module_id: "completely-unknown-module" },
      idempotency_key: "sig-unregistered-001",
    }));
    expect(result.status).toBe("POSTED");
  });

  it("rejects when signing module has no public key (UnregisteredModuleKeyError)", async () => {
    const noKeyModuleId = "no-key-module";
    await registerSigningModule(noKeyModuleId, null);

    const { privateKey: somePriv } = generateTestKeyPair();
    const sub = baseSubmission({ idempotency_key: "sig-nokey-001" });
    const sig64 = signPayload(sub, somePriv);
    const moduleSig: ModuleSignature = {
      module_id: noKeyModuleId,
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: "irrelevant",
    };

    await expect(
      postTransaction({ ...sub, module_signature: moduleSig })
    ).rejects.toThrow(UnregisteredModuleKeyError);
  });

  it("db record stores signature JSON on a successfully signed post", async () => {
    const { publicKey: derPub, privateKey: derPriv } = generateTestKeyPair();
    const pemPub = derPublicKeyToPem(derPub);
    const sigModuleId = "signing-module-db";
    await registerSigningModule(sigModuleId, pemPub);

    const sub = baseSubmission({ idempotency_key: "sig-db-001" });
    const sig64 = signPayload(sub, derPriv);
    const moduleSig: ModuleSignature = {
      module_id: sigModuleId,
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(derPub),
    };

    const result = await postTransaction({ ...sub, module_signature: moduleSig });
    expect(result.status).toBe("POSTED");

    const tx = await knex("transactions")
      .where({ transaction_id: result.transaction_id })
      .first() as Record<string, unknown>;
    expect(tx).toBeDefined();

    const stored = typeof tx["module_signature"] === "string"
      ? JSON.parse(tx["module_signature"] as string) as Record<string, unknown>
      : tx["module_signature"] as Record<string, unknown>;
    expect(stored).not.toBeNull();
    expect(stored["module_id"]).toBe(sigModuleId);
    expect(stored["signature"]).toBe(sig64);
  });
});
