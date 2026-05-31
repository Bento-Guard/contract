use anchor_lang::prelude::*;

use crate::common::constant;

#[account]
#[derive(InitSpace, Debug)]
pub struct VaultSponsor {
  /// Admin authority that initialized and funds the vault.
  pub operator: Pubkey,
  pub bump: u8,
  pub _padding: [u64; 8],
}

impl VaultSponsor {
  pub fn space() -> usize {
    constant::DISCRIMINATOR + VaultSponsor::INIT_SPACE
  }

  pub fn init(&mut self, operator: Pubkey, bump: u8) {
    self.operator = operator;
    self.bump = bump;
  }
}
