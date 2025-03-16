const { expect } = require("chai");
const { ethers } = require("hardhat");

async function generateSignature(domainSeparator, buyer, partyId, amount, deadline, nonce, proofSigner) {
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "address", "uint256", "uint256", "uint256", "uint256"],
            [domainSeparator, buyer, partyId, amount, deadline, nonce]
        )
    );

    const signature = await proofSigner.signMessage(ethers.getBytes(messageHash));
    return signature;
}

function calculateVestingRatio(
    investmentTokenDecimals,
    redeemableTokenDecimals,
    desiredConversionRate
) {
    const investmentAdjustment = 18 - investmentTokenDecimals;
    const baseRatio = BigInt(desiredConversionRate) * BigInt(10 ** redeemableTokenDecimals);
    const finalRatio = baseRatio * BigInt(10 ** investmentAdjustment);
    return finalRatio.toString();
}

describe("Droppod", function () {
    let authority, droppod, droppodRouter;
    let mockUSDC, mockToken;
    let deployer, proofSigner, user1, user2;
    let domainSeparator;

    beforeEach(async () => {
        [deployer, proofSigner, user1, user2] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
        mockToken = await MockERC20.deploy("Mock Token", "MTK", 18);

        // Mint initial balances
        await mockUSDC.mint(deployer.address, ethers.parseUnits("1000000", 6));
        await mockUSDC.mint(user1.address, ethers.parseUnits("1000000", 6));
        await mockToken.mint(deployer.address, ethers.parseUnits("1000000", 18));

        // Deploy core contracts
        const Authority = await ethers.getContractFactory("DroppodAuthority");
        authority = await Authority.deploy(
            deployer.address,
            deployer.address,
            proofSigner.address
        );

        const Droppod = await ethers.getContractFactory("Droppod");
        droppod = await Droppod.deploy(
            "Droppod",
            "[dp]",
            await authority.getAddress(),
            "https://api.droppod.io/api/metadata"
        );

        const DroppodRouter = await ethers.getContractFactory("DroppodRouter");
        droppodRouter = await DroppodRouter.deploy(
            await authority.getAddress(),
            await droppod.getAddress()
        );

        // Setup roles
        const ADMIN_ROLE = await authority.ADMIN_ROLE();
        const ROUTER_ROLE = await authority.ROUTER_ROLE();
        await authority.grantRole(ROUTER_ROLE, await droppodRouter.getAddress());

        domainSeparator = await droppodRouter.DOMAIN_SEPARATOR();
    });

    describe("Party Creation", function () {
        it("Should create a party successfully", async function () {
            const tx = await droppodRouter.createParty(
                'test-party',
                ethers.parseUnits("100", 6),
                await mockUSDC.getAddress(),
                user1.address,
                true
            );

            const receipt = await tx.wait();
            const partyCreatedEvent = receipt.logs.find(
                log => log.topics[0] === droppod.interface.getEvent("PartyCreated").topicHash
            );

            expect(partyCreatedEvent).to.not.be.undefined;

            const decodedEvent = droppod.interface.decodeEventLog(
                "PartyCreated",
                partyCreatedEvent.data,
                partyCreatedEvent.topics
            );

            expect(decodedEvent.identifier).to.equal('test-party');
            expect(decodedEvent.targetAmount).to.equal(ethers.parseUnits("100", 6));
            expect(decodedEvent.beneficiary).to.equal(user1.address);
        });
    });

    describe("Pod Purchase", function () {
        let partyId;

        beforeEach(async function () {
            const tx = await droppodRouter.createParty(
                'test-party',
                ethers.parseUnits("100", 6),
                await mockUSDC.getAddress(),
                user1.address,
                true
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.topics[0] === droppod.interface.getEvent("PartyCreated").topicHash
            );
            partyId = droppod.interface.decodeEventLog(
                "PartyCreated",
                event.data,
                event.topics
            ).partyId;

            await mockUSDC.connect(user1).approve(
                await droppodRouter.getAddress(),
                ethers.parseUnits("100", 6)
            );
        });

        it("Should purchase a pod successfully", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const nonce = 0;
            const amount = ethers.parseUnits("10", 6);

            const signature = await generateSignature(
                domainSeparator,
                user1.address,
                partyId,
                amount,
                deadline,
                nonce,
                proofSigner
            );

            const tx = await droppodRouter.connect(user1).purchasePod(
                partyId,
                amount,
                deadline,
                nonce,
                signature
            );

            const receipt = await tx.wait();
            const podCreatedEvent = receipt.logs.find(
                log => log.topics[0] === droppod.interface.getEvent("PodCreated").topicHash
            );

            expect(podCreatedEvent).to.not.be.undefined;
        });
    });

    describe("Token Redemption", function () {
        let partyId, podId;

        beforeEach(async function () {
            // Create party and purchase pod
            const partyTx = await droppodRouter.createParty(
                'test-party',
                ethers.parseUnits("100", 6),
                await mockUSDC.getAddress(),
                user1.address,
                true
            );
            const partyReceipt = await partyTx.wait();
            partyId = droppod.interface.decodeEventLog(
                "PartyCreated",
                partyReceipt.logs[0].data,
                partyReceipt.logs[0].topics
            ).partyId;

            await mockUSDC.connect(user1).approve(
                await droppodRouter.getAddress(),
                ethers.parseUnits("100", 6)
            );

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signature = await generateSignature(
                domainSeparator,
                user1.address,
                partyId,
                ethers.parseUnits("10", 6),
                deadline,
                0,
                proofSigner
            );

            const podTx = await droppodRouter.connect(user1).purchasePod(
                partyId,
                ethers.parseUnits("10", 6),
                deadline,
                0,
                signature
            );
            const podReceipt = await podTx.wait();
            podId = droppod.interface.decodeEventLog(
                "PodCreated",
                podReceipt.logs[0].data,
                podReceipt.logs[0].topics
            ).podId;
        });

        it("Should set redeemable terms and claim tokens", async function () {
            const block = await ethers.provider.getBlock();
            const currentTime = block.timestamp;
            const cliffDuration = 15;
            const vestingDuration = 60;

            await mockToken.approve(
                await droppodRouter.getAddress(),
                ethers.parseUnits("1000000", 18)
            );

            await droppodRouter.setRedeemableTerms(
                partyId,
                currentTime + cliffDuration,
                vestingDuration,
                calculateVestingRatio(6, 18, 2),
                ethers.parseUnits("1000", 18),
                await mockToken.getAddress(),
                true
            );

            // Wait for cliff to pass
            await ethers.provider.send("evm_increaseTime", [cliffDuration + 30]);
            await ethers.provider.send("evm_mine");

            const claimableAmount = await droppod.getClaimableAmount(podId);
            expect(claimableAmount).to.be.gt(0);

            await droppod.connect(user1).claimPod(podId);
            const userBalance = await mockToken.balanceOf(user1.address);
            expect(userBalance).to.be.gt(0);
        });
    });
}); 