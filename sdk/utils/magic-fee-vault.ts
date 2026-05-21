import { PublicKey } from "@solana/web3.js";
import { magicFeeVaultPdaFromValidator } from "@magicblock-labs/ephemeral-rollups-sdk";

export async function deriveMagicFeeVault(
    validator: PublicKey,
): Promise<{ magicFeeVault: PublicKey; validator: PublicKey }> {
    return { magicFeeVault: magicFeeVaultPdaFromValidator(validator), validator };
}
