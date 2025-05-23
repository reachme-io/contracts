const hre = require("hardhat");
const { ethers } = require("hardhat");
const { exec } = require('child_process');
async function main() {
    console.log("Starting test deployment...");

    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    const MULTISIG_ADDRESS = '0x15D9e7F0Fb61763639cf678Be4ed41bD118839fb';
    const ENGINE_ADDRESS = '0x3ae99FdBB2d7A003E32ebE430Cb2C75fC48a3a95';

    const Authority = await ethers.getContractFactory("ReachAuthority");
    const authority = await Authority.deploy(
        MULTISIG_ADDRESS, // admin
        ENGINE_ADDRESS  // engine
    );
    await authority.waitForDeployment();
    console.log("Authority deployed to:", await authority.getAddress());

    const Reach = await ethers.getContractFactory("Reach");
    const reach = await Reach.deploy(
        MULTISIG_ADDRESS,
        await authority.getAddress()
    );
    await reach.waitForDeployment();
    console.log("Reach deployed to:", await reach.getAddress());

    console.log('-----------------------------------------------------------------------');
    console.log('| Variables \t\t | Address \t\t\t\t      |');
    console.log('-----------------------------------------------------------------------');
    console.log(`| Deployer \t\t | ${deployer.address} |`);
    console.log(`| Fee Reciver \t\t | ${FEES_RECEIVER_ADDRESS} |`);
    console.log(`| Engine  \t\t | ${ENGINE_ADDRESS} |`);
    console.log(`| Admin \t\t | ${MULTISIG_ADDRESS} |`);
    console.log('-----------------------------------------------------------------------');
    console.log('| Contract \t\t | Address \t\t\t\t      |');
    console.log('-----------------------------------------------------------------------');
    console.log(`| Authority \t\t | ${await authority.getAddress()} |`);
    console.log(`| Reach \t\t | ${await reach.getAddress()} |`);
    console.log('-----------------------------------------------------------------------');

    // run command in terminal to flatten each contract
    const cmd1 = `npx hardhat flatten contracts/Authority.sol > Authority_Flattened.sol`;
    const cmd2 = `npx hardhat flatten contracts/Reach.sol > Reach_Flattened.sol`;

    // run commands in terminal
    exec(cmd1);
    exec(cmd2);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 