import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PREFIX_SEED } from "../common";

export const seeds = {
  config: () => {
    return [Buffer.from(PREFIX_SEED), Buffer.from("config")];
  },

  vaultSponsor: () => {
    return [Buffer.from(PREFIX_SEED), Buffer.from("vault_sponsor")];
  },

  agent: (agentWallet: PublicKey) => {
    return [
      Buffer.from(PREFIX_SEED),
      Buffer.from("agent"),
      agentWallet.toBuffer(),
    ];
  },

  action: (agent: PublicKey, actionId: anchor.BN) => {
    const actionIdBuf = Buffer.alloc(8);
    actionIdBuf.writeBigUInt64LE(BigInt(actionId.toString()));
    return [
      Buffer.from(PREFIX_SEED),
      Buffer.from("action"),
      agent.toBuffer(),
      actionIdBuf,
    ];
  },
};
