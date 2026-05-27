import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assertRelayerMatchesConfig, buildCtx, printHeader } from "./_shared";
import { approveAction, submitAction } from "./flow";

/**
 * Stress the full flow: submit_action → verdict (approve), repeated N times on
 * the SAME agent. Every commit-to-L1 (finalize + verdict = 2 per run) is the
 * place the "insufficient funds" error shows up once the per-account commit
 * sponsorship is exhausted and the magic_fee_vault / Agent ER balance can't
 * cover it — so a long loop is the way to surface it.
 *
 * Errors are caught per-step and logged (with on-chain logs when available);
 * the loop keeps going so you see exactly which run/step fails and how many
 * succeed before it does.
 *
 * Prereq: the agent (agent-wallet keypair) must already be registered +
 * delegated (run init-agent.ts first).
 *
 * Env knobs (besides the shared ones in _shared.ts):
 *   RUNS         iterations (default 10)
 *   VALUE_SOL    transfer amount encoded per action (default 0.001)
 *
 * Run: SOLANA_RPC_URL=... npx ts-node scripts/user/stress-flow.ts
 */

interface StepFailure {
    run: number;
    step: "submit" | "verdict";
    actionId: string;
    message: string;
    logs?: string[];
}

const describeError = async (err: any): Promise<{ message: string; logs?: string[] }> => {
    const message = err?.transactionMessage ?? err?.message ?? String(err);
    // SendTransactionError carries logs; with skipPreflight they may be absent,
    // so try the async getLogs() accessor when present.
    let logs: string[] | undefined = err?.logs ?? err?.transactionLogs ?? undefined;
    if (!logs && typeof err?.getLogs === "function") {
        try {
            logs = await err.getLogs();
        } catch {
            /* ignore */
        }
    }
    return { message, logs: logs && logs.length ? logs : undefined };
};

const main = async () => {
    const ctx = buildCtx();
    printHeader(ctx, "Stress flow (submit + verdict ×N)");
    await assertRelayerMatchesConfig(ctx);

    const agentInfo = await ctx.connection.getAccountInfo(ctx.agentPda, "confirmed");
    if (!agentInfo) {
        throw new Error(
            `Agent PDA ${ctx.agentPda.toBase58()} not found. Run init-agent.ts first ` +
                `with the same agent-wallet keypair.`,
        );
    }

    const runs = Number(process.env.RUNS ?? "10");
    const valueSol = parseFloat(process.env.VALUE_SOL ?? "0.001");
    const base = Date.now(); // unique, monotonic action ids across the loop
    console.log(`\n  Runs             : ${runs}`);
    console.log(`  Action id base   : ${base}`);

    const relayerStart = await ctx.connection.getBalance(ctx.keys.relayer.publicKey, "confirmed");
    const vaultStart = await ctx.connection.getBalance(ctx.magicFeeVault, "confirmed");
    console.log(`  Relayer start    : ${(relayerStart / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`  Fee vault start  : ${(vaultStart / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    const failures: StepFailure[] = [];
    let submitOk = 0;
    let verdictOk = 0;

    for (let i = 0; i < runs; i++) {
        const actionId = new anchor.BN(base + i);
        const tag = `[run ${i + 1}/${runs}] action ${actionId.toString()}`;

        try {
            const { actionPda, encryptedBytes } = await submitAction(ctx, { actionId, valueSol });
            submitOk += 1;
            console.log(`${tag} submit ✓ (action ${actionPda.toBase58()}, ${encryptedBytes}B)`);
        } catch (err) {
            const { message, logs } = await describeError(err);
            failures.push({
                run: i + 1,
                step: "submit",
                actionId: actionId.toString(),
                message,
                logs,
            });
            console.error(`${tag} submit ✗ ${message}`);
            if (logs) logs.forEach((l) => console.error(`        ${l}`));
            continue; // no point verdicting an action that never finalized
        }

        try {
            const sig = await approveAction(ctx, { actionId });
            verdictOk += 1;
            console.log(`${tag} verdict ✓ ${sig}`);
        } catch (err) {
            const { message, logs } = await describeError(err);
            failures.push({
                run: i + 1,
                step: "verdict",
                actionId: actionId.toString(),
                message,
                logs,
            });
            console.error(`${tag} verdict ✗ ${message}`);
            if (logs) logs.forEach((l) => console.error(`        ${l}`));
        }
    }

    const relayerEnd = await ctx.connection.getBalance(ctx.keys.relayer.publicKey, "confirmed");
    const vaultEnd = await ctx.connection.getBalance(ctx.magicFeeVault, "confirmed");

    console.log("\n========================================");
    console.log("  Summary");
    console.log("========================================");
    console.log(`  submit  : ${submitOk}/${runs} ok`);
    console.log(`  verdict : ${verdictOk}/${runs} ok`);
    console.log(`  failures: ${failures.length}`);
    console.log(
        `  relayer spent : ${((relayerStart - relayerEnd) / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
    );
    console.log(
        `  fee vault delta: ${((vaultEnd - vaultStart) / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
    );
    if (failures.length) {
        console.log("\n  Failures:");
        for (const f of failures) {
            console.log(`   - run ${f.run} ${f.step} (action ${f.actionId}): ${f.message}`);
        }
        process.exitCode = 1;
    } else {
        console.log("\n  No errors — full flow passed all runs.");
    }
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
