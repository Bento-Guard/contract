import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
    appendPayloadIx,
    APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE,
    chunkAppendPayload,
    commitmentHashAsArray,
    delegateActionIx,
    encodeActionPayload,
    encryptForRelayer,
    finalizeActionBuildingIx,
    fromEncryptionKeyBytes,
    initActionIx,
    seeds,
    verdictActionIx,
} from "../../sdk";
import { Ctx, sendEr, sendL1, waitForErAccount } from "./_shared";

/**
 * Reusable building blocks for the agent-side action flow, shared by the
 * single-shot scripts and the stress loop so there is one source of truth.
 */

export interface SubmitActionInput {
    actionId: anchor.BN;
    prompt?: string;
    valueSol?: number;
    recipient?: PublicKey;
}

export interface SubmitActionResult {
    actionPda: PublicKey;
    encryptedBytes: number;
}

/**
 * Full submit pipeline for one action:
 *   init_action + delegate_action (one L1 tx) → encrypt → append × N (ER)
 *   → finalize_action_building (ER, commits Action + Agent back to L1).
 */
export const submitAction = async (
    ctx: Ctx,
    input: SubmitActionInput,
): Promise<SubmitActionResult> => {
    const config = await ctx.program.account.config.fetch(ctx.configPda);
    const relayerEncryptionKey = fromEncryptionKeyBytes(config.relayerEncryptionKey as number[]);

    const prompt = input.prompt ?? "Send 0.001 SOL to another wallet";
    const transferLamports = new anchor.BN(
        Math.floor((input.valueSol ?? 0.001) * LAMPORTS_PER_SOL),
    );
    const recipient = input.recipient ?? Keypair.generate().publicKey;

    const [actionPda] = PublicKey.findProgramAddressSync(
        seeds.action(ctx.agentPda, input.actionId),
        ctx.program.programId,
    );

    const transferIx = SystemProgram.transfer({
        fromPubkey: ctx.keys.agentWallet.publicKey,
        toPubkey: recipient,
        lamports: BigInt(transferLamports.toString()),
    });
    const message = new TransactionMessage({
        payerKey: ctx.keys.agentWallet.publicKey,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [transferIx],
    }).compileToV0Message();
    const txBytes = new VersionedTransaction(message).serialize();

    const plaintext = encodeActionPayload({ prompt, tx: txBytes });
    const encrypted = encryptForRelayer({ plaintext, relayerPublicKey: relayerEncryptionKey });
    const commitment = commitmentHashAsArray(plaintext);

    // 1) init + delegate (one L1 tx)
    const initIx = await initActionIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            agentWallet: ctx.keys.agentWallet.publicKey,
            agent: ctx.agentPda,
            action: actionPda,
            config: ctx.configPda,
        },
        params: {
            targetProgram: SystemProgram.programId,
            value: transferLamports,
            actionId: input.actionId,
            totalDataLen: encrypted.payload.length,
        },
    });
    const delegateIx = await delegateActionIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            agentWallet: ctx.keys.agentWallet.publicKey,
            agent: ctx.agentPda,
            action: actionPda,
            config: ctx.configPda,
            ownerProgram: ctx.program.programId,
        },
        validator: ctx.env.validator,
    });
    await sendL1(ctx, [initIx, delegateIx], [ctx.keys.relayer, ctx.keys.agentWallet]);
    await waitForErAccount(ctx, actionPda);

    // 2) append encrypted payload in chunks (ER)
    const chunks = chunkAppendPayload(encrypted.payload, {
        chunkSize: APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE,
    });
    for (const c of chunks) {
        const ix = await appendPayloadIx(ctx.program, {
            accounts: {
                relayer: ctx.keys.relayer.publicKey,
                agentWallet: ctx.keys.agentWallet.publicKey,
                agent: ctx.agentPda,
                action: actionPda,
                config: ctx.configPda,
            },
            params: { offset: c.offset, chunk: c.chunk },
        });
        await sendEr(ctx, [ix], [ctx.keys.relayer, ctx.keys.agentWallet]);
    }

    // 3) finalize (commit Action + Agent back to L1)
    const finalizeIx = await finalizeActionBuildingIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            agentWallet: ctx.keys.agentWallet.publicKey,
            agent: ctx.agentPda,
            action: actionPda,
            config: ctx.configPda,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
            magicFeeVault: ctx.magicFeeVault,
        },
        params: { commitmentHash: commitment },
    });
    await sendEr(ctx, [finalizeIx], [ctx.keys.relayer, ctx.keys.agentWallet]);

    return { actionPda, encryptedBytes: encrypted.payload.length };
};

export interface ApproveActionInput {
    actionId: anchor.BN;
    rawScore?: number;
}

/**
 * Relayer lands an approving verdict (raw_score below escalate_threshold) on a
 * Pending action and commits Action + Agent back to L1. Returns the ER txHash.
 */
export const approveAction = async (ctx: Ctx, input: ApproveActionInput): Promise<string> => {
    const [actionPda] = PublicKey.findProgramAddressSync(
        seeds.action(ctx.agentPda, input.actionId),
        ctx.program.programId,
    );
    const rawScore = input.rawScore ?? 0;
    const reasoningHash = commitmentHashAsArray(
        Buffer.from("auto-approved by flow helper", "utf8"),
    );

    const ix = await verdictActionIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            agent: ctx.agentPda,
            action: actionPda,
            config: ctx.configPda,
            magicFeeVault: ctx.magicFeeVault,
        },
        params: { rawScore, reasoningHash },
    });
    return sendEr(ctx, [ix], [ctx.keys.relayer]);
};
