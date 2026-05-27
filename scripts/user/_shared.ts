import * as dotenv from "dotenv";
dotenv.config();

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import {
    deriveLamportsPda,
    lamportsDelegatedTransferIx,
    magicFeeVaultPdaFromValidator,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { getProgram, seeds } from "../../sdk";
import { Contract } from "../../target/types/contract";

/**
 * Shared configuration + helpers for the user-facing flow scripts
 * (init-agent, submit-action). Everything that changes between localnet /
 * devnet / mainnet is read from env so the same script can target any cluster:
 *
 *   SOLANA_RPC_URL          L1 base-layer RPC            (required)
 *   EPHEMERAL_RPC_URL       MagicBlock ER RPC            (default devnet ER)
 *   EPHEMERAL_WS_URL        MagicBlock ER websocket      (default devnet ER)
 *   MODE                    devnet | mainnet             (default devnet)
 *   VALIDATOR               ER validator pubkey          (default Asia)
 *
 * Keypairs are loaded from accounts/<MODE>/ JSON files. Paths can be
 * overridden individually:
 *
 *   RELAYER_KEYPAIR_PATH       (default accounts/<mode>/relayer.json)
 *   OWNER_KEYPAIR_PATH         (default accounts/<mode>/owner.json)
 *   AGENT_WALLET_KEYPAIR_PATH  (default accounts/<mode>/agent-wallet.json)
 *
 * The relayer keypair MUST match config.relayer (it co-signs every
 * instruction); owner / agent-wallet are auto-generated and persisted on
 * first run so reruns reuse the same agent PDA.
 */

export type Mode = "devnet" | "mainnet";

const REPO_ROOT = path.resolve(__dirname, "../..");

// MagicBlock devnet ER endpoints — same defaults the test suite falls back to.
const DEFAULT_ER_RPC = "https://devnet.magicblock.app/";
const DEFAULT_ER_WS = "wss://devnet.magicblock.app/";

// Default ER validator (Asia). The magic_fee_vault PDA is derived from this,
// and `topup-fee-vault.ts` funds the same one — keep them in sync.
const DEFAULT_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

export interface UserEnv {
    mode: Mode;
    rpcUrl: string;
    erRpcUrl: string;
    erWsUrl: string;
    validator: PublicKey;
    accountsDir: string;
}

export const loadEnv = (): UserEnv => {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL env is required");

    const mode = (process.env.MODE ?? "devnet") as Mode;
    if (mode !== "devnet" && mode !== "mainnet") {
        throw new Error(`MODE must be "devnet" or "mainnet", got "${mode}"`);
    }

    return {
        mode,
        rpcUrl,
        erRpcUrl: process.env.EPHEMERAL_RPC_URL ?? DEFAULT_ER_RPC,
        erWsUrl: process.env.EPHEMERAL_WS_URL ?? DEFAULT_ER_WS,
        validator: new PublicKey(process.env.VALIDATOR ?? DEFAULT_VALIDATOR),
        accountsDir: path.join(REPO_ROOT, "accounts", mode),
    };
};

const resolvePath = (p: string): string =>
    p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(REPO_ROOT, p);

/** Read a Solana CLI keypair JSON (`number[]`) into a Keypair. */
const readKeypair = (file: string): Keypair =>
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));

/**
 * Load a keypair from `file`. When `generateIfMissing` is true and the file
 * does not exist, a fresh keypair is created, written to disk, and returned —
 * used for owner / agent-wallet so reruns are stable. The relayer keypair is
 * never generated (it must match the on-chain config.relayer).
 */
export const loadKeypair = (
    file: string,
    opts: { generateIfMissing?: boolean; label?: string } = {},
): Keypair => {
    const resolved = resolvePath(file);
    if (fs.existsSync(resolved)) return readKeypair(resolved);

    if (!opts.generateIfMissing) {
        throw new Error(
            `${opts.label ?? "keypair"} not found at ${resolved}. ` +
                `Place the secret-key JSON there (e.g. \`solana-keygen new -o ${resolved}\`).`,
        );
    }

    const kp = Keypair.generate();
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`  ↳ generated new ${opts.label ?? "keypair"} → ${resolved}`);
    return kp;
};

export interface UserKeypairs {
    relayer: Keypair;
    owner: Keypair;
    agentWallet: Keypair;
}

/** Load the relayer (required), owner and agent-wallet (auto-generated) keys. */
export const loadKeypairs = (env: UserEnv): UserKeypairs => {
    const relayerPath =
        process.env.RELAYER_KEYPAIR_PATH ?? path.join(env.accountsDir, "relayer.json");
    const ownerPath = process.env.OWNER_KEYPAIR_PATH ?? path.join(env.accountsDir, "owner.json");
    const agentWalletPath =
        process.env.AGENT_WALLET_KEYPAIR_PATH ?? path.join(env.accountsDir, "agent-wallet.json");

    return {
        relayer: loadKeypair(relayerPath, { label: "relayer keypair" }),
        owner: loadKeypair(ownerPath, { generateIfMissing: true, label: "owner keypair" }),
        agentWallet: loadKeypair(agentWalletPath, {
            generateIfMissing: true,
            label: "agent-wallet keypair",
        }),
    };
};

export interface Ctx {
    env: UserEnv;
    keys: UserKeypairs;
    connection: Connection; // L1 base layer
    erConnection: Connection; // MagicBlock ER
    program: anchor.Program<Contract>;
    configPda: PublicKey;
    agentPda: PublicKey;
    magicFeeVault: PublicKey;
}

/** Build the full runtime context (connections, program, PDAs) used by scripts. */
export const buildCtx = (): Ctx => {
    const env = loadEnv();
    const keys = loadKeypairs(env);

    const connection = new Connection(env.rpcUrl, "confirmed");
    const erConnection = new Connection(env.erRpcUrl, {
        wsEndpoint: env.erWsUrl,
        commitment: "confirmed",
    });
    const program = getProgram(connection);

    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);
    const [agentPda] = PublicKey.findProgramAddressSync(
        seeds.agent(keys.agentWallet.publicKey),
        program.programId,
    );

    return {
        env,
        keys,
        connection,
        erConnection,
        program,
        configPda,
        agentPda,
        magicFeeVault: magicFeeVaultPdaFromValidator(env.validator),
    };
};

/** Pretty banner printed at the top of each script. */
export const printHeader = (ctx: Ctx, title: string): void => {
    console.log("\n========================================");
    console.log(`  ${title}`);
    console.log("========================================");
    console.log(`  Mode             : ${ctx.env.mode}`);
    console.log(`  L1 RPC           : ${ctx.env.rpcUrl}`);
    console.log(`  ER RPC           : ${ctx.env.erRpcUrl}`);
    console.log(`  Program          : ${ctx.program.programId.toBase58()}`);
    console.log(`  Validator        : ${ctx.env.validator.toBase58()}`);
    console.log(`  Magic fee vault  : ${ctx.magicFeeVault.toBase58()}`);
    console.log(`  Relayer          : ${ctx.keys.relayer.publicKey.toBase58()}`);
    console.log(`  Owner            : ${ctx.keys.owner.publicKey.toBase58()}`);
    console.log(`  Agent wallet     : ${ctx.keys.agentWallet.publicKey.toBase58()}`);
    console.log(`  Config PDA       : ${ctx.configPda.toBase58()}`);
    console.log(`  Agent PDA        : ${ctx.agentPda.toBase58()}`);
};

/**
 * Verify the loaded relayer keypair actually matches config.relayer, so we
 * fail fast with a clear message instead of an opaque `InvalidRelayer` /
 * `unknown signer` error mid-flow.
 */
export const assertRelayerMatchesConfig = async (ctx: Ctx): Promise<void> => {
    const config = await ctx.program.account.config.fetch(ctx.configPda);
    if (config.maintenance) {
        throw new Error("Bento is in maintenance mode — mutating instructions will reject.");
    }
    if (!config.relayer.equals(ctx.keys.relayer.publicKey)) {
        throw new Error(
            `Loaded relayer ${ctx.keys.relayer.publicKey.toBase58()} does not match ` +
                `config.relayer ${config.relayer.toBase58()}. Supply the matching relayer ` +
                `keypair (RELAYER_KEYPAIR_PATH) or re-run init-config to point at this one.`,
        );
    }
};

/** Send + confirm an L1 transaction with the relayer as fee payer. */
export const sendL1 = async (
    ctx: Ctx,
    ixs: TransactionInstruction[],
    signers: Keypair[],
): Promise<string> => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = ctx.keys.relayer.publicKey;
    tx.recentBlockhash = (await ctx.connection.getLatestBlockhash("confirmed")).blockhash;
    return sendAndConfirmTransaction(ctx.connection, tx, signers, { commitment: "confirmed" });
};

/**
 * Send + confirm a transaction on the ER. `skipPreflight` mirrors the test
 * suite — ER simulation can lag the just-delegated account state.
 */
export const sendEr = async (
    ctx: Ctx,
    ixs: TransactionInstruction[],
    signers: Keypair[],
): Promise<string> => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = ctx.keys.relayer.publicKey;
    tx.recentBlockhash = (await ctx.erConnection.getLatestBlockhash("confirmed")).blockhash;
    return sendAndConfirmTransaction(ctx.erConnection, tx, signers, {
        skipPreflight: true,
        commitment: "confirmed",
        preflightCommitment: "confirmed",
    });
};

/**
 * Top up the Agent PDA's ER-side balance so it can act as the commit bundle
 * payer. ER execution is free, but committing state back to L1 is paid for:
 * first by a small per-account sponsorship quota, then by `magic_fee_vault`,
 * and finally by the Agent PDA's own lamports ABOVE its rent-exempt minimum.
 * A freshly-registered Agent sits exactly at rent (0 spare), so once
 * sponsorship runs out and the shared vault is empty, commits fail with
 * "insufficient funds". Giving the Agent its own buffer makes it self-funding
 * regardless of the vault.
 *
 * Routed through `lamportsDelegatedTransferIx` on the BASE layer — the proven
 * path for crediting a delegated account's ER balance (a plain SystemProgram
 * transfer can't, since the delegated account is owned by the delegation
 * program). The Agent must already be delegated.
 */
export const topupAgentErBalance = async (
    ctx: Ctx,
    amountLamports: number,
    funder: Keypair = ctx.keys.relayer,
): Promise<string> => {
    // Fresh salt per call — a repeated (funder, agent, salt) triple collides
    // with an existing single-use lamports PDA and fails.
    const salt = crypto.randomBytes(32);
    deriveLamportsPda(funder.publicKey, ctx.agentPda, salt); // validates inputs / derivation
    const ix = lamportsDelegatedTransferIx(
        funder.publicKey,
        ctx.agentPda,
        BigInt(amountLamports),
        salt,
    );
    const tx = new Transaction().add(ix);
    tx.feePayer = funder.publicKey;
    tx.recentBlockhash = (await ctx.connection.getLatestBlockhash("confirmed")).blockhash;
    return sendAndConfirmTransaction(ctx.connection, tx, [funder], {
        commitment: "confirmed",
        skipPreflight: true,
    });
};

/** Parse a SOL-denominated env var into lamports; returns 0 when unset/zero. */
export const solEnvToLamports = (raw: string | undefined, fallbackSol: string): number => {
    const lamports = Math.floor(parseFloat(raw ?? fallbackSol) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports < 0) {
        throw new Error(`invalid SOL amount: ${raw ?? fallbackSol}`);
    }
    return lamports;
};

/**
 * Poll the ER until the freshly-delegated PDA has been ingested. Without this
 * the first ER read/write after delegation can race the delegation event and
 * see "Account does not exist".
 */
export const waitForErAccount = async (
    ctx: Ctx,
    account: PublicKey,
    { attempts = 30, intervalMs = 1_000 } = {},
): Promise<void> => {
    for (let i = 0; i < attempts; i++) {
        const info = await ctx.erConnection.getAccountInfo(account, "confirmed");
        if (info) return;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out waiting for ${account.toBase58()} to appear on the ER`);
};
