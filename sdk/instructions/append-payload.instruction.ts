import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface AppendPayloadAccounts {
  owner: PublicKey;
  agent: PublicKey;
  action: PublicKey;
}

export interface AppendPayloadParams {
  offset: number;
  chunk: Buffer;
}

export const appendPayloadIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: AppendPayloadAccounts;
    params: AppendPayloadParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .appendPayload({
      offset: payload.params.offset,
      chunk: payload.params.chunk,
    })
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      action: payload.accounts.action,
    })
    .instruction();
};
