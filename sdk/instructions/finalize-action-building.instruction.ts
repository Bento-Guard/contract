import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface FinalizeActionBuildingAccounts {
  relayer: PublicKey;
  agentWallet: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  /** VaultSponsor PDA — the delegated commit fee payer. Derive with `seeds.vaultSponsor()`. */
  vaultSponsor: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
  /**
   * Canonical magic fee vault PDA. Derive with `deriveMagicFeeVault` against
   * a base-layer connection — its lamports are debited to pay for the commit,
   * lifting the 10-commit sponsorship cap on the Agent and Action PDAs.
   */
  magicFeeVault: PublicKey;
}

export interface FinalizeActionBuildingParams {
  commitmentHash: number[];
}

export const finalizeActionBuildingIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: FinalizeActionBuildingAccounts;
    params: FinalizeActionBuildingParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .finalizeActionBuilding(payload.params.commitmentHash)
    .accountsPartial({
      relayer: payload.accounts.relayer,
      agentWallet: payload.accounts.agentWallet,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      vaultSponsor: payload.accounts.vaultSponsor,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
      magicFeeVault: payload.accounts.magicFeeVault,
    })
    .instruction();
};
