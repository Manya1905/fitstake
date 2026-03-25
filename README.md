# FitStake

A decentralized fitness accountability platform on Base. Users stake USDC on fitness challenges, submit proof of their workouts, and vote on each other's submissions. Winners split the losers' pool — if everyone fails, stakes go to charity.

## How It Works

1. **Create a Challenge** — Set a fitness goal (e.g., "Run 5K three times this week"), stake amount in USDC, join deadline, and activity deadline. Challenges can be public or private (invite code required).

2. **Join** — Other users join the challenge by staking the same USDC amount. For private challenges, the creator approves join requests.

3. **Submit Proof** — Participants upload photos, videos, or fitness app data as proof they completed the challenge. Proof can be submitted anytime after joining, up until the proof deadline.

4. **Vote** — After the proof deadline, participants vote to approve or reject each other's submissions. You must submit proof yourself to be eligible to vote.

5. **Distribute Rewards** — After the voting and grace period:
   - **Winners** (submitted proof + majority approval + voted) get their stake back plus a share of the losers' pool
   - **Winners who didn't vote** get their stake back but no bonus
   - **Losers** (no proof, rejected, or insufficient proofs) lose their stake
   - **If everyone fails**, all stakes are donated to charity

## Architecture

- **Smart Contract** (`FitStake.sol`) — Solidity 0.8.28, deployed on Base (L2). Handles staking, proof storage, voting, and reward distribution. Uses USDC (6 decimals) via IERC20.
- **Frontend** ([fitstake-frontend](https://github.com/Manya1905/fitstake-frontend)) — React PWA with Privy smart wallets for gasless, embedded wallet UX.
- **Backend** ([fitstake-backend](https://github.com/Manya1905/fitstake-backend)) — Express server for fitness API OAuth (Strava/Fitbit), user registry, and vote reason storage.

## Key Design Decisions

- **Gasless transactions** — Users interact through Coinbase smart wallets with a paymaster, so they never need to hold ETH
- **USDC staking** — Stablecoins avoid crypto volatility for real-money accountability
- **On-chain proof storage** — Proof data (Cloudinary URLs + metadata as JSON) is stored on-chain for transparency
- **Charity failsafe** — If all participants fail, stakes go to a charity address rather than being locked forever

## Contract Details

| Item | Value |
|------|-------|
| Network | Base Mainnet (Chain ID: 8453) |
| Solidity | 0.8.28 with viaIR optimizer |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Setup

```bash
npm install
cp .env.example .env
# Add your deployer private key to .env
npx hardhat test
npx hardhat compile
```

## Deploy

```bash
npx hardhat ignition deploy ignition/modules/FitStake.js --network base
```
