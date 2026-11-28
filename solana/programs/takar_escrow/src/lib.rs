//! Takar escrow on Solana: the Solana leg of Takar Trade Assurance without custody.
//!
//! The buyer's tokens sit in a vault owned by this program, not by Takar. A settlement moves them
//! only to the deal's payee and payer, only in amounts that add up to the deposit, and only when
//! `threshold` of the deal's attestors sign the same settlement transaction. The decision itself is
//! made on Ethereum Sepolia by the Trade Assurance panel; the attestors mirror it here and name the
//! Sepolia settlement transaction they mirror. If nobody settles by the deadline, the buyer reclaims.
//!
//! Testnet code (devnet), not audited.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9TB4j4rce2Tk2PZy8XVajaZxAsqxCW3hJKqPhroSzD9k");

#[program]
pub mod takar_escrow {
    use super::*;

    /// The buyer locks `amount` for `payee`, naming who may attest to the outcome.
    pub fn open(ctx: Context<Open>, case_id: [u8; 32], amount: u64, attestors: [Pubkey; 3], threshold: u8, deadline: i64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(threshold >= 1 && threshold <= 3, EscrowError::BadThreshold);
        require!(attestors[0] != attestors[1] && attestors[1] != attestors[2] && attestors[0] != attestors[2], EscrowError::DuplicateAttestor);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::DeadlinePassed);
        require!(ctx.accounts.payee.key() != ctx.accounts.payer.key(), EscrowError::BadPayee);
        let d = &mut ctx.accounts.deal;
        d.payer = ctx.accounts.payer.key();
        d.payee = ctx.accounts.payee.key();
        d.mint = ctx.accounts.mint.key();
        d.case_id = case_id;
        d.amount = amount;
        d.attestors = attestors;
        d.threshold = threshold;
        d.deadline = deadline;
        d.settled = false;
        d.bump = ctx.bumps.deal;
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.payer_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            }),
            amount,
        )?;
        emit!(Opened { case_id, payer: d.payer, payee: d.payee, amount });
        Ok(())
    }

    /// Pay out the Sepolia decision. The attestors sign this transaction; they are passed as the
    /// remaining accounts and at least `threshold` distinct ones must have signed.
    pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>, to_payee: u64, to_payer: u64, sepolia_tx: [u8; 32]) -> Result<()> {
        let d = &ctx.accounts.deal;
        require!(!d.settled, EscrowError::AlreadySettled);
        require!(to_payee.checked_add(to_payer) == Some(d.amount), EscrowError::DoesNotAddUp);
        let mut seen: Vec<Pubkey> = Vec::new();
        for acc in ctx.remaining_accounts.iter() {
            if acc.is_signer && d.attestors.contains(acc.key) && !seen.contains(acc.key) {
                seen.push(*acc.key);
            }
        }
        require!(seen.len() >= d.threshold as usize, EscrowError::NotEnoughAttestors);

        let payer_key = d.payer;
        let case_id = d.case_id;
        let seeds: &[&[u8]] = &[b"deal", payer_key.as_ref(), case_id.as_ref(), &[d.bump]];
        let signer = &[seeds];
        if to_payee > 0 {
            token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.payee_token.to_account_info(), authority: ctx.accounts.deal.to_account_info(),
            }, signer), to_payee)?;
        }
        if to_payer > 0 {
            token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.payer_token.to_account_info(), authority: ctx.accounts.deal.to_account_info(),
            }, signer), to_payer)?;
        }
        ctx.accounts.deal.settled = true;
        emit!(Settled { case_id, to_payee, to_payer, sepolia_tx, attestors: seen.len() as u8 });
        Ok(())
    }

    /// Nobody settled by the deadline: the buyer takes the whole deposit back.
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        let d = &ctx.accounts.deal;
        require!(!d.settled, EscrowError::AlreadySettled);
        require!(Clock::get()?.unix_timestamp >= d.deadline, EscrowError::DeadlineNotReached);
        let (payer_key, case_id, amount, bump) = (d.payer, d.case_id, d.amount, d.bump);
        let seeds: &[&[u8]] = &[b"deal", payer_key.as_ref(), case_id.as_ref(), &[bump]];
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.payer_token.to_account_info(), authority: ctx.accounts.deal.to_account_info(),
        }, &[seeds]), amount)?;
        ctx.accounts.deal.settled = true;
        emit!(Reclaimed { case_id, amount });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Deal {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub mint: Pubkey,
    pub case_id: [u8; 32],
    pub amount: u64,
    pub attestors: [Pubkey; 3],
    pub threshold: u8,
    pub deadline: i64,
    pub settled: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 32])]
pub struct Open<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only its key is stored; payouts go to a token account this key owns.
    pub payee: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Deal::INIT_SPACE, seeds = [b"deal", payer.key().as_ref(), case_id.as_ref()], bump)]
    pub deal: Account<'info, Deal>,
    #[account(init, payer = payer, seeds = [b"vault", deal.key().as_ref()], bump, token::mint = mint, token::authority = deal)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = payer)]
    pub payer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub deal: Account<'info, Deal>,
    #[account(mut, seeds = [b"vault", deal.key().as_ref()], bump, token::mint = deal.mint)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = deal.mint, constraint = payee_token.owner == deal.payee @ EscrowError::WrongRecipient)]
    pub payee_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = deal.mint, constraint = payer_token.owner == deal.payer @ EscrowError::WrongRecipient)]
    pub payer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(mut, address = deal.payer)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub deal: Account<'info, Deal>,
    #[account(mut, seeds = [b"vault", deal.key().as_ref()], bump, token::mint = deal.mint)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = deal.mint, constraint = payer_token.owner == deal.payer @ EscrowError::WrongRecipient)]
    pub payer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct Opened { pub case_id: [u8; 32], pub payer: Pubkey, pub payee: Pubkey, pub amount: u64 }
#[event]
pub struct Settled { pub case_id: [u8; 32], pub to_payee: u64, pub to_payer: u64, pub sepolia_tx: [u8; 32], pub attestors: u8 }
#[event]
pub struct Reclaimed { pub case_id: [u8; 32], pub amount: u64 }

#[error_code]
pub enum EscrowError {
    #[msg("amount must be positive")] ZeroAmount,
    #[msg("threshold must be 1 to 3")] BadThreshold,
    #[msg("attestors must be distinct")] DuplicateAttestor,
    #[msg("deadline is in the past")] DeadlinePassed,
    #[msg("payee cannot be the payer")] BadPayee,
    #[msg("already settled or reclaimed")] AlreadySettled,
    #[msg("payouts must add up to the deposit")] DoesNotAddUp,
    #[msg("not enough attestors signed")] NotEnoughAttestors,
    #[msg("deadline not reached")] DeadlineNotReached,
    #[msg("payout must go to the deal's payee or payer")] WrongRecipient,
}
