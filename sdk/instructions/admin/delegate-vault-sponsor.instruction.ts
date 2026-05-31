import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  DELEGATION_PROGRAM_ID,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

export interface DelegateVaultSponsorAccounts {
  operator: PublicKey;
  vaultSponsor: PublicKey;
  config: PublicKey;
  ownerProgram: PublicKey;
}

export const delegateVaultSponsorIx = async (
  program: anchor.Program<Contract>,
  payload: {
    accounts: DelegateVaultSponsorAccounts;
    /** Optional ER validator pubkey passed as the first remaining account during delegation. */
    validator?: PublicKey;
  }
): Promise<TransactionInstruction> => {
  const remainingAccounts: AccountMeta[] = payload.validator
    ? [
        {
          pubkey: payload.validator,
          isSigner: false,
          isWritable: false,
        },
      ]
    : [];

  return await program.methods
    .delegateVaultSponsor()
    .accountsPartial({
      operator: payload.accounts.operator,
      vaultSponsor: payload.accounts.vaultSponsor,
      config: payload.accounts.config,
      ownerProgram: payload.accounts.ownerProgram,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      bufferVaultSponsor: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        payload.accounts.vaultSponsor,
        payload.accounts.ownerProgram
      ),
      delegationMetadataVaultSponsor: delegationMetadataPdaFromDelegatedAccount(
        payload.accounts.vaultSponsor
      ),
      delegationRecordVaultSponsor: delegationRecordPdaFromDelegatedAccount(
        payload.accounts.vaultSponsor
      ),
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
};
