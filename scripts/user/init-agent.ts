import * as anchor from "@coral-xyz/anchor";
import { delegateAgentIx, registerAgentIx, RegisterAgentParams } from "../../sdk";
import {
    assertRelayerMatchesConfig,
    buildCtx,
    printHeader,
    sendL1,
    solEnvToLamports,
    topupAgentErBalance,
    waitForErAccount,
} from "./_shared";

/**
 * Init Agent — register_agent + delegate_agent in a SINGLE L1 transaction.
 *
 * Signers: relayer (must equal config.relayer) + owner. The agent-wallet is a
 * plain SystemAccount here (not a signer); its pubkey seeds the Agent PDA.
 * After this tx the Agent PDA is delegated to the ER for its whole lifecycle.
 *
 * Env knobs (besides the shared ones in _shared.ts):
 *   SPEND_LIMIT   per-action spend limit in lamports (default 1000)
 *
 * Run: SOLANA_RPC_URL=... npx tsx scripts/user/init-agent.ts
 */
const main = async () => {
    const ctx = buildCtx();
    printHeader(ctx, "Init Agent (register + delegate)");
    await assertRelayerMatchesConfig(ctx);

    // Idempotency guard: registering an existing agent PDA fails with the
    // "already in use" allocation error — surface that up front.
    const existing = await ctx.connection.getAccountInfo(ctx.agentPda, "confirmed");
    if (existing) {
        console.log(
            `\nAgent PDA ${ctx.agentPda.toBase58()} already exists (owner ${existing.owner.toBase58()}).`,
        );
        console.log(
            "Nothing to do — reuse this agent for submit-action, or use a new AGENT_WALLET_KEYPAIR_PATH.",
        );
        return;
    }

    const spendLimit = new anchor.BN(process.env.SPEND_LIMIT ?? "1000");
    const params: RegisterAgentParams = { spendLimit };
    console.log(`\n  Spend limit      : ${spendLimit.toString()} lamports`);

    const registerIx = await registerAgentIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            owner: ctx.keys.owner.publicKey,
            agentWallet: ctx.keys.agentWallet.publicKey,
            agent: ctx.agentPda,
            config: ctx.configPda,
        },
        params,
    });

    const delegateIx = await delegateAgentIx(ctx.program, {
        accounts: {
            relayer: ctx.keys.relayer.publicKey,
            owner: ctx.keys.owner.publicKey,
            agent: ctx.agentPda,
            config: ctx.configPda,
            ownerProgram: ctx.program.programId,
        },
        validator: ctx.env.validator,
    });

    const txHash = await sendL1(ctx, [registerIx, delegateIx], [ctx.keys.relayer, ctx.keys.owner]);
    console.log(`\n  register + delegate txHash: ${txHash}`);

    // Wait until the ER ingests the freshly-delegated Agent PDA so the next
    // step (submit-action) can read/write it immediately.
    await waitForErAccount(ctx, ctx.agentPda);
    console.log("  Agent PDA is live on the ER ✓");

    // Fund the Agent PDA's ER balance so it can self-pay for commits back to L1
    // (finalize_action_building, verdict_action, …) without relying on the
    // shared magic_fee_vault or the limited per-account commit sponsorship.
    // Set AGENT_TOPUP_SOL=0 to skip. See topupAgentErBalance in _shared.ts.
    const topupLamports = solEnvToLamports(process.env.AGENT_TOPUP_SOL, "0.02");
    if (topupLamports > 0) {
        const sig = await topupAgentErBalance(ctx, topupLamports);
        console.log(
            `  Topped up Agent ER balance with ${(topupLamports / 1e9).toFixed(4)} SOL → ${sig}`,
        );
    } else {
        console.log("  Skipped Agent ER top-up (AGENT_TOPUP_SOL=0)");
    }

    const agent = await ctx.program.account.agent.fetch(ctx.agentPda).catch(() => undefined);
    if (agent) {
        console.log(`  active           : ${agent.active}`);
        console.log(`  spend_limit      : ${agent.spendLimit.toString()}`);
    }
    console.log("\nDone. Agent is registered and delegated to the ER.");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
