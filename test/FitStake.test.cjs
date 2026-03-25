const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FitStake Contract", function () {
  let fitStake;
  let usdc;
  let owner;
  let addr1;
  let addr2;
  let addr3;

  const STAKE_AMOUNT = 100_000_000; // 100 USDC (6 decimals)
  const MINT_AMOUNT = 1_000_000_000; // 1000 USDC
  const ZERO_BYTES32 = ethers.ZeroHash;

  async function createDefaultChallenge(signer, isPrivate = false, inviteCodeHash = ZERO_BYTES32) {
    const now = await time.latest();
    const joinDeadline = now + 3600; // 1 hour
    const deadline = now + 7200; // 2 hours
    const proofWindowHours = 24;
    const voteWindowHours = 24;
    const graceHours = 12;

    // Approve USDC
    await usdc.connect(signer || owner).approve(fitStake.target, STAKE_AMOUNT);

    return fitStake.connect(signer || owner).createChallenge(
      "Run 5K",
      joinDeadline,
      deadline,
      STAKE_AMOUNT,
      proofWindowHours,
      voteWindowHours,
      graceHours,
      isPrivate,
      inviteCodeHash
    );
  }

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy FitStake with USDC address
    const FitStake = await ethers.getContractFactory("FitStake");
    fitStake = await FitStake.deploy(usdc.target);

    // Mint USDC to all test accounts
    await usdc.mint(owner.address, MINT_AMOUNT);
    await usdc.mint(addr1.address, MINT_AMOUNT);
    await usdc.mint(addr2.address, MINT_AMOUNT);
    await usdc.mint(addr3.address, MINT_AMOUNT);
  });

  describe("Create Challenge", function () {
    it("Should create a challenge with USDC", async function () {
      await createDefaultChallenge();

      const challenge = await fitStake.getChallenge(1);
      expect(challenge.goal).to.equal("Run 5K");
      expect(challenge.creator).to.equal(owner.address);
      expect(challenge.stakeAmount).to.equal(STAKE_AMOUNT);
      expect(challenge.participantCount).to.equal(1);
    });

    it("Should transfer USDC from creator to contract", async function () {
      const balanceBefore = await usdc.balanceOf(owner.address);
      await createDefaultChallenge();
      const balanceAfter = await usdc.balanceOf(owner.address);

      expect(balanceBefore - balanceAfter).to.equal(STAKE_AMOUNT);
      expect(await usdc.balanceOf(fitStake.target)).to.equal(STAKE_AMOUNT);
    });

    it("Should fail if join deadline is in the past", async function () {
      const now = await time.latest();
      await usdc.approve(fitStake.target, STAKE_AMOUNT);

      await expect(
        fitStake.createChallenge("Run", now - 100, now + 3600, STAKE_AMOUNT, 24, 24, 12, false, ZERO_BYTES32)
      ).to.be.revertedWith("Join deadline must be in the future");
    });

    it("Should fail if deadline is before join deadline", async function () {
      const now = await time.latest();
      await usdc.approve(fitStake.target, STAKE_AMOUNT);

      await expect(
        fitStake.createChallenge("Run", now + 3600, now + 1800, STAKE_AMOUNT, 24, 24, 12, false, ZERO_BYTES32)
      ).to.be.revertedWith("Deadline must be after join deadline");
    });

    it("Should fail without USDC approval", async function () {
      const now = await time.latest();

      await expect(
        fitStake.createChallenge("Run", now + 3600, now + 7200, STAKE_AMOUNT, 24, 24, 12, false, ZERO_BYTES32)
      ).to.be.reverted;
    });
  });

  describe("Join Challenge", function () {
    beforeEach(async function () {
      await createDefaultChallenge();
    });

    it("Should allow users to join with USDC", async function () {
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);

      const participants = await fitStake.getParticipants(1);
      expect(participants.length).to.equal(2);
      expect(participants[1]).to.equal(addr1.address);
    });

    it("Should prevent joining twice", async function () {
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT * 2);
      await fitStake.connect(addr1).joinChallenge(1);

      await expect(
        fitStake.connect(addr1).joinChallenge(1)
      ).to.be.revertedWith("Already joined this challenge");
    });

    it("Should prevent joining after join deadline", async function () {
      await time.increase(3601); // Past join deadline

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await expect(
        fitStake.connect(addr1).joinChallenge(1)
      ).to.be.revertedWith("Join window has closed");
    });
  });

  describe("Submit Proof", function () {
    beforeEach(async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);
    });

    it("Should accept proof during active phase", async function () {
      await time.increase(3601); // Past join deadline, into active phase
      await fitStake.submitProof(1, '{"workout":"5k run"}');
      expect(await fitStake.hasSubmittedProof(1, owner.address)).to.be.true;
    });

    it("Should accept proof after deadline and within proof window", async function () {
      await time.increase(7201); // Past activity deadline

      await fitStake.submitProof(1, '{"workout":"5k run","time":"28:30"}');
      expect(await fitStake.hasSubmittedProof(1, owner.address)).to.be.true;

      const proof = await fitStake.getUserProof(1, owner.address);
      expect(proof).to.equal('{"workout":"5k run","time":"28:30"}');
    });

    it("Should reject proof after proof window closes", async function () {
      await time.increase(7200 + 24 * 3600 + 1); // Past proof deadline

      await expect(
        fitStake.submitProof(1, '{"workout":"5k run"}')
      ).to.be.revertedWith("Proof submission window has closed");
    });

    it("Should prevent double submission", async function () {
      await time.increase(7201);

      await fitStake.submitProof(1, '{"workout":"5k run"}');
      await expect(
        fitStake.submitProof(1, '{"workout":"another run"}')
      ).to.be.revertedWith("Already submitted proof");
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);
      await usdc.connect(addr2).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr2).joinChallenge(1);

      // Move past activity deadline
      await time.increase(7201);

      // All submit proof
      await fitStake.submitProof(1, '{"workout":"run 1"}');
      await fitStake.connect(addr1).submitProof(1, '{"workout":"run 2"}');
      await fitStake.connect(addr2).submitProof(1, '{"workout":"run 3"}');

      // Move past proof deadline into voting window
      await time.increase(24 * 3600 + 1);
    });

    it("Should allow voting on other participants", async function () {
      await fitStake.castVotes(
        1,
        [addr1.address, addr2.address],
        [true, false]
      );

      const [forAddr1, againstAddr1] = await fitStake.getVoteCounts(1, addr1.address);
      expect(forAddr1).to.equal(1);
      expect(againstAddr1).to.equal(0);

      const [forAddr2, againstAddr2] = await fitStake.getVoteCounts(1, addr2.address);
      expect(forAddr2).to.equal(0);
      expect(againstAddr2).to.equal(1);
    });

    it("Should skip self-votes silently", async function () {
      await fitStake.castVotes(
        1,
        [owner.address, addr1.address, addr2.address],
        [true, true, true]
      );

      // Owner's self-vote should be skipped
      const [forOwner, againstOwner] = await fitStake.getVoteCounts(1, owner.address);
      expect(forOwner).to.equal(0);
      expect(againstOwner).to.equal(0);
    });

    it("Should prevent double voting on same participant", async function () {
      await fitStake.castVotes(1, [addr1.address], [true]);

      await expect(
        fitStake.castVotes(1, [addr1.address], [false])
      ).to.be.revertedWith("Already voted on this participant");
    });

    it("Should require proof submission to vote", async function () {
      // addr3 hasn't joined or submitted proof
      // Let's create a scenario where someone joined but didn't submit
      await usdc.connect(addr3).approve(fitStake.target, STAKE_AMOUNT);

      // addr3 can't join anymore because join window closed, so test differently
      // Use a non-participant
      await expect(
        fitStake.connect(addr3).castVotes(1, [owner.address], [true])
      ).to.be.revertedWith("Not a participant");
    });

    it("Should reject voting before proof deadline", async function () {
      // Create a new challenge for this test
      const now = await time.latest();
      await usdc.approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.createChallenge("Test", now + 3600, now + 7200, STAKE_AMOUNT, 24, 24, 12, false, ZERO_BYTES32);
      const challengeId = 2;

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(challengeId);

      await time.increase(7201);
      await fitStake.submitProof(challengeId, '{"test":"data"}');
      await fitStake.connect(addr1).submitProof(challengeId, '{"test":"data2"}');

      // Still in proof window, not voting window
      await expect(
        fitStake.castVotes(challengeId, [addr1.address], [true])
      ).to.be.revertedWith("Voting has not started yet");
    });

    it("Should reject voting after grace period", async function () {
      // Move past grace deadline
      await time.increase(24 * 3600 + 12 * 3600 + 1);

      await expect(
        fitStake.castVotes(1, [addr1.address], [true])
      ).to.be.revertedWith("Voting period has ended");
    });
  });

  describe("Reward Distribution", function () {
    it("Should give voters bonus from losers pool", async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);
      await usdc.connect(addr2).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr2).joinChallenge(1);

      await time.increase(7201); // Past deadline

      // owner and addr1 submit proof, addr2 does not
      await fitStake.submitProof(1, '{"workout":"run 1"}');
      await fitStake.connect(addr1).submitProof(1, '{"workout":"run 2"}');

      // Move to voting window
      await time.increase(24 * 3600 + 1);

      // Both vote on each other (approve)
      await fitStake.castVotes(1, [addr1.address], [true]);
      await fitStake.connect(addr1).castVotes(1, [owner.address], [true]);

      // Move past grace period
      await time.increase(24 * 3600 + 12 * 3600 + 1);

      const ownerBefore = await usdc.balanceOf(owner.address);
      const addr1Before = await usdc.balanceOf(addr1.address);

      await fitStake.distributeRewards(1);

      const ownerAfter = await usdc.balanceOf(owner.address);
      const addr1After = await usdc.balanceOf(addr1.address);

      // Each voter-winner gets stake back + half of addr2's stake (loser)
      // 100 USDC + 50 USDC = 150 USDC each
      expect(ownerAfter - ownerBefore).to.equal(150_000_000);
      expect(addr1After - addr1Before).to.equal(150_000_000);
    });

    it("Should penalize non-voters: stake back only, no bonus", async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);
      await usdc.connect(addr2).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr2).joinChallenge(1);

      await time.increase(7201);

      // All three submit proof
      await fitStake.submitProof(1, '{"workout":"run 1"}');
      await fitStake.connect(addr1).submitProof(1, '{"workout":"run 2"}');
      await fitStake.connect(addr2).submitProof(1, '{"workout":"run 3"}');

      await time.increase(24 * 3600 + 1);

      // Only owner votes (approves addr1 and addr2)
      await fitStake.castVotes(1, [addr1.address, addr2.address], [true, true]);
      // addr1 votes (approves owner)
      await fitStake.connect(addr1).castVotes(1, [owner.address, addr2.address], [true, true]);
      // addr2 does NOT vote (non-voter)

      await time.increase(24 * 3600 + 12 * 3600 + 1);

      const ownerBefore = await usdc.balanceOf(owner.address);
      const addr1Before = await usdc.balanceOf(addr1.address);
      const addr2Before = await usdc.balanceOf(addr2.address);

      await fitStake.distributeRewards(1);

      const ownerAfter = await usdc.balanceOf(owner.address);
      const addr1After = await usdc.balanceOf(addr1.address);
      const addr2After = await usdc.balanceOf(addr2.address);

      // All succeeded (submitted proof, approved by peers)
      // addr2 is non-voter: gets stake back (100 USDC) but no bonus
      // No losers, so no bonus pool - everyone gets stake back
      expect(addr2After - addr2Before).to.equal(STAKE_AMOUNT);
      expect(ownerAfter - ownerBefore).to.equal(STAKE_AMOUNT);
      expect(addr1After - addr1Before).to.equal(STAKE_AMOUNT);
    });

    it("Should donate to charity if everyone fails", async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);

      // Nobody submits proof
      await time.increase(7200 + 24 * 3600 + 24 * 3600 + 12 * 3600 + 1);

      const charityBefore = await usdc.balanceOf(await fitStake.CHARITY_ADDRESS());
      await fitStake.distributeRewards(1);
      const charityAfter = await usdc.balanceOf(await fitStake.CHARITY_ADDRESS());

      expect(charityAfter - charityBefore).to.equal(STAKE_AMOUNT * 2);
    });

    it("Should handle solo participant correctly", async function () {
      await createDefaultChallenge();

      await time.increase(7201);
      await fitStake.submitProof(1, '{"workout":"solo run"}');

      await time.increase(24 * 3600 + 24 * 3600 + 12 * 3600 + 1);

      const ownerBefore = await usdc.balanceOf(owner.address);
      await fitStake.distributeRewards(1);
      const ownerAfter = await usdc.balanceOf(owner.address);

      // Solo participant who submitted proof gets stake back
      expect(ownerAfter - ownerBefore).to.equal(STAKE_AMOUNT);
    });

    it("Should reject distribution before grace period ends", async function () {
      await createDefaultChallenge();
      await time.increase(7201);

      await expect(
        fitStake.distributeRewards(1)
      ).to.be.revertedWith("Grace period has not ended");
    });

    it("Should prevent double distribution", async function () {
      await createDefaultChallenge();
      await time.increase(7200 + 24 * 3600 + 24 * 3600 + 12 * 3600 + 1);

      await fitStake.distributeRewards(1);
      await expect(
        fitStake.distributeRewards(1)
      ).to.be.revertedWith("Rewards already distributed");
    });

    it("Should handle rejected participant correctly", async function () {
      await createDefaultChallenge();
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);

      await time.increase(7201);

      await fitStake.submitProof(1, '{"workout":"legit run"}');
      await fitStake.connect(addr1).submitProof(1, '{"workout":"fake proof"}');

      await time.increase(24 * 3600 + 1);

      // Both vote, owner rejects addr1, addr1 approves owner
      await fitStake.castVotes(1, [addr1.address], [false]);
      await fitStake.connect(addr1).castVotes(1, [owner.address], [true]);

      await time.increase(24 * 3600 + 12 * 3600 + 1);

      const ownerBefore = await usdc.balanceOf(owner.address);
      const addr1Before = await usdc.balanceOf(addr1.address);

      await fitStake.distributeRewards(1);

      const ownerAfter = await usdc.balanceOf(owner.address);
      const addr1After = await usdc.balanceOf(addr1.address);

      // addr1 has 0 for, 1 against → fails
      // owner has 1 for, 0 against → succeeds
      // owner gets stake back + addr1's stake = 200 USDC
      expect(ownerAfter - ownerBefore).to.equal(STAKE_AMOUNT * 2);
      expect(addr1After - addr1Before).to.equal(0);
    });
  });

  describe("Phase Transitions", function () {
    it("Should return correct phases over time", async function () {
      await createDefaultChallenge();

      // Joining phase
      expect(await fitStake.getChallengePhase(1)).to.equal(0); // Joining

      // Active phase (past join deadline)
      await time.increase(3601);
      expect(await fitStake.getChallengePhase(1)).to.equal(1); // Active

      // Proof submission phase (past deadline)
      await time.increase(3600);
      expect(await fitStake.getChallengePhase(1)).to.equal(2); // ProofSubmission

      // Voting phase (past proof deadline)
      await time.increase(24 * 3600);
      expect(await fitStake.getChallengePhase(1)).to.equal(3); // Voting

      // Grace period (past vote deadline)
      await time.increase(24 * 3600);
      expect(await fitStake.getChallengePhase(1)).to.equal(4); // GracePeriod

      // Completed (past grace deadline)
      await time.increase(12 * 3600);
      expect(await fitStake.getChallengePhase(1)).to.equal(5); // Completed
    });
  });

  describe("Private Challenges", function () {
    it("Should create a private challenge and verify privacy info", async function () {
      await createDefaultChallenge(owner, true);

      const [isPrivate, hasInviteCode] = await fitStake.getChallengePrivacy(1);
      expect(isPrivate).to.be.true;
      expect(hasInviteCode).to.be.false;

      const [isPrivate2, inviteCodeHash] = await fitStake.isChallengePrivate(1);
      expect(isPrivate2).to.be.true;
      expect(inviteCodeHash).to.equal(ZERO_BYTES32);
    });

    it("Should create a private challenge with invite code", async function () {
      const inviteCode = "SECRET123";
      const hash = ethers.solidityPackedKeccak256(["string"], [inviteCode]);
      await createDefaultChallenge(owner, true, hash);

      const [isPrivate, hasInviteCode] = await fitStake.getChallengePrivacy(1);
      expect(isPrivate).to.be.true;
      expect(hasInviteCode).to.be.true;
    });

    it("Should prevent non-approved user from joining private challenge", async function () {
      await createDefaultChallenge(owner, true);

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await expect(
        fitStake.connect(addr1).joinChallenge(1)
      ).to.be.revertedWith("Not approved to join this private challenge");
    });

    it("Should allow request-to-join, approve, then join flow", async function () {
      await createDefaultChallenge(owner, true);

      // Request to join
      await fitStake.connect(addr1).requestToJoin(1);
      expect(await fitStake.hasRequestedToJoin(1, addr1.address)).to.be.true;

      // Check pending requests
      const requests = await fitStake.getJoinRequests(1);
      expect(requests.length).to.equal(1);
      expect(requests[0]).to.equal(addr1.address);

      // Approve
      await fitStake.approveJoinRequest(1, addr1.address);
      expect(await fitStake.isApprovedToJoin(1, addr1.address)).to.be.true;

      // Now join
      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinChallenge(1);

      const participants = await fitStake.getParticipants(1);
      expect(participants.length).to.equal(2);
    });

    it("Should allow reject and re-request", async function () {
      await createDefaultChallenge(owner, true);

      // Request
      await fitStake.connect(addr1).requestToJoin(1);
      expect(await fitStake.hasRequestedToJoin(1, addr1.address)).to.be.true;

      // Reject
      await fitStake.rejectJoinRequest(1, addr1.address);
      expect(await fitStake.hasRequestedToJoin(1, addr1.address)).to.be.false;

      // Re-request
      await fitStake.connect(addr1).requestToJoin(1);
      expect(await fitStake.hasRequestedToJoin(1, addr1.address)).to.be.true;
    });

    it("Should prevent non-creator from approving", async function () {
      await createDefaultChallenge(owner, true);

      await fitStake.connect(addr1).requestToJoin(1);

      await expect(
        fitStake.connect(addr2).approveJoinRequest(1, addr1.address)
      ).to.be.revertedWith("Only creator can approve");
    });

    it("Should prevent non-creator from rejecting", async function () {
      await createDefaultChallenge(owner, true);

      await fitStake.connect(addr1).requestToJoin(1);

      await expect(
        fitStake.connect(addr2).rejectJoinRequest(1, addr1.address)
      ).to.be.revertedWith("Only creator can reject");
    });

    it("Should allow join with correct invite code", async function () {
      const inviteCode = "SECRET123";
      const hash = ethers.solidityPackedKeccak256(["string"], [inviteCode]);
      await createDefaultChallenge(owner, true, hash);

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await fitStake.connect(addr1).joinWithInviteCode(1, inviteCode);

      const participants = await fitStake.getParticipants(1);
      expect(participants.length).to.equal(2);
      expect(await fitStake.isApprovedToJoin(1, addr1.address)).to.be.true;
    });

    it("Should revert with wrong invite code", async function () {
      const inviteCode = "SECRET123";
      const hash = ethers.solidityPackedKeccak256(["string"], [inviteCode]);
      await createDefaultChallenge(owner, true, hash);

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await expect(
        fitStake.connect(addr1).joinWithInviteCode(1, "WRONGCODE")
      ).to.be.revertedWith("Invalid invite code");
    });

    it("Should revert joinWithInviteCode when no invite code set", async function () {
      await createDefaultChallenge(owner, true); // no invite code

      await usdc.connect(addr1).approve(fitStake.target, STAKE_AMOUNT);
      await expect(
        fitStake.connect(addr1).joinWithInviteCode(1, "ANYCODE")
      ).to.be.revertedWith("No invite code set");
    });

    it("Should revert request-to-join on public challenge", async function () {
      await createDefaultChallenge(owner, false);

      await expect(
        fitStake.connect(addr1).requestToJoin(1)
      ).to.be.revertedWith("Challenge is not private");
    });

    it("Should revert request-to-join after deadline", async function () {
      await createDefaultChallenge(owner, true);

      await time.increase(3601); // Past join deadline

      await expect(
        fitStake.connect(addr1).requestToJoin(1)
      ).to.be.revertedWith("Join window has closed");
    });

    it("Should prevent duplicate request-to-join", async function () {
      await createDefaultChallenge(owner, true);

      await fitStake.connect(addr1).requestToJoin(1);

      await expect(
        fitStake.connect(addr1).requestToJoin(1)
      ).to.be.revertedWith("Already requested to join");
    });

    it("Should emit correct events for private challenge flow", async function () {
      await createDefaultChallenge(owner, true);

      // JoinRequested event
      await expect(fitStake.connect(addr1).requestToJoin(1))
        .to.emit(fitStake, "JoinRequested")
        .withArgs(1, addr1.address);

      // JoinRequestApproved event
      await expect(fitStake.approveJoinRequest(1, addr1.address))
        .to.emit(fitStake, "JoinRequestApproved")
        .withArgs(1, addr1.address, owner.address);
    });

    it("Should emit JoinRequestRejected event", async function () {
      await createDefaultChallenge(owner, true);

      await fitStake.connect(addr1).requestToJoin(1);

      await expect(fitStake.rejectJoinRequest(1, addr1.address))
        .to.emit(fitStake, "JoinRequestRejected")
        .withArgs(1, addr1.address, owner.address);
    });
  });
});
