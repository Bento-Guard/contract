import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface InitVaultSponsorAccounts {
  operator: PublicKey;
  /** VaultSponsor PDA — derive with `seeds.vaultSponsor()`. */
  vaultSponsor: PublicKey;
}

export const initVaultSponsorIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: InitVaultSponsorAccounts;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .initVaultSponsor()
    .accountsPartial({
      operator: payload.accounts.operator,
      vaultSponsor: payload.accounts.vaultSponsor,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};
