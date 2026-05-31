import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface ActiveAgentAccounts {
  relayer: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  /** VaultSponsor PDA — the delegated commit fee payer. Derive with `seeds.vaultSponsor()`. */
  vaultSponsor: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
  /** Canonical magic fee vault PDA — derive with `deriveMagicFeeVault`. */
  magicFeeVault: PublicKey;
}

export const activeAgentIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: ActiveAgentAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .activeAgent()
    .accountsPartial({
      relayer: payload.accounts.relayer,
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      vaultSponsor: payload.accounts.vaultSponsor,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
      magicFeeVault: payload.accounts.magicFeeVault,
    })
    .instruction();
};
