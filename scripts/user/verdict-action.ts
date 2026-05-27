import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { commitmentHashAsArray, seeds, verdictActionIx } from "../../sdk";
import { assertRelayerMatchesConfig, buildCtx, printHeader, sendEr } from "./_shared";

/**
 * Verdict Action — relayer lands a verdict on a Pending action (ER).
 *
 * For now this always APPROVES: it submits a raw_score below the config's
 * escalate_threshold, which the program maps to Approved (no strike). Use it to
 * exercise the verdict + commit-back-to-L1 path (e.g. the insufficient-fund /
 * fee-vault issue) without wiring up the real relayer scoring.
 *
 * Signer: relayer only (must equal config.relayer). The `#[commit]` macro
 * auto-resolves the magic program/context; we only pass the fee vault.
 *
 * Env knobs (besides the shared ones in _shared.ts):
 *   ACTION_ID    u64 action id to rule on (REQUIRED — same id used at submit)
 *   RAW_SCORE    override the score (default 0 → Approved). Keep it below
 *                escalate_threshold to stay on the "pass" path.
 *
 * Run: SOLANA_RPC_URL=... ACTION_ID=... npx ts-node scripts/user/verdict-action.ts
 */
const main = async () => {
    const ctx = buildCtx();
    printHeader(ctx, "Verdict Action (approve / pass)");
    await assertRelayerMatchesConfig(ctx);

    if (!process.env.ACTION_ID) {
        throw new Error("ACTION_ID env is required (the action id you used at submit-action).");
    }
    const actionId = new anchor.BN(process.env.ACTION_ID);
    const [actionPda] = PublicKey.findProgramAddressSync(
        seeds.action(ctx.agentPda, actionId),
        ctx.program.programId,
    );

    // raw_score < escalate_threshold → Approved. Default 0; clamp the override
    // so this script never accidentally escalates/blocks.
    const config = await ctx.program.account.config.fetch(ctx.configPda);
    const rawScore = Number(process.env.RAW_SCORE ?? "0");
    if (rawScore >= config.escalateThreshold) {
        throw new Error(
            `RAW_SCORE=${rawScore} would not pass — must be < escalate_threshold ` +
                `(${config.escalateThreshold}). Lower it to approve.`,
        );
    }

    const reasoningHash = commitmentHashAsArray(
        Buffer.from("auto-approved by verdict script", "utf8"),
    );

    console.log(`\n  Action PDA       : ${actionPda.toBase58()}`);
    console.log(`  Action ID        : ${actionId.toString()}`);
    console.log(
        `  Raw score        : ${rawScore} (escalate_threshold ${config.escalateThreshold})`,
    );

    // Sanity-check the action is Pending on the ER before we try (the handler
    // requires it; this gives a clearer message than the on-chain error).
    const before = await ctx.program.account.action.fetch(actionPda).catch(() => undefined);
    if (before) {
        console.log(`  Current status   : ${before.status} (1 = Pending, expected)`);
    }

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

    const txHash = await sendEr(ctx, [ix], [ctx.keys.relayer]);
    console.log(`\n  verdict_action txHash (ER): ${txHash}`);

    const action = await ctx.program.account.action.fetch(actionPda).catch(() => undefined);
    if (action) {
        console.log(`\n  status           : ${action.status} (2 = Approved)`);
        console.log(`  decision         : ${action.decision}`);
        console.log(`  raw_score        : ${action.rawScore}`);
    }
    console.log("\nDone. Action approved and committed back to L1.");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
