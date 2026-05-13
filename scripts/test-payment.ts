import * as anchor from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import idl from "../target/idl/kreato_payment.json";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl as anchor.Idl, provider) as any;

  // Gunakan wallet kamu sebagai payer sekaligus creator (untuk test)
  const payer = provider.wallet.publicKey;
  const creator = new PublicKey("EyzXxbyovJAtFVejBr5LaoKKGn3LfG4fevSsNiL6j47Z"); // wallet kamu
  const platform = new PublicKey("9zKzHCriRQ7feH55cr3p7vm4F5MQotLJZizpLxC7suAL"); // sama untuk test

  // Product ID — bytes32 dari string
  const productId = Array.from(Buffer.alloc(32, 0));

  console.log("Testing pay_with_sol...");
  console.log("Payer   :", payer.toString());
  console.log("Creator :", creator.toString());

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kreato_config")],
    programId
  );

  // Test 1: default fee (2.5%)
  const amount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  const tx = await program.methods
    .payWithSol(
      new anchor.BN(amount),
      productId,
      0, // PURCHASE
      null // fee_override = null → pakai default 2.5%
    )
    .accounts({
      config: configPda,
      payer: payer,
      creator: creator,
      platform: platform,
    })
    .rpc();

  console.log("\n✅ pay_with_sol success!");
  console.log("Tx      :", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  // Test 2: fee override 0% (gratis)
  const tx2 = await program.methods
    .payWithSol(
      new anchor.BN(amount),
      productId,
      1,
      new anchor.BN(0)  // fee_override = 0% gratis
    )
    .accounts({
      config: configPda,
      payer: payer,
      creator: creator,
      platform: platform,
    })
    .rpc();

  console.log("\n✅ pay_with_sol (0% fee override) success!");
  console.log("Tx      :", tx2);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx2}?cluster=devnet`);
}

main().catch(console.error);