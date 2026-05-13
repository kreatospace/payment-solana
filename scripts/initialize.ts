import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "../target/idl/kreato_payment.json";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl as anchor.Idl, provider) as any;

  console.log("Program ID :", programId.toString());
  console.log("Authority  :", provider.wallet.publicKey.toString());

  const platformWallet = provider.wallet.publicKey;

  const tx = await program.methods
    .initialize(platformWallet)
    .accounts({
      authority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("\n✅ Initialize success!");
  console.log("Tx      :", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kreato_config")],
    programId
  );
  const config = await program.account.platformConfig.fetch(configPda);
  console.log("\nPDA     :", configPda.toString());
  console.log("fee_bps :", config.feeBps.toString());
  console.log("platform:", config.platform.toString());
}

main().catch(console.error);
