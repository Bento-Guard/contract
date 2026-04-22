use anchor_lang::prelude::*;

use crate::common::constant;

pub const MAX_PAYLOAD: usize = 8192;

#[account(zero_copy)]
#[repr(C, packed)]
pub struct Action {
  pub agent: Pubkey,

  pub target_program: Pubkey,
  pub value: u64,

  pub commitment: [u8; 32],

  pub data_len: u32,
  pub data_written: u32,

  pub status: u8,
  pub decision: u8,
  pub raw_score: u32,

  pub bump: u8,
  pub _padding: [u8; 7],

  // Encrypted payload (chunked writes)
  pub encrypted_payload: [u8; MAX_PAYLOAD], // 8192
}

#[account]
pub struct AllowedTarget {
  pub agent: Pubkey,
  pub target: Pubkey,
  pub allowed: bool,
  pub bump: u8,
}
