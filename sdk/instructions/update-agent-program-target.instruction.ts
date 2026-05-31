import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";
import { AllowedTarget } from "../types";

export interface UpdateAgentProgramTargetAccounts {
  relayer: PublicKey;
  owner: PublicKey;
  agentWallet: PublicKey;
  agent: PublicKey;
  /** VaultSponsor PDA — the delegated commit fee payer. Derive with `seeds.vaultSponsor()`. */
  vaultSponsor: PublicKey;
  config: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
  /** Canonical magic fee vault PDA — derive with `deriveMagicFeeVault`. */
  magicFeeVault: PublicKey;
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
      relayer: payload.accounts.relayer,
      owner: payload.accounts.owner,
      agentWallet: payload.accounts.agentWallet,
      agent: payload.accounts.agent,
      vaultSponsor: payload.accounts.vaultSponsor,
      config: payload.accounts.config,
      magicProgram: payload.accounts.magicProgram,
      magicContext: payload.accounts.magicContext,
      magicFeeVault: payload.accounts.magicFeeVault,
    })
    .instruction();
};
