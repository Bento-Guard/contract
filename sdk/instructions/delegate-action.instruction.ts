import * as anchor from "@coral-xyz/anchor";
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface DelegateActionAccounts {
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  config: PublicKey;
  ownerProgram: PublicKey;
  delegationProgram: PublicKey;
}

export const delegateActionIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: DelegateActionAccounts;
    /** Optional ER validator pubkey passed as the first remaining account during delegation. */
    validator?: PublicKey;
  }
): Promise<TransactionInstruction> => {
  const remainingAccounts: AccountMeta[] = payload.validator
    ? [
        {
          pubkey: payload.validator,
          isSigner: false,
          isWritable: false,
        },
      ]
    : [];

  return await program.methods
    .delegateAction()
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      config: payload.accounts.config,
      ownerProgram: payload.accounts.ownerProgram,
      delegationProgram: payload.accounts.delegationProgram,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
};
