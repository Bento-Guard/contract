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
    countAppendPayloadTxs,
    delegateActionIx,
    encodeActionPayload,
    encryptForRelayer,
    finalizeActionBuildingIx,
    fromEncryptionKeyBytes,
    initActionIx,
    seeds,
} from "../../sdk";
import {
    assertRelayerMatchesConfig,
    buildCtx,
    Ctx,
    printHeader,
    sendEr,
    sendL1,
    waitForErAccount,
} from "./_shared";

/**
 * Submit Action — the full agent-side `protect()` pipeline:
 *
 *   1. init_action + delegate_action   (ONE L1 transaction)
 *   2. encrypt (user prompt + serialized TX) to the relayer's x25519 key
 *   3. append_payload  × N             (ER, sequential chunks)
 *   4. finalize_action_building        (ER, commit Action + Agent back to L1)
 *
 * Signers throughout: relayer (== config.relayer) + agent-wallet.
 * Prerequisite: the agent must already be registered + delegated
 * (run init-agent.ts first with the same agent-wallet keypair).
 *
 * Env knobs (besides the shared ones in _shared.ts):
 *   ACTION_ID    u64 action id, must be unused for this agent (default: now-ms)
 *   PROMPT       user prompt string (default: a sample transfer prompt)
 *   VALUE_SOL    amount the encoded transfer moves, in SOL (default: 0.001)
 *   RECIPIENT    transfer recipient pubkey (default: a random throwaway)
 *
 * Run: SOLANA_RPC_URL=... npx tsx scripts/user/submit-action.ts
 */
const main = async () => {
    const ctx = buildCtx();
    printHeader(ctx, "Submit Action (init+delegate → append → finalize)");
    await assertRelayerMatchesConfig(ctx);

    // The agent must exist and be delegated before we can attach an action.
    const agentInfo = await ctx.connection.getAccountInfo(ctx.agentPda, "confirmed");
    if (!agentInfo) {
        throw new Error(
            `Agent PDA ${ctx.agentPda.toBase58()} not found. Run init-agent.ts first ` +
                `with the same agent-wallet keypair.`,
        );
    }

    const config = await ctx.program.account.config.fetch(ctx.configPda);
    const relayerEncryptionKey = fromEncryptionKeyBytes(config.relayerEncryptionKey as number[]);

    // ── Build the action input ──────────────────────────────────────────────
    const actionId = new anchor.BN(process.env.ACTION_ID ?? Date.now().toString());
    const prompt = process.env.PROMPT ?? "Send 0.001 SOL to another wallet";
    const valueSol = parseFloat(process.env.VALUE_SOL ?? "0.001");
    const transferLamports = new anchor.BN(Math.floor(valueSol * LAMPORTS_PER_SOL));
    const recipient = process.env.RECIPIENT
        ? new PublicKey(process.env.RECIPIENT)
        : Keypair.generate().publicKey;

    const [actionPda] = PublicKey.findProgramAddressSync(
        seeds.action(ctx.agentPda, actionId),
        ctx.program.programId,
    );

    // The protected transaction the agent intends to broadcast AFTER approval.
    // Built as a v0 message the relayer can deserialize as-is (blockhash is a
    // placeholder — the agent re-fetches a fresh one before broadcasting).
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

    // Encrypt (prompt + serialized tx) to the relayer; commitment = blake3 of
    // the plaintext, supplied at finalize so the relayer can detect tampering.
    const plaintext = encodeActionPayload({ prompt, tx: txBytes });
    const encrypted = encryptForRelayer({ plaintext, relayerPublicKey: relayerEncryptionKey });
    const commitment = commitmentHashAsArray(plaintext);

    console.log("\n  ----- Action input -----");
    console.log(`  Action PDA       : ${actionPda.toBase58()}`);
    console.log(`  Action ID        : ${actionId.toString()}`);
    console.log(`  Prompt           : ${prompt}`);
    console.log(`  Recipient        : ${recipient.toBase58()}`);
    console.log(`  Transfer         : ${transferLamports.toString()} lamports`);
    console.log(`  Plaintext bytes  : ${plaintext.length}`);
    console.log(`  Encrypted bytes  : ${encrypted.payload.length}`);

    // ── Step 1: init_action + delegate_action (ONE L1 transaction) ───────────
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
            actionId,
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

    const initHash = await sendL1(
        ctx,
        [initIx, delegateIx],
        [ctx.keys.relayer, ctx.keys.agentWallet],
    );
    console.log(`\n  [1/3] init + delegate action txHash: ${initHash}`);

    await waitForErAccount(ctx, actionPda);
    console.log("        Action PDA is live on the ER ✓");

    // ── Step 2: append the encrypted payload in chunks (ER) ──────────────────
    const chunks = chunkAppendPayload(encrypted.payload, {
        chunkSize: APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE,
    });
    const expected = countAppendPayloadTxs(encrypted.payload.length, {
        chunkSize: APPEND_PAYLOAD_DEFAULT_CHUNK_SIZE,
    });
    console.log(`\n  [2/3] appending ${chunks.length} chunk(s) (expected ${expected})`);
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
        const sig = await sendEr(ctx, [ix], [ctx.keys.relayer, ctx.keys.agentWallet]);
        console.log(`        offset=${c.offset} len=${c.chunk.length} → ${sig}`);
    }

    // ── Step 3: finalize (store commitment, status → Pending, commit to L1) ──
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
    const finalizeHash = await sendEr(ctx, [finalizeIx], [ctx.keys.relayer, ctx.keys.agentWallet]);
    console.log(`\n  [3/3] finalize_action_building txHash (ER): ${finalizeHash}`);

    await printActionState(ctx, actionPda);
    console.log("\nDone. Action is Pending and committed back to L1 — awaiting relayer verdict.");
};

const printActionState = async (ctx: Ctx, actionPda: PublicKey): Promise<void> => {
    try {
        const action = await ctx.program.account.action.fetch(actionPda);
        console.log("\n  ----- On-chain action state -----");
        console.log(`  status           : ${action.status}`);
        console.log(`  data_len         : ${action.dataLen}`);
        console.log(`  data_written     : ${action.dataWritten}`);
    } catch {
        console.log("  (action state not yet readable on L1 — commit may still be propagating)");
    }
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
