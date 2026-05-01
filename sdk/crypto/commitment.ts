import { blake3 } from "@noble/hashes/blake3";

export const COMMITMENT_LENGTH = 32;

export const commitmentHash = (plaintext: Uint8Array): Uint8Array => {
  return blake3(plaintext);
};

export const commitmentHashAsArray = (plaintext: Uint8Array): number[] => {
  return Array.from(blake3(plaintext));
};
