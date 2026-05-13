import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.KreatoPayment as Program;

  // Ganti dengan wallet platform fee kamu
<<<<<<< HEAD
  const platformWallet = new PublicKey("PLATFORM_WALLET_ADDRESS_HERE");
=======
  const platformWallet = new PublicKey("7zn89WxqYetYeDF2NzEt9Lev2sYgGrjchaZ1EcGEA6BQ");
>>>>>>> 646f92f (update declareid lib.rs)

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

<<<<<<< HEAD
main().catch(console.error);
=======
main().catch(console.error);
>>>>>>> 646f92f (update declareid lib.rs)
