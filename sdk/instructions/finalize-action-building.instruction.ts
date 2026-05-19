import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface FinalizeActionBuildingAccounts {
  relayer: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
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
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
      magicFeeVault: payload.accounts.magicFeeVault,
    })
    .instruction();
};
