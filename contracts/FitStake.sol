// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FitStake {
    enum Phase {
        Joining,
        Active,
        ProofSubmission,
        Voting,
        GracePeriod,
        Completed
    }

    struct Challenge {
        uint256 id;
        address creator;
        string goal;
        uint256 joinDeadline;
        uint256 deadline;
        uint256 proofDeadline;
        uint256 voteDeadline;
        uint256 graceDeadline;
        uint256 stakeAmount;
        address[] participants;
        mapping(address => bool) hasJoined;
        mapping(address => bool) hasSubmitted;
        mapping(address => string) proofData;
        // Voting: voter => participant => approved
        mapping(address => mapping(address => bool)) votes;
        mapping(address => mapping(address => bool)) hasVoted;
        mapping(address => uint256) votesFor;
        mapping(address => uint256) votesAgainst;
        mapping(address => bool) hasVotedAtAll;
        bool isDistributed;
        uint256 totalStaked;
        // Private challenge fields
        bool isPrivate;
        bytes32 inviteCodeHash;
        mapping(address => bool) joinRequested;
        address[] joinRequestList;
        mapping(address => bool) isApproved;
    }

    IERC20 public usdc;

    // St. Jude's charity address
    address public constant CHARITY_ADDRESS = 0x89e873251a6e37BbBb4800C64F8f20823e571975;

    uint256 public challengeCount;

    mapping(uint256 => Challenge) public challenges;

    // Events
    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed creator,
        string goal,
        uint256 joinDeadline,
        uint256 deadline,
        uint256 stakeAmount
    );
    event ParticipantJoined(uint256 indexed challengeId, address indexed participant, uint256 stakeAmount);
    event ProofSubmitted(uint256 indexed challengeId, address indexed participant, string proofData);
    event VotesCast(uint256 indexed challengeId, address indexed voter, uint256 approvalCount, uint256 rejectionCount);
    event RewardsDistributed(uint256 indexed challengeId, uint256 totalSucceeded, uint256 totalFailed);
    event CharityDonation(uint256 indexed challengeId, uint256 amount);
    event JoinRequested(uint256 indexed challengeId, address indexed requester);
    event JoinRequestApproved(uint256 indexed challengeId, address indexed user, address indexed approvedBy);
    event JoinRequestRejected(uint256 indexed challengeId, address indexed user, address indexed rejectedBy);

    constructor(address _usdcAddress) {
        usdc = IERC20(_usdcAddress);
    }

    function createChallenge(
        string memory _goal,
        uint256 _joinDeadline,
        uint256 _deadline,
        uint256 _stakeAmount,
        uint256 _proofWindowHours,
        uint256 _voteWindowHours,
        uint256 _graceHours,
        bool _isPrivate,
        bytes32 _inviteCodeHash
    ) external returns (uint256) {
        require(_joinDeadline > block.timestamp, "Join deadline must be in the future");
        require(_deadline > _joinDeadline, "Deadline must be after join deadline");
        require(_stakeAmount > 0, "Stake amount must be greater than 0");
        require(_proofWindowHours > 0, "Proof window must be greater than 0");
        require(_voteWindowHours > 0, "Vote window must be greater than 0");

        // Transfer USDC from creator
        require(usdc.transferFrom(msg.sender, address(this), _stakeAmount), "USDC transfer failed");

        challengeCount++;
        uint256 challengeId = challengeCount;

        Challenge storage c = challenges[challengeId];
        c.id = challengeId;
        c.creator = msg.sender;
        c.goal = _goal;
        c.joinDeadline = _joinDeadline;
        c.deadline = _deadline;
        c.proofDeadline = _deadline + (_proofWindowHours * 1 hours);
        c.voteDeadline = _deadline + (_proofWindowHours * 1 hours) + (_voteWindowHours * 1 hours);
        c.graceDeadline = _deadline + (_proofWindowHours * 1 hours) + (_voteWindowHours * 1 hours) + (_graceHours * 1 hours);
        c.stakeAmount = _stakeAmount;
        c.totalStaked = _stakeAmount;
        c.isDistributed = false;
        c.isPrivate = _isPrivate;
        c.inviteCodeHash = _inviteCodeHash;

        // Creator automatically joins (no approval needed)
        c.participants.push(msg.sender);
        c.hasJoined[msg.sender] = true;
        c.isApproved[msg.sender] = true;

        emit ChallengeCreated(challengeId, msg.sender, _goal, _joinDeadline, _deadline, _stakeAmount);
        emit ParticipantJoined(challengeId, msg.sender, _stakeAmount);

        return challengeId;
    }

    function joinChallenge(uint256 _challengeId) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(block.timestamp < c.joinDeadline, "Join window has closed");
        require(!c.hasJoined[msg.sender], "Already joined this challenge");

        // Private challenges require approval first
        if (c.isPrivate) {
            require(c.isApproved[msg.sender], "Not approved to join this private challenge");
        }

        require(usdc.transferFrom(msg.sender, address(this), c.stakeAmount), "USDC transfer failed");

        c.participants.push(msg.sender);
        c.hasJoined[msg.sender] = true;
        c.totalStaked += c.stakeAmount;

        emit ParticipantJoined(_challengeId, msg.sender, c.stakeAmount);
    }

    function requestToJoin(uint256 _challengeId) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(c.isPrivate, "Challenge is not private");
        require(block.timestamp < c.joinDeadline, "Join window has closed");
        require(!c.hasJoined[msg.sender], "Already joined this challenge");
        require(!c.joinRequested[msg.sender], "Already requested to join");

        c.joinRequested[msg.sender] = true;
        c.joinRequestList.push(msg.sender);

        emit JoinRequested(_challengeId, msg.sender);
    }

    function approveJoinRequest(uint256 _challengeId, address _user) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(msg.sender == c.creator, "Only creator can approve");
        require(c.isPrivate, "Challenge is not private");
        require(c.joinRequested[_user], "User has not requested to join");
        require(!c.isApproved[_user], "User already approved");

        c.isApproved[_user] = true;

        emit JoinRequestApproved(_challengeId, _user, msg.sender);
    }

    function rejectJoinRequest(uint256 _challengeId, address _user) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(msg.sender == c.creator, "Only creator can reject");
        require(c.isPrivate, "Challenge is not private");
        require(c.joinRequested[_user], "User has not requested to join");

        c.joinRequested[_user] = false;

        emit JoinRequestRejected(_challengeId, _user, msg.sender);
    }

    function joinWithInviteCode(uint256 _challengeId, string memory _inviteCode) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(c.isPrivate, "Challenge is not private");
        require(c.inviteCodeHash != bytes32(0), "No invite code set");
        require(
            keccak256(abi.encodePacked(_inviteCode)) == c.inviteCodeHash,
            "Invalid invite code"
        );
        require(block.timestamp < c.joinDeadline, "Join window has closed");
        require(!c.hasJoined[msg.sender], "Already joined this challenge");

        // Auto-approve and join
        c.isApproved[msg.sender] = true;

        require(usdc.transferFrom(msg.sender, address(this), c.stakeAmount), "USDC transfer failed");

        c.participants.push(msg.sender);
        c.hasJoined[msg.sender] = true;
        c.totalStaked += c.stakeAmount;

        emit ParticipantJoined(_challengeId, msg.sender, c.stakeAmount);
    }

    function submitProof(uint256 _challengeId, string memory _proofData) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(c.hasJoined[msg.sender], "Not a participant");
        require(block.timestamp <= c.proofDeadline, "Proof submission window has closed");
        require(!c.hasSubmitted[msg.sender], "Already submitted proof");
        require(!c.isDistributed, "Rewards already distributed");

        c.hasSubmitted[msg.sender] = true;
        c.proofData[msg.sender] = _proofData;

        emit ProofSubmitted(_challengeId, msg.sender, _proofData);
    }

    function castVotes(
        uint256 _challengeId,
        address[] memory _participants,
        bool[] memory _approvals
    ) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(c.hasJoined[msg.sender], "Not a participant");
        require(c.hasSubmitted[msg.sender], "Must submit proof to vote");
        require(block.timestamp >= c.proofDeadline, "Voting has not started yet");
        require(block.timestamp <= c.graceDeadline, "Voting period has ended");
        require(_participants.length == _approvals.length, "Arrays length mismatch");
        require(!c.isDistributed, "Rewards already distributed");

        uint256 approvalCount = 0;
        uint256 rejectionCount = 0;

        for (uint256 i = 0; i < _participants.length; i++) {
            address participant = _participants[i];

            // Skip self-votes
            if (participant == msg.sender) continue;

            // Must be a participant who submitted proof
            require(c.hasJoined[participant], "Not a valid participant");
            require(c.hasSubmitted[participant], "Participant has not submitted proof");

            // Prevent double voting on same participant
            require(!c.hasVoted[msg.sender][participant], "Already voted on this participant");

            c.hasVoted[msg.sender][participant] = true;
            c.votes[msg.sender][participant] = _approvals[i];

            if (_approvals[i]) {
                c.votesFor[participant]++;
                approvalCount++;
            } else {
                c.votesAgainst[participant]++;
                rejectionCount++;
            }
        }

        c.hasVotedAtAll[msg.sender] = true;

        emit VotesCast(_challengeId, msg.sender, approvalCount, rejectionCount);
    }

    function distributeRewards(uint256 _challengeId) external {
        Challenge storage c = challenges[_challengeId];

        require(c.id != 0, "Challenge does not exist");
        require(block.timestamp >= c.graceDeadline, "Grace period has not ended");
        require(!c.isDistributed, "Rewards already distributed");

        uint256 participantCount = c.participants.length;

        // Solo participant: auto-success if proof submitted
        if (participantCount == 1) {
            c.isDistributed = true;
            address solo = c.participants[0];
            if (c.hasSubmitted[solo]) {
                require(usdc.transfer(solo, c.stakeAmount), "USDC transfer failed");
            } else {
                require(usdc.transfer(CHARITY_ADDRESS, c.totalStaked), "USDC transfer failed");
                emit CharityDonation(_challengeId, c.totalStaked);
            }
            emit RewardsDistributed(_challengeId, c.hasSubmitted[solo] ? 1 : 0, c.hasSubmitted[solo] ? 0 : 1);
            return;
        }

        // Determine success: submitted proof + majority approval
        // For participants with 0 votes for and 0 against (no one voted on them), they succeed if they submitted proof
        uint256 voterSuccessCount = 0;
        uint256 nonVoterSuccessCount = 0;
        uint256 failCount = 0;

        for (uint256 i = 0; i < participantCount; i++) {
            address p = c.participants[i];
            bool succeeded = _isSuccessful(c, p);

            if (succeeded) {
                if (c.hasVotedAtAll[p]) {
                    voterSuccessCount++;
                } else {
                    nonVoterSuccessCount++;
                }
            } else {
                failCount++;
            }
        }

        uint256 totalSucceeded = voterSuccessCount + nonVoterSuccessCount;

        // Everyone failed: donate to charity
        if (totalSucceeded == 0) {
            c.isDistributed = true;
            require(usdc.transfer(CHARITY_ADDRESS, c.totalStaked), "USDC transfer failed");
            emit CharityDonation(_challengeId, c.totalStaked);
            emit RewardsDistributed(_challengeId, 0, failCount);
            return;
        }

        // Calculate bonus from losers' pool
        uint256 losersPool = failCount * c.stakeAmount;
        uint256 bonusPerVoterWinner = 0;
        if (voterSuccessCount > 0 && losersPool > 0) {
            bonusPerVoterWinner = losersPool / voterSuccessCount;
        }

        // Distribute
        uint256 distributed = 0;
        for (uint256 i = 0; i < participantCount; i++) {
            address p = c.participants[i];
            bool succeeded = _isSuccessful(c, p);

            if (succeeded) {
                uint256 payout = c.stakeAmount; // Everyone gets their stake back
                if (c.hasVotedAtAll[p] && bonusPerVoterWinner > 0) {
                    payout += bonusPerVoterWinner; // Only voters get bonus
                }
                // If no voters succeeded but non-voters did, give them stake + split of losers pool
                if (voterSuccessCount == 0 && losersPool > 0) {
                    payout += losersPool / totalSucceeded;
                }
                distributed += payout;
                require(usdc.transfer(p, payout), "USDC transfer failed");
            }
        }

        // Handle dust (rounding remainders)
        uint256 remaining = c.totalStaked - distributed;
        if (remaining > 0) {
            require(usdc.transfer(CHARITY_ADDRESS, remaining), "USDC transfer failed");
        }

        c.isDistributed = true;
        emit RewardsDistributed(_challengeId, totalSucceeded, failCount);
    }

    // Internal: check if participant succeeded
    function _isSuccessful(Challenge storage c, address p) internal view returns (bool) {
        if (!c.hasSubmitted[p]) return false;

        // If no votes cast on this participant, they succeed by default (proof submitted)
        if (c.votesFor[p] == 0 && c.votesAgainst[p] == 0) return true;

        // Simple majority: votesFor >= votesAgainst
        return c.votesFor[p] >= c.votesAgainst[p];
    }

    // View functions

    function getChallengePhase(uint256 _challengeId) external view returns (Phase) {
        Challenge storage c = challenges[_challengeId];
        if (c.id == 0) return Phase.Completed;
        if (c.isDistributed) return Phase.Completed;
        if (block.timestamp < c.joinDeadline) return Phase.Joining;
        if (block.timestamp < c.deadline) return Phase.Active;
        if (block.timestamp < c.proofDeadline) return Phase.ProofSubmission;
        if (block.timestamp < c.voteDeadline) return Phase.Voting;
        if (block.timestamp < c.graceDeadline) return Phase.GracePeriod;
        return Phase.Completed;
    }

    function getChallenge(uint256 _challengeId) external view returns (
        uint256 id,
        address creator,
        string memory goal,
        uint256 joinDeadline,
        uint256 deadline,
        uint256 proofDeadline,
        uint256 voteDeadline,
        uint256 graceDeadline,
        uint256 stakeAmount,
        uint256 participantCount,
        uint256 totalStaked,
        bool isDistributed
    ) {
        Challenge storage c = challenges[_challengeId];
        return (
            c.id,
            c.creator,
            c.goal,
            c.joinDeadline,
            c.deadline,
            c.proofDeadline,
            c.voteDeadline,
            c.graceDeadline,
            c.stakeAmount,
            c.participants.length,
            c.totalStaked,
            c.isDistributed
        );
    }

    function getChallengePrivacy(uint256 _challengeId) external view returns (
        bool _isPrivate,
        bool hasInviteCode
    ) {
        Challenge storage c = challenges[_challengeId];
        return (c.isPrivate, c.inviteCodeHash != bytes32(0));
    }

    function getParticipants(uint256 _challengeId) external view returns (address[] memory) {
        return challenges[_challengeId].participants;
    }

    function hasJoinedChallenge(uint256 _challengeId, address _user) external view returns (bool) {
        return challenges[_challengeId].hasJoined[_user];
    }

    function hasSubmittedProof(uint256 _challengeId, address _user) external view returns (bool) {
        return challenges[_challengeId].hasSubmitted[_user];
    }

    function getUserProof(uint256 _challengeId, address _user) external view returns (string memory) {
        return challenges[_challengeId].proofData[_user];
    }

    function getVoteCounts(uint256 _challengeId, address _participant) external view returns (uint256 forVotes, uint256 againstVotes) {
        return (challenges[_challengeId].votesFor[_participant], challenges[_challengeId].votesAgainst[_participant]);
    }

    function getVoteStatus(uint256 _challengeId, address _voter, address _participant) external view returns (bool hasVotedOnParticipant, bool approved) {
        Challenge storage c = challenges[_challengeId];
        return (c.hasVoted[_voter][_participant], c.votes[_voter][_participant]);
    }

    function hasVotedAtAll(uint256 _challengeId, address _voter) external view returns (bool) {
        return challenges[_challengeId].hasVotedAtAll[_voter];
    }

    // Private challenge view functions

    function getJoinRequests(uint256 _challengeId) external view returns (address[] memory) {
        Challenge storage c = challenges[_challengeId];
        // Count pending requests
        uint256 pendingCount = 0;
        for (uint256 i = 0; i < c.joinRequestList.length; i++) {
            if (c.joinRequested[c.joinRequestList[i]] && !c.isApproved[c.joinRequestList[i]] && !c.hasJoined[c.joinRequestList[i]]) {
                pendingCount++;
            }
        }

        address[] memory pending = new address[](pendingCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < c.joinRequestList.length; i++) {
            address addr = c.joinRequestList[i];
            if (c.joinRequested[addr] && !c.isApproved[addr] && !c.hasJoined[addr]) {
                pending[idx] = addr;
                idx++;
            }
        }
        return pending;
    }

    function isApprovedToJoin(uint256 _challengeId, address _user) external view returns (bool) {
        return challenges[_challengeId].isApproved[_user];
    }

    function hasRequestedToJoin(uint256 _challengeId, address _user) external view returns (bool) {
        return challenges[_challengeId].joinRequested[_user];
    }

    function isChallengePrivate(uint256 _challengeId) external view returns (bool _isPrivate, bytes32 _inviteCodeHash) {
        Challenge storage c = challenges[_challengeId];
        return (c.isPrivate, c.inviteCodeHash);
    }
}
