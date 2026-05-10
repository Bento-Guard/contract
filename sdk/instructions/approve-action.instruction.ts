import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface ApproveActionAccounts {
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
}

export const approveActionIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: ApproveActionAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .approveAction()
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
    })
    .instruction();
};
