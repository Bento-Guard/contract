import * as dotenv from "dotenv";
dotenv.config();

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
} from "@solana/web3.js";
import {
    deriveLamportsPda,
    lamportsDelegatedTransferIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import operatorKeypairDevnetJson from "../../accounts/devnet/operator.json";
import { getProgram, seeds } from "../../sdk";

/**
 * Tops up an Agent PDA's ER-side lamports so it can act as the bundle payer for
 * commits. ER execution is free, but commits are paid by their delegated payer,
 * which must hold lamports ABOVE its rent-exempt minimum. Every Bento commit
 * handler (finalize_action_building, verdict_action, active/deactivate_agent,
 * update_agent_program_target) uses the Agent PDA as that payer.
 *
 * This submits a BASE-LAYER transaction via the Ephemeral SPL Token program;
 * the lamports are shuttled through a single-use PDA and credited to the
 * Agent's delegated balance on the ER.
 *
 * The Agent must already be delegated (register_agent + delegate_agent) before
 * this runs — the instruction reads its delegation record to route the funds.
 *
 * Required env:
 *   SOLANA_RPC_URL   Base-layer RPC (devnet/mainnet).
 *   AGENT_WALLET     The agent wallet pubkey whose Agent PDA is topped up.
 *
 * Optional env:
 *   AMOUNT_SOL       Defaults to 0.05.
 *   FUNDER_KEYPAIR   Path to keypair JSON funding the transfer. Defaults to the
 *                    bundled devnet operator. Point at the relayer keypair to
 *                    fund from there.
 */

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const agentWalletStr = process.env.AGENT_WALLET;
if (!agentWalletStr) {
    throw new Error("AGENT_WALLET env is required — the agent wallet pubkey");
}

const amountSolStr = process.env.AMOUNT_SOL ?? "0.05";
const amountLamports = Math.floor(parseFloat(amountSolStr) * LAMPORTS_PER_SOL);
if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
    throw new Error(`Invalid AMOUNT_SOL=${amountSolStr}`);
}

const funderKeypair = (() => {
    const customPath = process.env.FUNDER_KEYPAIR;
    if (!customPath) {
        return Keypair.fromSecretKey(Uint8Array.from(operatorKeypairDevnetJson));
    }
    const resolved = customPath.startsWith("~")
        ? path.join(os.homedir(), customPath.slice(1))
        : customPath;
    const json = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(json));
})();

const connection = new Connection(connectionStr, "confirmed");

(async () => {
    const agentWallet = new PublicKey(agentWalletStr);
    const program = getProgram(connection);
    const [agentPda] = PublicKey.findProgramAddressSync(
        seeds.agent(agentWallet),
        program.programId,
    );

    // The destination must be delegated; bail early with a clear message if not.
    const agentInfo = await connection.getAccountInfo(agentPda, "confirmed");
    if (!agentInfo) {
        throw new Error(`Agent PDA ${agentPda.toBase58()} not found — register the agent first`);
    }

    const funderBalance = await connection.getBalance(funderKeypair.publicKey, "confirmed");
    if (funderBalance <= amountLamports) {
        throw new Error(
            `Funder ${funderKeypair.publicKey.toBase58()} has ${(funderBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
                `needs > ${(amountLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL (amount + fees)`,
        );
    }

    // Fresh 32-byte salt per top-up — a repeated (payer, destination, salt)
    // triple collides with an existing single-use lamports PDA and fails.
    const salt = crypto.randomBytes(32);
    const [lamportsPda] = deriveLamportsPda(funderKeypair.publicKey, agentPda, salt);

    console.log("Agent top-up plan");
    console.log(`  Agent wallet      : ${agentWallet.toBase58()}`);
    console.log(`  Agent PDA (dest)  : ${agentPda.toBase58()}`);
    console.log(`  Lamports PDA      : ${lamportsPda.toBase58()}`);
    console.log(`  Transferring      : ${(amountLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`  From funder       : ${funderKeypair.publicKey.toBase58()}`);

    const ix = lamportsDelegatedTransferIx(
        funderKeypair.publicKey,
        agentPda,
        BigInt(amountLamports),
        salt,
    );

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = funderKeypair.publicKey;
    tx.sign(funderKeypair);

    // CRITICAL: base-layer connection. The lamports are credited to the agent's
    // delegated balance on the ER as part of the delegation flow.
    const sig = await sendAndConfirmTransaction(connection, tx, [funderKeypair], {
        commitment: "confirmed",
        skipPreflight: true,
    });
    console.log(`\nTop-up txHash       : ${sig}`);
    console.log("The lamports will land on the Agent's ER-side balance.");
})();
