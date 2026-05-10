import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface ApproveActionAccounts {
  relayer: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  config: PublicKey;
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
      relayer: payload.accounts.relayer,
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      config: payload.accounts.config,
    })
    .instruction();
};
