import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";

export interface RegisterAgentAccounts {
  owner: PublicKey;
  agentWallet: PublicKey;
  agent: PublicKey;
  config: PublicKey;
}

export interface RegisterAgentParams {
  spendLimit: anchor.BN;
}

export const registerAgentIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: RegisterAgentAccounts;
    params: RegisterAgentParams;
  },
): Promise<TransactionInstruction> => {
  return await program.methods
    .registerAgent({
      spendLimit: payload.params.spendLimit,
    })
    .accountsPartial({
      owner: payload.accounts.owner,
      agentWallet: payload.accounts.agentWallet,
      agent: payload.accounts.agent,
      config: payload.accounts.config,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};
