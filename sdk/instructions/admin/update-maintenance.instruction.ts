import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface UpdateMaintenanceAccounts {
  operator: PublicKey;
  config: PublicKey;
}

export interface UpdateMaintenanceParams {
  maintenance: boolean;
}

export const updateMaintenanceIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: UpdateMaintenanceAccounts;
    params: UpdateMaintenanceParams;
  }
): Promise<TransactionInstruction> => {
  return await program.methods
    .updateMaintenance(payload.params.maintenance)
    .accountsPartial({
      operator: payload.accounts.operator,
      config: payload.accounts.config,
    })
    .instruction();
};
