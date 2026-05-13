import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import idl from "../target/idl/kreato_payment.json";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey(idl.address);
    const program = new anchor.Program(idl as anchor.Idl, provider) as any;

    const payer = provider.wallet.publicKey;
    const creator = new PublicKey("EyzXxbyovJAtFVejBr5LaoKKGn3LfG4fevSsNiL6j47Z");
    const platform = new PublicKey("9zKzHCriRQ7feH55cr3p7vm4F5MQotLJZizpLxC7suAL");

    // Ganti dengan TOKEN_ADDRESS dari Step 1
    const mint = new PublicKey("9oYe4wPnBDEAgwZTMWatoH4itkAVG85Q8ark56WFz8S3");

    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("kreato_config")],
        programId
    );

    const payerAta = await getAssociatedTokenAddress(mint, payer);
    const creatorAta = await getAssociatedTokenAddress(mint, creator);
    const platformAta = await getAssociatedTokenAddress(mint, platform);

    const productId = Array.from(Buffer.alloc(32, 0));
    const amount = 10_000_000; // 10 USDC (6 decimals)
    const decimals = 6;

    console.log("Testing pay_with_token...");
    console.log("Mint    :", mint.toString());
    console.log("Amount  : 10 USDC");

    // Test 1: default fee 2.5%
    const tx = await program.methods
        .payWithToken(
            new anchor.BN(amount),
            decimals,
            productId,
            0, // PURCHASE
            null // fee default 2.5%
        )
        .accounts({
            config: configPda,
            payer,
            creator,
            platform,
            mint,
            payerAta,
            creatorAta,
            platformAta,
        })
        .rpc();

    console.log("\n✅ pay_with_token success!");
    console.log("Tx      :", tx);
    console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Test 2: fee override 0%
    const tx2 = await program.methods
        .payWithToken(
            new anchor.BN(amount),
            decimals,
            productId,
            1, // DONATION
            new anchor.BN(0) // gratis
        )
        .accounts({
            config: configPda,
            payer,
            creator,
            platform,
            mint,
            payerAta,
            creatorAta,
            platformAta,
        })
        .rpc();

    console.log("\n✅ pay_with_token (0% fee) success!");
    console.log("Tx      :", tx2);
    console.log("Explorer:", `https://explorer.solana.com/tx/${tx2}?cluster=devnet`);
}

main().catch(console.error);