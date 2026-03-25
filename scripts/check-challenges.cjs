const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.FITSTAKE_ADDRESS || "0x13a1EC1b4e17D417B23c52adfFCAC978B6e8cB26";
  const contract = await hre.ethers.getContractAt("FitStake", contractAddress);
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

    // Check proof status for all participants
    const participants = await contract.getParticipants(i);
    for (const w of participants) {
      try {
        const submitted = await contract.hasSubmittedProof(i, w);
        const voted = await contract.hasVotedAtAll(i, w);
        console.log(`  Wallet ${w.slice(0,10)}...: proof=${submitted}, voted=${voted}`);
      } catch (e) {}
    }
  }
}

main().catch(console.error);
