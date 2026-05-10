import { x25519 } from "@noble/curves/ed25519";

export interface X25519Keypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export const X25519_KEY_LENGTH = 32;

export const generateX25519Keypair = (): X25519Keypair => {
  const { secretKey, publicKey } = x25519.keygen();
  return { secretKey, publicKey };
};

export const deriveX25519PublicKey = (secretKey: Uint8Array): Uint8Array => {
  if (secretKey.length !== X25519_KEY_LENGTH) {
    throw new Error(
      `x25519 secret key must be ${X25519_KEY_LENGTH} bytes, got ${secretKey.length}`
    );
  }
  return x25519.getPublicKey(secretKey);
};

export const toEncryptionKeyBytes = (publicKey: Uint8Array): number[] => {
  if (publicKey.length !== X25519_KEY_LENGTH) {
    throw new Error(
      `x25519 public key must be ${X25519_KEY_LENGTH} bytes, got ${publicKey.length}`
    );
  }
  return Array.from(publicKey);
};

export const fromEncryptionKeyBytes = (bytes: number[]): Uint8Array => {
  if (bytes.length !== X25519_KEY_LENGTH) {
    throw new Error(
      `x25519 public key must be ${X25519_KEY_LENGTH} bytes, got ${bytes.length}`
    );
  }
  return Uint8Array.from(bytes);
};
