const hre = require("hardhat");

async function main() {
  const contract = await hre.ethers.getContractAt("FitStake", "0x920082097e3E0b6F449fdC2225c4a8E3492b6F7C");
  const count = await contract.challengeCount();
  console.log("Total challenges:", Number(count));

  const phaseNames = ["Joining","Active","ProofSubmission","Voting","GracePeriod","Completed"];

  for (let i = 1; i <= Number(count); i++) {
    const c = await contract.getChallenge(i);
    const phase = await contract.getChallengePhase(i);
    const now = Math.floor(Date.now() / 1000);

    console.log(`\nChallenge ${i}:`);
    console.log("  Goal:", c.goal);
    console.log("  Phase:", phaseNames[Number(phase)]);
    console.log("  Participants:", Number(c.participantCount));
    console.log("  Total staked:", hre.ethers.formatUnits(c.totalStaked, 6), "USDC");
    console.log("  Distributed:", c.isDistributed);
    console.log("  Join deadline:", new Date(Number(c.joinDeadline) * 1000).toLocaleString(), Number(c.joinDeadline) < now ? "(PASSED)" : "(PENDING)");
    console.log("  Activity deadline:", new Date(Number(c.deadline) * 1000).toLocaleString(), Number(c.deadline) < now ? "(PASSED)" : "(PENDING)");
    console.log("  Proof deadline:", new Date(Number(c.proofDeadline) * 1000).toLocaleString(), Number(c.proofDeadline) < now ? "(PASSED)" : "(PENDING)");
    console.log("  Vote deadline:", new Date(Number(c.voteDeadline) * 1000).toLocaleString(), Number(c.voteDeadline) < now ? "(PASSED)" : "(PENDING)");
    console.log("  Grace deadline:", new Date(Number(c.graceDeadline) * 1000).toLocaleString(), Number(c.graceDeadline) < now ? "(PASSED)" : "(PENDING)");

    // Check proof status for known wallets
    const wallets = [
      "0xd24f66289cb3bdd3094be85a2225285479a7aa7a",
      "0xA0f88Dd39dAD31bd4cA7eC7d7BCA47dD2858001C"
    ];
    for (const w of wallets) {
      try {
        const joined = await contract.hasJoinedChallenge(i, w);
        const submitted = await contract.hasSubmittedProof(i, w);
        const voted = await contract.hasVotedAtAll(i, w);
        if (joined) {
          console.log(`  Wallet ${w.slice(0,10)}...: joined=${joined}, proof=${submitted}, voted=${voted}`);
        }
      } catch (e) {}
    }
  }
}

main().catch(console.error);
