import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface InitActionAccounts {
  owner: PublicKey;
  agentWallet: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  config: PublicKey;
}

export interface InitActionParams {
  targetProgram: PublicKey;
  value: anchor.BN;
  actionId: anchor.BN;
  totalDataLen: number;
}

export const initActionIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: InitActionAccounts;
    params: InitActionParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .initAction({
      targetProgram: payload.params.targetProgram,
      value: payload.params.value,
      actionId: payload.params.actionId,
      totalDataLen: payload.params.totalDataLen,
    })
    .accountsPartial({
      owner: payload.accounts.owner,
      agentWallet: payload.accounts.agentWallet,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
      config: payload.accounts.config,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};
