pub const DISCRIMINATOR: usize = 8;

pub const PREFIX_SEED: &[u8] = b"bento";

pub mod operator {
  use anchor_lang::prelude::{pubkey, Pubkey};

  #[cfg(feature = "staging")]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");

  #[cfg(feature = "dev")]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");

  #[cfg(not(any(feature = "dev", feature = "staging")))]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");
}
