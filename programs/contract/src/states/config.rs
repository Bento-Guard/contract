use anchor_lang::prelude::*;

use crate::constant;

#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    pub owner: Pubkey,
    pub bump: u8,
}

impl<'info> Config {
    pub const SEED: &'static [u8] = b"config";

    pub fn space() -> usize {
        constant::DISCRIMINATOR + Config::INIT_SPACE
    }
}
