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
import {
    getProgram,
    seeds,
    updateConfigIx,
    UpdateConfigParams,
} from "../../sdk";

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
    const params: UpdateConfigParams = {
        emaAlpha: 700,
        blockThreshold: null,
        emaScale: null,
        escalateThreshold: null,
        maxStrikes: null,
        relayer: null,
        relayerEncryptionKey: null,
    };

    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);

    const ix = await updateConfigIx(program, {
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
    console.log(`Update config txHash: ${txHash}`);
})();
