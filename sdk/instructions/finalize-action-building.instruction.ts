import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface FinalizeActionBuildingAccounts {
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
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
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
    })
    .instruction();
};
