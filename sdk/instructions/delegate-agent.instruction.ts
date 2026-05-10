import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../target/types/contract";
import {
    delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
    DELEGATION_PROGRAM_ID,
    delegationMetadataPdaFromDelegatedAccount,
    delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

export interface DelegateAgentAccounts {
    owner: PublicKey;
    agent: PublicKey;
    config: PublicKey;
    ownerProgram: PublicKey;
}

export const delegateAgentIx = async (
    program: anchor.Program<Contract>,
    payload: {
        accounts: DelegateAgentAccounts;
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
        .delegateAgent()
        .accountsPartial({
            owner: payload.accounts.owner,
            agent: payload.accounts.agent,
            config: payload.accounts.config,
            ownerProgram: payload.accounts.ownerProgram,
            delegationProgram: DELEGATION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            bufferAgent: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
                payload.accounts.agent,
                payload.accounts.ownerProgram,
            ),
            delegationMetadataAgent: delegationMetadataPdaFromDelegatedAccount(
                payload.accounts.agent,
            ),
            delegationRecordAgent: delegationRecordPdaFromDelegatedAccount(payload.accounts.agent),
        })
        .remainingAccounts(remainingAccounts)
        .instruction();
};
