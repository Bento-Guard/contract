import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import operatorKeypairDevnetJson from "../../accounts/devnet/operator.json";
import { deriveMagicFeeVault, seeds, getProgram } from "../../sdk";

/**
 * Tops up the canonical `magic_fee_vault` PDA so the contract's commit
 * handlers can keep paying for ER → base-layer commits past the default
 * 10-commit sponsorship cap.
 *
 * Required env:
 *   SOLANA_RPC_URL   Base-layer RPC (devnet/mainnet).
 *   AGENT_WALLET     A delegated agent wallet pubkey; used to read the
 *                    validator out of the delegation record and derive the
 *                    canonical magic_fee_vault PDA. All agents delegated to
 *                    the same validator share this vault, so one top-up
 *                    benefits the whole fleet.
 *
 * Optional env:
 *   AMOUNT_SOL       Defaults to 0.5.
 *   FUNDER_KEYPAIR   Path to the keypair JSON funding the transfer. Defaults
 *                    to the bundled devnet operator at
 *                    accounts/devnet/operator.json. Point this at the relayer
 *                    keypair (e.g. ~/.config/solana/relayer.json) to fund
 *                    from the relayer wallet instead.
 *
 * Example:
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   AGENT_WALLET=9zBtbQtsq3vfjHwmuxVRWdVyHChh2CTNb8MiVXmJvPfA \
 *   AMOUNT_SOL=1 \
 *   FUNDER_KEYPAIR=~/.config/solana/relayer.json \
 *   yarn ts-node scripts/admin/topup-fee-vault.ts
 */

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const agentWalletStr = process.env.AGENT_WALLET;
if (!agentWalletStr) {
    throw new Error(
        "AGENT_WALLET env is required — a delegated agent wallet pubkey used to derive the validator",
    );
}

const amountSolStr = process.env.AMOUNT_SOL ?? "0.5";
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
const program = getProgram(connection);

(async () => {
    const agentWallet = new PublicKey(agentWalletStr);
    const [agentPda] = PublicKey.findProgramAddressSync(
        seeds.agent(agentWallet),
        program.programId,
    );

    const { magicFeeVault, validator } = await deriveMagicFeeVault(connection, agentPda);

    const before = await connection.getBalance(magicFeeVault, "confirmed");

    console.log("Top-up plan");
    console.log(`  Agent wallet      : ${agentWallet.toBase58()}`);
    console.log(`  Agent PDA         : ${agentPda.toBase58()}`);
    console.log(`  Validator         : ${validator.toBase58()}`);
    console.log(`  Magic fee vault   : ${magicFeeVault.toBase58()}`);
    console.log(`  Balance before    : ${(before / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`  Transferring      : ${(amountLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`  From funder       : ${funderKeypair.publicKey.toBase58()}`);

    const ix = SystemProgram.transfer({
        fromPubkey: funderKeypair.publicKey,
        toPubkey: magicFeeVault,
        lamports: amountLamports,
    });

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = funderKeypair.publicKey;
    tx.sign(funderKeypair);

    const sig = await sendAndConfirmTransaction(connection, tx, [funderKeypair], {
        commitment: "confirmed",
    });
    console.log(`\nTop-up txHash       : ${sig}`);

    const after = await connection.getBalance(magicFeeVault, "confirmed");
    console.log(`Balance after       : ${(after / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
})();
