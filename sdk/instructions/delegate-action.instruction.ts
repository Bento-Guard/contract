import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";
import {
    delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
    DELEGATION_PROGRAM_ID,
    delegationMetadataPdaFromDelegatedAccount,
    delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

export interface DelegateActionAccounts {
    relayer: PublicKey;
    owner: PublicKey;
    agent: PublicKey;
    action: PublicKey;
    config: PublicKey;
    ownerProgram: PublicKey;
}

export const delegateActionIx = async (
    program: anchor.Program<Contract>,
    payload: {
        accounts: DelegateActionAccounts;
        /** Optional ER validator pubkey passed as the first remaining account during delegation. */
        validator?: PublicKey;
    },
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
        .delegateAction()
        .accountsPartial({
            relayer: payload.accounts.relayer,
            owner: payload.accounts.owner,
            agent: payload.accounts.agent,
            action: payload.accounts.action,
            config: payload.accounts.config,
            ownerProgram: payload.accounts.ownerProgram,
            delegationProgram: DELEGATION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            bufferAction: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
                payload.accounts.action,
                payload.accounts.ownerProgram,
            ),
            delegationMetadataAction: delegationMetadataPdaFromDelegatedAccount(
                payload.accounts.action,
            ),
            delegationRecordAction: delegationRecordPdaFromDelegatedAccount(
                payload.accounts.action,
            ),
        })
        .remainingAccounts(remainingAccounts)
        .instruction();
};
