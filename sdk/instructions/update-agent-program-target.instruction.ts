import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";
import { AllowedTarget } from "../types";

export interface UpdateAgentProgramTargetAccounts {
  owner: PublicKey;
  agentWallet: PublicKey;
  agent: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
}

export interface UpdateAgentProgramTargetParams {
  target: AllowedTarget;
}

export const updateAgentProgramTargetIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: UpdateAgentProgramTargetAccounts;
    params: UpdateAgentProgramTargetParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .updateAgentProgramTarget({
      target: payload.params.target.target,
      allowed: payload.params.target.allowed,
    })
    .accountsPartial({
      owner: payload.accounts.owner,
      agentWallet: payload.accounts.agentWallet,
      agent: payload.accounts.agent,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
    })
    .instruction();
};
