import { PublicKey } from "@solana/web3.js";

export interface AllowedTarget {
  target: PublicKey;
  allowed: boolean;
}
