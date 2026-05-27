import * as dotenv from "dotenv";
dotenv.config();

import { Connection, PublicKey } from "@solana/web3.js";
import { getProgram, seeds } from "../../sdk";

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const connection = new Connection(connectionStr);
const program = getProgram(connection);

(async () => {
    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);

    const config = await program.account.config.fetch(configPda);
    console.log("🚀 ~ config:", config);
})();
