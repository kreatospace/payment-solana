import * as anchor from "@coral-xyz/anchor";
import { Program }  from "@coral-xyz/anchor";
import {
    Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
    createMint, createAssociatedTokenAccount,
    mintTo, getAccount, getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { KreatoPayment } from "../target/types/kreato_payment";

describe("kreato-payment", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program   = anchor.workspace.KreatoPayment as Program<KreatoPayment>;
    const authority = provider.wallet as anchor.Wallet;

    // Test wallets
    const payer    = Keypair.generate();
    const creator  = Keypair.generate();
    const platform = Keypair.generate();

    // Config PDA
    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("kreato_config")],
        program.programId,
    );

    // SPL mint + ATAs
    let mint: PublicKey;
    let payerAta: PublicKey;
    let creatorAta: PublicKey;
    let platformAta: PublicKey;

    const USDC_DECIMALS = 6;
    const encodeProductId = (id: string): number[] => {
        const buf = Buffer.alloc(32);
        Buffer.from(id).copy(buf);
        return Array.from(buf);
    };

    before(async () => {
        // Airdrop to test wallets
        for (const kp of [payer, creator, platform]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
            await provider.connection.confirmTransaction(sig);
        }

        // Create mock USDC mint (authority = deployer wallet)
        mint = await createMint(
            provider.connection, payer, authority.publicKey,
            null, USDC_DECIMALS,
        );

        // Create ATAs
        payerAta    = await createAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey);
        creatorAta  = await createAssociatedTokenAccount(provider.connection, payer, mint, creator.publicKey);
        platformAta = await createAssociatedTokenAccount(provider.connection, payer, mint, platform.publicKey);

        // Mint 1000 USDC to payer
        await mintTo(
            provider.connection, payer, mint, payerAta,
            authority.payer, 1_000 * 10 ** USDC_DECIMALS,
        );
    });

    // ── 1. Initialize ─────────────────────────────────────────────────────────

    it("initializes the program config", async () => {
        await program.methods
            .initialize(platform.publicKey)
            .accounts({
                config:        configPda,
                authority:     authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        const config = await program.account.platformConfig.fetch(configPda);
        assert.equal(config.platform.toBase58(), platform.publicKey.toBase58());
        assert.equal(config.feeBps.toNumber(), 250);
        console.log("✅ Config initialized. Fee:", config.feeBps.toString(), "bps");
    });

    // ── 2. Pay with SOL ───────────────────────────────────────────────────────

    it("splits SOL payment: 97.5% creator / 2.5% platform", async () => {
        const sendLamports = 1 * LAMPORTS_PER_SOL; // 1 SOL
        const expectedPlatformFee   = Math.floor(sendLamports * 250 / 10_000); // 0.025 SOL
        const expectedCreatorAmount = sendLamports - expectedPlatformFee;

        const creatorBefore  = await provider.connection.getBalance(creator.publicKey);
        const platformBefore = await provider.connection.getBalance(platform.publicKey);

        await program.methods
            .payWithSol(
                new anchor.BN(sendLamports),
                encodeProductId("test-product-001"),
                1, // DONATION
            )
            .accounts({
                config:        configPda,
                payer:         payer.publicKey,
                creator:       creator.publicKey,
                platform:      platform.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([payer])
            .rpc();

        const creatorAfter  = await provider.connection.getBalance(creator.publicKey);
        const platformAfter = await provider.connection.getBalance(platform.publicKey);

        assert.equal(creatorAfter - creatorBefore,  expectedCreatorAmount, "Creator amount wrong");
        assert.equal(platformAfter - platformBefore, expectedPlatformFee,   "Platform fee wrong");

        console.log(`✅ SOL split: creator +${expectedCreatorAmount / LAMPORTS_PER_SOL} SOL, platform +${expectedPlatformFee / LAMPORTS_PER_SOL} SOL`);
    });

    // ── 3. Pay with USDC ──────────────────────────────────────────────────────

    it("splits USDC payment: 97.5% creator / 2.5% platform", async () => {
        const sendAmount = 10 * 10 ** USDC_DECIMALS; // 10 USDC
        const expectedFee    = Math.floor(sendAmount * 250 / 10_000); // 0.25 USDC
        const expectedCreator = sendAmount - expectedFee;              // 9.75 USDC

        const creatorAtaBefore  = await getAccount(provider.connection, creatorAta);
        const platformAtaBefore = await getAccount(provider.connection, platformAta);

        await program.methods
            .payWithToken(
                new anchor.BN(sendAmount),
                USDC_DECIMALS,
                encodeProductId("test-product-002"),
                0, // PURCHASE
            )
            .accounts({
                config:                configPda,
                payer:                 payer.publicKey,
                creator:               creator.publicKey,
                platform:              platform.publicKey,
                mint,
                payerAta,
                creatorAta,
                platformAta,
                tokenProgram:          TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram:         SystemProgram.programId,
            })
            .signers([payer])
            .rpc();

        const creatorAtaAfter  = await getAccount(provider.connection, creatorAta);
        const platformAtaAfter = await getAccount(provider.connection, platformAta);

        assert.equal(
            Number(creatorAtaAfter.amount) - Number(creatorAtaBefore.amount),
            expectedCreator, "Creator USDC amount wrong",
        );
        assert.equal(
            Number(platformAtaAfter.amount) - Number(platformAtaBefore.amount),
            expectedFee, "Platform USDC fee wrong",
        );

        console.log(`✅ USDC split: creator +${expectedCreator / 10 ** USDC_DECIMALS} USDC, platform +${expectedFee / 10 ** USDC_DECIMALS} USDC`);
    });

    // ── 4. Edge cases ─────────────────────────────────────────────────────────

    it("rejects zero-amount SOL payment", async () => {
        try {
            await program.methods
                .payWithSol(new anchor.BN(0), encodeProductId("zero"), 1)
                .accounts({
                    config:        configPda,
                    payer:         payer.publicKey,
                    creator:       creator.publicKey,
                    platform:      platform.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer])
                .rpc();
            assert.fail("Should have thrown ZeroAmount");
        } catch (e: any) {
            assert.include(e.message, "ZeroAmount");
            console.log("✅ Zero amount correctly rejected");
        }
    });

    it("rejects when creator == platform", async () => {
        try {
            await program.methods
                .payWithSol(new anchor.BN(LAMPORTS_PER_SOL), encodeProductId("same"), 1)
                .accounts({
                    config:        configPda,
                    payer:         payer.publicKey,
                    creator:       platform.publicKey, // same as platform — should fail
                    platform:      platform.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer])
                .rpc();
            assert.fail("Should have thrown CreatorIsPlatform");
        } catch (e: any) {
            assert.include(e.message, "CreatorIsPlatform");
            console.log("✅ creator == platform correctly rejected");
        }
    });

    it("allows authority to update platform wallet", async () => {
        const newPlatform = Keypair.generate();
        await program.methods
            .setPlatform(newPlatform.publicKey)
            .accounts({
                config:    configPda,
                authority: authority.publicKey,
            })
            .rpc();

        const config = await program.account.platformConfig.fetch(configPda);
        assert.equal(config.platform.toBase58(), newPlatform.publicKey.toBase58());
        console.log("✅ Platform wallet updated");

        // Restore for subsequent tests
        await program.methods
            .setPlatform(platform.publicKey)
            .accounts({ config: configPda, authority: authority.publicKey })
            .rpc();
    });
});
