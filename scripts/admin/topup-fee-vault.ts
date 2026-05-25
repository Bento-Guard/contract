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
import { magicFeeVaultPdaFromValidator } from "@magicblock-labs/ephemeral-rollups-sdk";

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
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
// https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup
const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"); // Asia

(async () => {
    const magicFeeVault = magicFeeVaultPdaFromValidator(validator);

    const before = await connection.getBalance(magicFeeVault, "confirmed");

    console.log("Top-up plan");
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
