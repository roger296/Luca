import { createHash } from "crypto";
import {
  generateTestKeyPair,
  signPayload,
  computePublicKeyFingerprint,
  verifyModuleSignature,
} from "../../../src/chain/signatures";
import { InvalidModuleSignatureError } from "../../../src/engine/types";
import type { ModuleSignature } from "../../../src/chain/types";

// ── Helper ───────────────────────────────────────────────────────────────────

/** Convert a DER-encoded SPKI public key Buffer to PEM string. */
function derToPem(derBuf: Buffer): string {
  const b64 = derBuf.toString("base64").match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

// ── generateTestKeyPair ───────────────────────────────────────────────────────

describe("generateTestKeyPair", () => {
  it("returns publicKey and privateKey as Buffers", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    expect(Buffer.isBuffer(publicKey)).toBe(true);
    expect(Buffer.isBuffer(privateKey)).toBe(true);
    expect(publicKey.length).toBeGreaterThan(0);
    expect(privateKey.length).toBeGreaterThan(0);
  });

  it("returns a different key pair on each call", () => {
    const kp1 = generateTestKeyPair();
    const kp2 = generateTestKeyPair();
    expect(kp1.publicKey.equals(kp2.publicKey)).toBe(false);
  });
});

// ── computePublicKeyFingerprint ───────────────────────────────────────────────

describe("computePublicKeyFingerprint", () => {
  it("returns a 64-character lowercase hex string", () => {
    const { publicKey } = generateTestKeyPair();
    const fp = computePublicKeyFingerprint(publicKey);
    expect(fp).toHaveLength(64);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the SHA-256 hash of the raw DER bytes", () => {
    const { publicKey } = generateTestKeyPair();
    const expected = createHash("sha256").update(publicKey).digest("hex");
    expect(computePublicKeyFingerprint(publicKey)).toBe(expected);
  });

  it("is deterministic for the same key", () => {
    const { publicKey } = generateTestKeyPair();
    expect(computePublicKeyFingerprint(publicKey))
      .toBe(computePublicKeyFingerprint(publicKey));
  });

  it("returns different fingerprints for different keys", () => {
    const { publicKey: pk1 } = generateTestKeyPair();
    const { publicKey: pk2 } = generateTestKeyPair();
    expect(computePublicKeyFingerprint(pk1))
      .not.toBe(computePublicKeyFingerprint(pk2));
  });
});

// ── signPayload / verifyModuleSignature ───────────────────────────────────────

describe("signPayload + verifyModuleSignature", () => {
  const payload = {
    transaction_type: "MANUAL_JOURNAL",
    date: "2026-03-10",
    lines: [{ account_code: "1000", net_amount: "100.00" }],
  };

  it("signs a payload and verifies against the DER public key", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    const sig64 = signPayload(payload, privateKey);
    expect(typeof sig64).toBe("string");
    expect(sig64.length).toBeGreaterThan(0);

    const moduleSig: ModuleSignature = {
      module_id: "test-module",
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    // Should not throw
    expect(() => verifyModuleSignature(payload, moduleSig, publicKey)).not.toThrow();
  });

  it("signs a payload and verifies against the PEM public key", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    const sig64 = signPayload(payload, privateKey);
    const pem = derToPem(publicKey);

    const moduleSig: ModuleSignature = {
      module_id: "test-module",
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    expect(() => verifyModuleSignature(payload, moduleSig, pem)).not.toThrow();
  });

  it("throws InvalidModuleSignatureError when signed by a different private key", () => {
    const { publicKey } = generateTestKeyPair();
    const { privateKey: wrongKey } = generateTestKeyPair();
    const sig64 = signPayload(payload, wrongKey);

    const moduleSig: ModuleSignature = {
      module_id: "test-module",
      algorithm: "Ed25519",
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    expect(() => verifyModuleSignature(payload, moduleSig, publicKey))
      .toThrow(InvalidModuleSignatureError);
  });

  it("throws InvalidModuleSignatureError when the signature is corrupted", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    const sig64 = signPayload(payload, privateKey);
    // Corrupt the signature by flipping a character
    const corrupted = sig64.slice(0, -4) + "AAAA";

    const moduleSig: ModuleSignature = {
      module_id: "test-module",
      algorithm: "Ed25519",
      signature: corrupted,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    expect(() => verifyModuleSignature(payload, moduleSig, publicKey))
      .toThrow(InvalidModuleSignatureError);
  });

  it("throws InvalidModuleSignatureError for an unsupported algorithm", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    const sig64 = signPayload(payload, privateKey);

    const moduleSig = {
      module_id: "test-module",
      algorithm: "RSA" as "Ed25519", // wrong algorithm
      signature: sig64,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    expect(() => verifyModuleSignature(payload, moduleSig, publicKey))
      .toThrow(InvalidModuleSignatureError);
  });

  it("different payloads produce different signatures", () => {
    const { privateKey } = generateTestKeyPair();
    const sig1 = signPayload({ amount: "100.00" }, privateKey);
    const sig2 = signPayload({ amount: "200.00" }, privateKey);
    expect(sig1).not.toBe(sig2);
  });

  it("signature is deterministic for the same payload and key", () => {
    // Ed25519 is deterministic (no random nonce in the signing algorithm)
    const { privateKey } = generateTestKeyPair();
    const sig1 = signPayload(payload, privateKey);
    const sig2 = signPayload(payload, privateKey);
    expect(sig1).toBe(sig2);
  });

  it("canonical form used for signing: key order does not matter", () => {
    const { publicKey, privateKey } = generateTestKeyPair();
    const payloadAB = { a: "1", b: "2" };
    const payloadBA = { b: "2", a: "1" };   // same data, different key order
    const sig = signPayload(payloadAB, privateKey);

    const moduleSig: ModuleSignature = {
      module_id: "test-module",
      algorithm: "Ed25519",
      signature: sig,
      public_key_fingerprint: computePublicKeyFingerprint(publicKey),
    };
    // Verification against reversed-key payload should succeed (canonical JSON normalises order)
    expect(() => verifyModuleSignature(payloadBA, moduleSig, publicKey)).not.toThrow();
  });
});
