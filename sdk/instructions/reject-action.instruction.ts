import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface RejectActionAccounts {
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
}

export const rejectActionIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: RejectActionAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .rejectAction()
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
    })
    .instruction();
};
