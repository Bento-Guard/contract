use anchor_lang::prelude::*;

use crate::{common::event, Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(init, payer = signer, space = Config::space(), seeds = [Config::SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize(&mut self, bumps: &InitializeBumps) -> Result<()> {
        self.config.set_inner(Config {
            owner: self.signer.key(),
            bump: bumps.config,
        });

        emit!(event::InitializeConfigEvent {
            owner: self.signer.key()
        });

        Ok(())
    }
}
