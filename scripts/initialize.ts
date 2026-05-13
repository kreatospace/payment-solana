import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.KreatoPayment as Program;

  // Ganti dengan wallet platform fee kamu
  const platformWallet = new PublicKey("PLATFORM_WALLET_ADDRESS_HERE");

  console.log("Initializing program...");
  console.log("Authority:", provider.wallet.publicKey.toString());
  console.log("Platform:", platformWallet.toString());

  const tx = await program.methods
    .initialize(platformWallet)
    .rpc();

  console.log("✅ Initialize success!");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

main().catch(console.error);