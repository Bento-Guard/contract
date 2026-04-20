use anchor_lang::prelude::Pubkey;
use anchor_lang::pubkey;

cfg_if::cfg_if! {
    if #[cfg(feature = "dev")] {
        pub const PROGRAM_ID: Pubkey = pubkey!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");
    } else {
        // Default use for localnet
        pub const PROGRAM_ID: Pubkey = pubkey!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");
    }
}
