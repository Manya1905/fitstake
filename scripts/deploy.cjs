const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  console.log(`Deploying FitStake contract to ${network}...`);

  // USDC addresses per network
  const usdcAddresses = {
    baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    hardhat: null, // Will deploy MockUSDC for local testing
    localhost: null,
  };

  let usdcAddress = usdcAddresses[network];

  // For local testing, deploy MockUSDC first
  if (!usdcAddress) {
    console.log("Deploying MockUSDC for local testing...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);
  }

  // Deploy FitStake
  const FitStake = await hre.ethers.getContractFactory("FitStake");
  const fitStake = await FitStake.deploy(usdcAddress);
  await fitStake.waitForDeployment();

  const address = await fitStake.getAddress();

  console.log("\n✅ FitStake deployed to:", address);
  console.log("USDC address:", usdcAddress);
  console.log("Save these addresses - you'll need them for the frontend!");

  if (network === "baseSepolia") {
    console.log(`\nVerify on Base Sepolia Explorer:`);
    console.log(`https://sepolia.basescan.org/address/${address}`);
  } else if (network === "base") {
    console.log(`\nVerify on Base Explorer:`);
    console.log(`https://basescan.org/address/${address}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
