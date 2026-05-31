import * as dotenv from "dotenv";
dotenv.config();

import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import operatorKeypairDevnetJson from "../../accounts/devnet/operator.json";
import { delegateVaultSponsorIx, getProgram, initVaultSponsorIx, seeds } from "../../sdk";

/**
 * Initialize AND delegate the singleton VaultSponsor PDA — the admin-owned
 * account that pays the MagicBlock commit fees for every commit handler.
 *
 * Both instructions run on L1 and are bundled in one transaction:
 *   1. init_vault_sponsor      — create the PDA (operator pays rent)
 *   2. delegate_vault_sponsor  — delegate it to the ER, pinned to VALIDATOR
 *
 * VALIDATOR MUST be the same ER validator the Agent/Action PDAs are delegated
 * to and whose `magic_fee_vault` is funded — otherwise the vault can't pay
 * their commits. Idempotent: skips init if the PDA exists, skips delegate if
 * it's already owned by the delegation program, so re-running is safe.
 *
 * After this, fund the ER-side balance with `topup-vault-sponsor.ts`.
 *
 * Env:
 *   SOLANA_RPC_URL  L1 base-layer RPC      (required)
 *   MODE            devnet | mainnet       (default devnet)
 *   VALIDATOR       ER validator pubkey    (default Asia devnet validator)
 */
const MODE: "devnet" | "mainnet" = (process.env.MODE as "devnet" | "mainnet") ?? "devnet";

// Default ER validator (Asia) — keep in sync with scripts/user/_shared.ts and
// the funded magic_fee_vault.
const DEFAULT_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const validator = new PublicKey(process.env.VALIDATOR ?? DEFAULT_VALIDATOR);

const operatorKeypair =
    MODE === "devnet"
        ? Keypair.fromSecretKey(Uint8Array.from(operatorKeypairDevnetJson))
        : Keypair.generate();

const connectionStr = process.env.SOLANA_RPC_URL;
if (!connectionStr) {
    throw new Error("SOLANA_RPC_URL env is required");
}

const connection = new Connection(connectionStr, "confirmed");
const program = getProgram(connection);

(async () => {
    const [configPda] = PublicKey.findProgramAddressSync(seeds.config(), program.programId);
    const [vaultSponsorPda] = PublicKey.findProgramAddressSync(
        seeds.vaultSponsor(),
        program.programId,
    );

    console.log("========================================");
    console.log("     Init + Delegate Vault Sponsor");
    console.log("========================================");
    console.log(`  Operator       : ${operatorKeypair.publicKey.toBase58()}`);
    console.log(`  Program        : ${program.programId.toBase58()}`);
    console.log(`  Config PDA     : ${configPda.toBase58()}`);
    console.log(`  Vault Sponsor  : ${vaultSponsorPda.toBase58()}`);
    console.log(`  Validator      : ${validator.toBase58()}`);
    console.log("");

    const existing = await connection.getAccountInfo(vaultSponsorPda, "confirmed");
    const alreadyDelegated = existing?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;

    const ixs: TransactionInstruction[] = [];

    if (!existing) {
        ixs.push(
            await initVaultSponsorIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    vaultSponsor: vaultSponsorPda,
                },
            }),
        );
        console.log("  • init_vault_sponsor      → queued");
    } else {
        console.log("  • init_vault_sponsor      → skipped (PDA already exists)");
    }

    if (!alreadyDelegated) {
        ixs.push(
            await delegateVaultSponsorIx(program, {
                accounts: {
                    operator: operatorKeypair.publicKey,
                    vaultSponsor: vaultSponsorPda,
                    config: configPda,
                    ownerProgram: program.programId,
                },
                validator,
            }),
        );
        console.log("  • delegate_vault_sponsor  → queued");
    } else {
        console.log("  • delegate_vault_sponsor  → skipped (already delegated)");
    }

    if (ixs.length === 0) {
        console.log("\n  ✅ VaultSponsor already initialized and delegated — nothing to do.");
        console.log("     Fund its ER balance with `topup-vault-sponsor.ts`.");
        return;
    }

    const tx = new Transaction();
    ixs.forEach((ix) => tx.add(ix));
    tx.feePayer = operatorKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    const txHash = await sendAndConfirmTransaction(connection, tx, [operatorKeypair], {
        commitment: "confirmed",
        skipPreflight: true,
    });
    console.log(`\n  Init + Delegate txHash: ${txHash}`);
    console.log("\n  ✅ Done. Next: fund the ER balance with `topup-vault-sponsor.ts`.");
})();
