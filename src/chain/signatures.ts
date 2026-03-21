import { createHash, verify, sign, generateKeyPairSync } from "crypto";
import { canonicalStringify } from "./hash";
import type { ModuleSignature } from "./types";
import { InvalidModuleSignatureError } from "../engine/types";

/**
 * Verify a module's Ed25519 digital signature over the canonical JSON of a payload.
 *
 * @param payload - The transaction payload object that was signed
 * @param signature - The signature metadata from the API request
 * @param registeredPublicKey - PEM-encoded Ed25519 public key from the registered_modules table,
 *                              or a DER-format Buffer (used in unit tests).
 * @throws InvalidModuleSignatureError if verification fails
 */
export function verifyModuleSignature(
  payload: object,
  signature: ModuleSignature,
  registeredPublicKey: string | Buffer
): void {
  if (signature.algorithm !== "Ed25519") {
    throw new InvalidModuleSignatureError(signature.module_id);
  }

  const canonical = canonicalStringify(payload);
  const message = Buffer.from(canonical, "utf8");
  const sig = Buffer.from(signature.signature, "base64");

  let valid: boolean;
  try {
    if (Buffer.isBuffer(registeredPublicKey)) {
      valid = verify(
        null,
        message,
        { key: registeredPublicKey, format: "der", type: "spki" },
        sig
      );
    } else {
      valid = verify(
        null, // Ed25519 does not use a separate hash algorithm
        message,
        { key: registeredPublicKey, format: "pem" },
        sig
      );
    }
  } catch {
    throw new InvalidModuleSignatureError(signature.module_id);
  }

  if (!valid) {
    throw new InvalidModuleSignatureError(signature.module_id);
  }
}

/**
 * Compute the SHA-256 fingerprint of a DER-encoded public key (lowercase hex).
 */
export function computePublicKeyFingerprint(publicKey: Buffer): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

/**
 * Generate an Ed25519 key pair for testing.
 * Returns both keys as DER-format Buffers (SPKI public, PKCS8 private).
 */
export function generateTestKeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const result = generateKeyPairSync("ed25519", {
    publicKeyEncoding:  { type: "spki",  format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  // TypeScript types for `der` format return Buffer directly
  return {
    publicKey:  result.publicKey  as unknown as Buffer,
    privateKey: result.privateKey as unknown as Buffer,
  };
}

/**
 * Sign the canonical JSON of a payload with an Ed25519 private key.
 *
 * @param payload     - The object to sign (canonical-JSON serialised before signing)
 * @param privateKey  - DER-encoded PKCS8 private key Buffer
 * @returns base64-encoded Ed25519 signature
 */
export function signPayload(payload: object, privateKey: Buffer): string {
  const canonical = canonicalStringify(payload);
  const message = Buffer.from(canonical, "utf8");
  const sig = sign(
    null, // Ed25519 does not use a separate hash algorithm
    message,
    { key: privateKey, format: "der", type: "pkcs8" }
  );
  return sig.toString("base64");
}
