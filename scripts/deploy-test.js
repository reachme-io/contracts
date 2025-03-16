const hre = require("hardhat");
const { ethers } = require("hardhat");
const { exec } = require('child_process');
async function main() {
    console.log("Starting test deployment...");

    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    const FEES_RECEIVER_ADDRESS = deployer.address;

    // Deploy Authority
    const Reach = await ethers.getContractFactory("Reach");
    const reach = await Reach.deploy(
        FEES_RECEIVER_ADDRESS,
    );
    await reach.waitForDeployment();
    console.log("Reach deployed to:", await reach.getAddress());

    console.log('-----------------------------------------------------------------------');
    console.log('| Contract \t\t | Address \t\t\t\t      |');
    console.log('-----------------------------------------------------------------------');
    console.log(`| Reach \t\t | ${await reach.getAddress()} |`);
    console.log('-----------------------------------------------------------------------');

    const cmd = `npx hardhat flatten contracts/Reach.sol > Reach_Flattened.sol`

    exec(cmd);

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 