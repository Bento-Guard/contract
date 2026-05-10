import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface VerdictActionAccounts {
  relayer: PublicKey;
  agent: PublicKey;
  action: PublicKey;
  config: PublicKey;
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
      config: payload.accounts.config,
    })
    .instruction();
};
