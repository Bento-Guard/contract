import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Contract } from "../../../target/types/contract";

export interface UpdateConfigAccounts {
    operator: PublicKey;
    config: PublicKey;
}

export interface UpdateConfigParams {
    relayer: PublicKey | null;
    relayerEncryptionKey: number[] | null;
    escalateThreshold: number | null;
    blockThreshold: number | null;
    maxStrikes: number | null;
    emaAlpha: number | null;
    emaScale: number | null;
}

export const updateConfigIx = async (
    program: anchor.Program<Contract>,
    payload: {
        accounts: UpdateConfigAccounts;
        params: UpdateConfigParams;
    },
): Promise<TransactionInstruction> => {
    return await program.methods
        .updateConfig({
            relayer: payload.params.relayer,
            relayerEncryptionKey: payload.params.relayerEncryptionKey,
            escalateThreshold: payload.params.escalateThreshold,
            blockThreshold: payload.params.blockThreshold,
            maxStrikes: payload.params.maxStrikes,
            emaAlpha: payload.params.emaAlpha,
            emaScale: payload.params.emaScale,
        })
        .accountsPartial({
            operator: payload.accounts.operator,
            config: payload.accounts.config,
        })
        .instruction();
};
