pub const DISCRIMINATOR: usize = 8;

pub const PREFIX_SEED: &[u8] = b"bento";

pub mod operator {
  use anchor_lang::prelude::{pubkey, Pubkey};

  #[cfg(feature = "staging")]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("FKEynBSYhSASsAdzQJ4Cwvf2X3vZs3UERhTj3jhtFVBM");

  #[cfg(feature = "dev")]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("4i6CwseKjiSy58fUtzkQAVk2tQLUm6cWuR1FpuwPYqAL");

  #[cfg(not(any(feature = "dev", feature = "staging")))]
  pub const OPERATOR_PUBKEY: Pubkey = pubkey!("FKEynBSYhSASsAdzQJ4Cwvf2X3vZs3UERhTj3jhtFVBM");
}
