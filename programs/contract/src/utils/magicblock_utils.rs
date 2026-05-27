use anchor_lang::prelude::*;

/// Force `is_signer = true` on an `AccountInfo` so the Magic intent bundle
/// builder emits the PDA payer with a signer account-meta. The real signature
/// is supplied by `invoke_signed` via the PDA seeds.
pub fn as_signer(account: AccountInfo) -> AccountInfo {
  AccountInfo {
    is_signer: true,
    ..account
  }
}
