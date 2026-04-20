use anchor_lang::prelude::*;

declare_id!("A5vQdPeJH2Yn72RmXHyrFjErUTqPwX83e6of4LBchEbG");

#[program]
pub mod contract {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
