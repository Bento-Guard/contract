import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface VerdictActionAccounts {
  relayer: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  /** VaultSponsor PDA — the delegated commit fee payer. Derive with `seeds.vaultSponsor()`. */
  vaultSponsor: PublicKey;
  config: PublicKey;
  /**
   * Canonical magic fee vault PDA — derive with `deriveMagicFeeVault`.
   * Lifts the 10-commit sponsorship cap so the relayer can keep submitting
   * verdicts on long-lived Agent PDAs without re-delegating.
   */
  magicFeeVault: PublicKey;
}

export interface VerdictActionParams {
  rawScore: number;
  reasoningHash: number[];
}

export const verdictActionIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: VerdictActionAccounts;
    params: VerdictActionParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .verdictAction({
      rawScore: payload.params.rawScore,
      reasoningHash: payload.params.reasoningHash,
    })
    .accountsPartial({
      relayer: payload.accounts.relayer,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      vaultSponsor: payload.accounts.vaultSponsor,
      config: payload.accounts.config,
      magicFeeVault: payload.accounts.magicFeeVault,
    })
    .instruction();
};
