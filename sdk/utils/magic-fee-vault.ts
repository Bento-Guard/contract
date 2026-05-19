import { Connection, PublicKey } from "@solana/web3.js";
import {
    delegationRecordPdaFromDelegatedAccount,
    magicFeeVaultPdaFromValidator,
} from "@magicblock-labs/ephemeral-rollups-sdk";

/**
 * Derive the canonical `magic_fee_vault` PDA for a delegated account.
 *
 * Reads the validator pubkey out of the delegation record (bytes 8..40) and
 * derives `[b"magic-fee-vault", validator]` under DELEGATION_PROGRAM_ID.
 *
 * Must be called against a BASE LAYER connection that holds the delegation
 * record (the ER doesn't carry it).
 *
 * Lifts the 10-commit sponsorship cap — every commit handler that attaches
 * this vault to its `MagicIntentBundleBuilder` debits its lamports for the
 * commit fee instead of consuming the per-account sponsorship quota.
 */
export async function deriveMagicFeeVault(
    baseConnection: Connection,
    delegatedAccount: PublicKey,
): Promise<{ magicFeeVault: PublicKey; validator: PublicKey }> {
    const recordPda = delegationRecordPdaFromDelegatedAccount(delegatedAccount);
    const info = await baseConnection.getAccountInfo(recordPda, "confirmed");
    if (!info) {
        throw new Error(
            `Delegation record not found for ${delegatedAccount.toBase58()} ` +
                `at ${recordPda.toBase58()}. The account must be delegated before its ` +
                `magic_fee_vault can be derived.`,
        );
    }
    if (info.data.length < 40) {
        throw new Error(
            `Delegation record ${recordPda.toBase58()} has unexpected layout ` +
                `(len=${info.data.length}, need >= 40)`,
        );
    }
    const validator = new PublicKey(info.data.subarray(8, 40));
    return { magicFeeVault: magicFeeVaultPdaFromValidator(validator), validator };
}
