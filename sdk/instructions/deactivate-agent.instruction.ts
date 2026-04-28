import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface DeactivateAgentAccounts {
  owner: PublicKey;
  agent: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
}

export const deactivateAgentIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: DeactivateAgentAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .deactivateAgent()
    .accountsPartial({
      owner: payload.accounts.owner,
      agent: payload.accounts.agent,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
    })
    .instruction();
};
