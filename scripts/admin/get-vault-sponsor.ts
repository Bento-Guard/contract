import * as dotenv from "dotenv";
dotenv.config();

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { getProgram, seeds } from "../../sdk";

/**
 * Inspect the VaultSponsor PDA — the admin-owned account that pays the
 * MagicBlock commit fees for every commit handler.
 *
 * Commits are paid out of the VaultSponsor's **ER-side** balance (ER execution
 * is free; the bundle payer's lamports are debited there), so the ER balance is
 * the number to watch. The L1 balance only holds the account's rent. Top up the
 * ER balance with `topup-vault-sponsor.ts`.
 *
 * Env:
 *   SOLANA_RPC_URL     L1 base-layer RPC   (required)
 *   EPHEMERAL_RPC_URL  MagicBlock ER RPC   (default devnet ER)
 */
const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}
const erRpcUrl = process.env.EPHEMERAL_RPC_URL ?? "https://devnet.magicblock.app/";

const connection = new Connection(connectionStr, "confirmed");
const erConnection = new Connection(erRpcUrl, "confirmed");
const program = getProgram(connection);

const fmtSol = (lamports: number): string =>
    `${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL (${lamports} lamports)`;

(async () => {
    const [vaultSponsorPda] = PublicKey.findProgramAddressSync(
        seeds.vaultSponsor(),
        program.programId,
    );

    console.log("========================================");
    console.log("           Vault Sponsor");
    console.log("========================================");
    console.log(`  Program        : ${program.programId.toBase58()}`);
    console.log(`  Vault Sponsor  : ${vaultSponsorPda.toBase58()}`);
    console.log(`  L1 RPC         : ${connectionStr}`);
    console.log(`  ER RPC         : ${erRpcUrl}`);
    console.log("");

    const l1Info = await connection.getAccountInfo(vaultSponsorPda, "confirmed");
    if (!l1Info) {
        console.log("  ❌ VaultSponsor PDA does not exist on L1 — run init_vault_sponsor first.");
        return;
    }

    const delegated = l1Info.owner.equals(DELEGATION_PROGRAM_ID);
    console.log(`  L1 owner       : ${l1Info.owner.toBase58()}${delegated ? " (delegation program → delegated)" : ""}`);
    console.log(`  L1 balance     : ${fmtSol(l1Info.lamports)}`);

    // Decode the on-chain struct. While delegated, the L1 owner is the
    // delegation program, so the strict `program.account.vaultSponsor.fetch`
    // owner check fails — decode the raw bytes through the coder instead.
    try {
        const decoded = program.coder.accounts.decode("vaultSponsor", l1Info.data);
        console.log(`  Operator       : ${decoded.operator.toBase58()}`);
    } catch {
        console.log("  Operator       : <unable to decode>");
    }

    // ER-side balance — the one that actually pays commits.
    const erInfo = await erConnection.getAccountInfo(vaultSponsorPda, "confirmed");
    if (!erInfo) {
        console.log("");
        console.log("  ⚠️  Not visible on the ER yet (not delegated, or ER hasn't ingested it).");
        console.log("      Commits are paid from the ER balance — delegate + top up before use.");
        return;
    }
    console.log(`  ER balance     : ${fmtSol(erInfo.lamports)}  ← pays commit fees`);
})();
