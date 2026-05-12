use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("3nrgACPmXUvzcEdAXzHYemJY7XTCvnLx5qEfE7BKC5We"); // replace after anchor build

// ── Constants ─────────────────────────────────────────────────────────────────

/// Platform fee in basis points — 250 = 2.5%
const FEE_BPS: u64 = 250;
const BPS_DENOMINATOR: u64 = 10_000;

/// Seeds for the platform config PDA
const CONFIG_SEED: &[u8] = b"kreato_config";

// ── Program ───────────────────────────────────────────────────────────────────

// #[program]
pub mod kreato_payment {
    use super::*;

    // ── Admin: initialize config ──────────────────────────────────────────────

    /// Called once after deployment to set the platform wallet.
    /// Only the upgrade authority (deployer) can call this.
    pub fn initialize(ctx: Context<Initialize>, platform_wallet: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.platform = platform_wallet;
        config.fee_bps = FEE_BPS;
        config.bump = ctx.bumps.config;
        msg!("KreatoPayment initialized. Platform: {}", platform_wallet);
        Ok(())
    }

    /// Update the platform wallet (authority only).
    pub fn set_platform(ctx: Context<SetPlatform>, new_platform: Pubkey) -> Result<()> {
        require!(
            new_platform != Pubkey::default(),
            KreatoError::InvalidAddress
        );
        ctx.accounts.config.platform = new_platform;
        msg!("Platform wallet updated to {}", new_platform);
        Ok(())
    }

    /// Update the fee (authority only, capped at 10%).
    pub fn set_fee(ctx: Context<SetFee>, new_fee_bps: u64) -> Result<()> {
        require!(new_fee_bps <= 1_000, KreatoError::FeeTooHigh); // max 10%
        ctx.accounts.config.fee_bps = new_fee_bps;
        msg!("Fee updated to {} bps", new_fee_bps);
        Ok(())
    }

    // ── Pay with native SOL ───────────────────────────────────────────────────

    /// Transfer SOL, split between creator (97.5%) and platform (2.5%).
    ///
    /// Arguments:
    ///   amount      – lamports to send in total
    ///   product_id  – off-chain reference (bytes32 / [u8; 32])
    ///   payment_type – 0=PURCHASE, 1=DONATION, 2=SUBSCRIPTION
    pub fn pay_with_sol(
        ctx: Context<PayWithSol>,
        amount: u64,
        product_id: [u8; 32],
        payment_type: u8,
    ) -> Result<()> {
        require!(amount > 0, KreatoError::ZeroAmount);
        require!(
            ctx.accounts.creator.key() != ctx.accounts.config.platform,
            KreatoError::CreatorIsPlatform
        );

        let fee_bps = ctx.accounts.config.fee_bps;
        let platform_fee = amount
            .checked_mul(fee_bps)
            .unwrap()
            .checked_div(BPS_DENOMINATOR)
            .unwrap();
        let creator_amount = amount.checked_sub(platform_fee).unwrap();

        // Transfer to creator
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
            ),
            creator_amount,
        )?;

        // Transfer fee to platform
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.platform.to_account_info(),
                },
            ),
            platform_fee,
        )?;

        emit!(PaymentProcessed {
            payer: ctx.accounts.payer.key(),
            creator: ctx.accounts.creator.key(),
            token_mint: Pubkey::default(), // native SOL = zero pubkey
            total_amount: amount,
            creator_amount,
            platform_fee,
            product_id,
            payment_type,
        });

        Ok(())
    }

    // ── Pay with SPL token (USDC, USDT, etc.) ─────────────────────────────────

    /// Transfer an SPL token (e.g. USDC), split between creator and platform.
    ///
    /// The payer must have already approved (or this is a direct transfer from
    /// their ATA). We use transfer_checked for safety.
    ///
    /// Arguments:
    ///   amount       – token amount in the token's smallest unit (e.g. 1_000_000 = 1 USDC)
    ///   decimals     – token decimals (passed explicitly for transfer_checked)
    ///   product_id   – off-chain reference
    ///   payment_type – 0=PURCHASE, 1=DONATION, 2=SUBSCRIPTION
    pub fn pay_with_token(
        ctx: Context<PayWithToken>,
        amount: u64,
        decimals: u8,
        product_id: [u8; 32],
        payment_type: u8,
    ) -> Result<()> {
        require!(amount > 0, KreatoError::ZeroAmount);
        require!(
            ctx.accounts.creator_ata.owner == ctx.accounts.creator.key(),
            KreatoError::InvalidCreatorAta
        );
        require!(
            ctx.accounts.creator.key() != ctx.accounts.config.platform,
            KreatoError::CreatorIsPlatform
        );

        let fee_bps = ctx.accounts.config.fee_bps;
        let platform_fee = amount
            .checked_mul(fee_bps)
            .unwrap()
            .checked_div(BPS_DENOMINATOR)
            .unwrap();
        let creator_amount = amount.checked_sub(platform_fee).unwrap();

        // Transfer creator_amount → creator ATA
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.creator_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            creator_amount,
            decimals,
        )?;

        // Transfer platform_fee → platform ATA
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.platform_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            platform_fee,
            decimals,
        )?;

        emit!(PaymentProcessed {
            payer: ctx.accounts.payer.key(),
            creator: ctx.accounts.creator.key(),
            token_mint: ctx.accounts.mint.key(),
            total_amount: amount,
            creator_amount,
            platform_fee,
            product_id,
            payment_type,
        });

        Ok(())
    }
}

// ── Account structs ───────────────────────────────────────────────────────────

/// Global config PDA — stores platform wallet + fee
#[account]
pub struct PlatformConfig {
    pub authority: Pubkey, // upgrade authority (deployer)
    pub platform: Pubkey,  // platform fee recipient wallet
    pub fee_bps: u64,      // fee in basis points (250 = 2.5%)
    pub bump: u8,
}

impl PlatformConfig {
    // 8 discriminator + 32 + 32 + 8 + 1
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}

// ── Contexts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer  = authority,
        space  = PlatformConfig::LEN,
        seeds  = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPlatform<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump  = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, PlatformConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetFee<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump  = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, PlatformConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PayWithSol<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump  = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: creator is just a SOL recipient, validated by business logic not ownership
    #[account(
        mut,
        constraint = creator.key() != config.platform @ KreatoError::CreatorIsPlatform
    )]
    pub creator: AccountInfo<'info>,

    /// CHECK: platform wallet from config
    #[account(
        mut,
        constraint = platform.key() == config.platform @ KreatoError::InvalidAddress
    )]
    pub platform: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayWithToken<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump  = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: creator is a regular wallet
    #[account(
        constraint = creator.key() != config.platform @ KreatoError::CreatorIsPlatform
    )]
    pub creator: AccountInfo<'info>,

    /// CHECK: platform wallet from config
    #[account(
        constraint = platform.key() == config.platform @ KreatoError::InvalidAddress
    )]
    pub platform: AccountInfo<'info>,

    pub mint: Account<'info, Mint>,

    /// Payer's token account (source)
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    /// Creator's token account (destination) — init if needed
    #[account(
        init_if_needed,
        payer                       = payer,
        associated_token::mint      = mint,
        associated_token::authority = creator,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    /// Platform's token account (destination) — init if needed
    #[account(
        init_if_needed,
        payer                       = payer,
        associated_token::mint      = mint,
        associated_token::authority = platform,
    )]
    pub platform_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct PaymentProcessed {
    pub payer: Pubkey,
    pub creator: Pubkey,
    pub token_mint: Pubkey, // Pubkey::default() for native SOL
    pub total_amount: u64,
    pub creator_amount: u64,
    pub platform_fee: u64,
    pub product_id: [u8; 32], // keccak256 / sha256 of off-chain product id
    pub payment_type: u8,     // 0=PURCHASE 1=DONATION 2=SUBSCRIPTION
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum KreatoError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Creator cannot be the platform wallet")]
    CreatorIsPlatform,
    #[msg("Invalid address")]
    InvalidAddress,
    #[msg("Fee too high — maximum is 10% (1000 bps)")]
    FeeTooHigh,
    #[msg("Creator ATA owner mismatch")]
    InvalidCreatorAta,
}
