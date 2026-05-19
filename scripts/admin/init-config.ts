import * as dotenv from "dotenv";
dotenv.config();

import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
} from "@solana/web3.js";
import operatorKeypairDevnetJson from "../../accounts/devnet/operator.json";
import { getProgram, initializeIx, InitializeParams, seeds, toEncryptionKeyBytes } from "../../sdk";

const MODE: "devnet" | "mainnet" = "devnet";

const operatorKeypair =
    MODE === "devnet"
        ? Keypair.fromSecretKey(Uint8Array.from(operatorKeypairDevnetJson))
        : Keypair.generate();

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const connection = new Connection(connectionStr);
const program = getProgram(connection);

(async () => {
    const params: InitializeParams = {
        relayer: new PublicKey("Aq7sQfpXbMj1BS8WVCU9pu1Fat7V63GqZ5vcwrEfnUcD"),
        relayerEncryptionKey: toEncryptionKeyBytes(
            Uint8Array.from([
                176, 56, 153, 250, 162, 177, 218, 176, 211, 183, 28, 232, 55, 178, 171, 171, 83,
                205, 206, 105, 229, 239, 207, 52, 37, 20, 141, 212, 203, 136, 31, 119,
            ]),
        ),
        escalateThreshold: 40_000,
        blockThreshold: 70_000,
        maxStrikes: 5,
        emaAlpha: 300,
        emaScale: 1_000,
    };

    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);

    const ix = await initializeIx(program, {
        accounts: {
            operator: operatorKeypair.publicKey,
            config: configPda,
        },
        params,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(operatorKeypair);
    const txHash = await sendAndConfirmTransaction(connection, tx, [operatorKeypair]);
    console.log(`Initialize txHash: ${txHash}`);
})();
