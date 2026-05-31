import * as dotenv from "dotenv";
dotenv.config();

import * as crypto from "crypto";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import {
    deriveRentPda,
    DELEGATION_PROGRAM_ID,
    initRentPdaIx,
    lamportsDelegatedTransferIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import operatorKeypairDevnetJson from "../../accounts/devnet/operator.json";
import { getProgram, seeds } from "../../sdk";

/**
 * Top up the VaultSponsor PDA's **ER-side** lamports so it can keep paying the
 * MagicBlock commit fees for every commit handler.
 *
 * ER execution is free, but commits are debited from the bundle payer's ER
 * balance. You can't `SystemProgram.transfer` to a delegated account and have
 * it show up on the ER — `lamportsDelegatedTransferIx` is the supported path:
 * it submits a base-layer tx that shuttles lamports onto the delegated balance
 * via a single-use escrow PDA. The escrow's delegation accounts must be
 * rent-exempt; the Ephemeral SPL Token program sponsors that rent from a global
 * rent PDA (seeds ["rent"]) which we initialize + fund first.
 *
 * Env:
 *   SOLANA_RPC_URL          L1 base-layer RPC                 (required)
 *   MODE                    devnet | mainnet                  (default devnet)
 *   VAULT_SPONSOR_TOPUP_SOL Amount to shuttle onto the ER     (default 0.1)
 */
const MODE: "devnet" | "mainnet" = (process.env.MODE as "devnet" | "mainnet") ?? "devnet";

const operatorKeypair =
    MODE === "devnet"
        ? Keypair.fromSecretKey(Uint8Array.from(operatorKeypairDevnetJson))
        : Keypair.generate();

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const TOPUP_SOL = Number(process.env.VAULT_SPONSOR_TOPUP_SOL ?? "0.1");
const TOPUP_LAMPORTS = Math.floor(TOPUP_SOL * LAMPORTS_PER_SOL);
// Generous buffer for the global rent PDA that sponsors escrow rent
// (~0.00089 SOL per shuttle). 0.05 SOL covers dozens of top-ups.
const RENT_PDA_FUND_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);

const connection = new Connection(connectionStr, "confirmed");
const program = getProgram(connection);

const fmtSol = (lamports: number): string =>
    `${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL`;

(async () => {
    const [vaultSponsorPda] = PublicKey.findProgramAddressSync(
        seeds.vaultSponsor(),
        program.programId,
    );

    console.log("========================================");
    console.log("        Top up Vault Sponsor");
    console.log("========================================");
    console.log(`  Operator       : ${operatorKeypair.publicKey.toBase58()}`);
    console.log(`  Vault Sponsor  : ${vaultSponsorPda.toBase58()}`);
    console.log(`  Amount         : ${fmtSol(TOPUP_LAMPORTS)}`);
    console.log("");

    // The destination must already be delegated — lamportsDelegatedTransferIx
    // reads its delegation record to route the lamports to the right ER.
    const info = await connection.getAccountInfo(vaultSponsorPda, "confirmed");
    if (!info) {
        throw new Error(
            "VaultSponsor PDA does not exist — run init_vault_sponsor + delegate_vault_sponsor first.",
        );
    }
    if (!info.owner.equals(DELEGATION_PROGRAM_ID)) {
        throw new Error(
            `VaultSponsor PDA is not delegated (owner=${info.owner.toBase58()}). ` +
                "Run delegate_vault_sponsor before topping up the ER balance.",
        );
    }

    // Pre-flight: operator must cover the shuttle amount + rent PDA funding + fees.
    const operatorBalance = await connection.getBalance(operatorKeypair.publicKey, "confirmed");
    const needed = TOPUP_LAMPORTS + RENT_PDA_FUND_LAMPORTS;
    if (operatorBalance < needed) {
        throw new Error(
            `Operator balance ${fmtSol(operatorBalance)} is below required ~${fmtSol(needed)}.`,
        );
    }

    // 1) Ensure the global Ephemeral SPL Token rent PDA exists and is funded so
    //    it can sponsor the escrow's rent. Without this the shuttle fails with
    //    "insufficient lamports … need 890880".
    const [rentPda] = deriveRentPda();
    const rentInfo = await connection.getAccountInfo(rentPda, "confirmed");
    const rentTx = new Transaction();
    if (!rentInfo || rentInfo.data.length === 0) {
        rentTx.add(initRentPdaIx(operatorKeypair.publicKey, rentPda));
    }
    rentTx.add(
        SystemProgram.transfer({
            fromPubkey: operatorKeypair.publicKey,
            toPubkey: rentPda,
            lamports: RENT_PDA_FUND_LAMPORTS,
        }),
    );
    rentTx.feePayer = operatorKeypair.publicKey;
    const rentSig = await sendAndConfirmTransaction(connection, rentTx, [operatorKeypair], {
        commitment: "confirmed",
    });
    console.log(`  Funded rent PDA ${rentPda.toBase58()} (${fmtSol(RENT_PDA_FUND_LAMPORTS)}) → ${rentSig}`);

    // 2) Shuttle lamports onto the VaultSponsor's delegated (ER) balance.
    //    Fresh 32-byte salt per call so the single-use escrow PDA never collides.
    const salt = crypto.randomBytes(32);
    const topupIx = lamportsDelegatedTransferIx(
        operatorKeypair.publicKey,
        vaultSponsorPda,
        BigInt(TOPUP_LAMPORTS),
        salt,
    );
    const tx = new Transaction().add(topupIx);
    tx.feePayer = operatorKeypair.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [operatorKeypair], {
        commitment: "confirmed",
        skipPreflight: true,
    });
    console.log(`  Top-up txHash  : ${sig}`);
    console.log("");
    console.log("  ✅ Done. The ER credits the VaultSponsor's delegated balance shortly.");
    console.log("     Verify with `get-vault-sponsor.ts` (ER balance).");
})();
