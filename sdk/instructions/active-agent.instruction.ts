import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface ActiveAgentAccounts {
  owner: PublicKey;
  agent: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
}

export const activeAgentIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: ActiveAgentAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .activeAgent()
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
    })
    .instruction();
};
