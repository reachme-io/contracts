const { expect } = require("chai");
const { ethers } = require("hardhat");

const SIGNER_ADDRESS = '0x3ae99FdBB2d7A003E32ebE430Cb2C75fC48a3a95'
const FEES_RECEIVER_ADDRESS = '0x5644e67b9B613c6c9B678a48d8173Cc548D2FB27'

describe("Reach", function () {
    let authority, reach;
    let deployer, treasuryAddress, user1, user2;

    beforeEach(async () => {
        [deployer, treasuryAddress, user1, user2] = await ethers.getSigners();

        // Deploy core contracts
        const Authority = await ethers.getContractFactory("ReachAuthority");
        authority = await Authority.deploy(
            deployer.address,
            SIGNER_ADDRESS,
        );

        const Reach = await ethers.getContractFactory("Reach");
        reach = await Reach.deploy(
            FEES_RECEIVER_ADDRESS,
            await authority.getAddress(),
        );
    });

    describe("Deployment", function () {
        it("Should set the correct fees receiver", async function () {
            expect(await reach.feesReceiver()).to.equal(FEES_RECEIVER_ADDRESS);
        });

        it("Should set the correct authority", async function () {
            expect(await reach.authority()).to.equal(await authority.getAddress());
        });

        it("Should set the correct default values", async function () {
            expect(await reach.platformFee()).to.equal(10);
            expect(await reach.responseTime()).to.equal(5 * 24 * 60 * 60); // 5 days in seconds
            expect(await reach.minimumPayment()).to.equal(ethers.parseEther("0.00001"));
        });
    });

    describe("Deposit", function () {
        it("Should allow a user to deposit funds", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "test-deposit-1";
            const instantAmount = depositAmount / 2n;
            const escrowAmount = depositAmount / 2n;
            
            await expect(reach.connect(user1).deposit(identifier, user2.address, { value: depositAmount }))
                .to.emit(reach, "PaymentDeposited")
                .withArgs(1, identifier, user1.address, user2.address, depositAmount, instantAmount - (instantAmount * 10n) / 100n, escrowAmount);
            
            const deposit = await reach.getDepositDetails(1);
            expect(deposit.identifier).to.equal(identifier);
            expect(deposit.requester).to.equal(user1.address);
            expect(deposit.recipient).to.equal(user2.address);
            expect(deposit.escrowAmount).to.equal(depositAmount / 2n);
            expect(deposit.released).to.be.false;
            expect(deposit.refunded).to.be.false;
        });

        it("Should revert if payment is below minimum", async function () {
            const belowMinimum = ethers.parseEther("0.00000005");
            await expect(reach.connect(user1).deposit("test", user2.address, { value: belowMinimum }))
                .to.be.revertedWithCustomError(reach, "InsufficientPayment");
        });

        it("Should revert if KOL address is zero", async function () {
            await expect(reach.connect(user1).deposit("test", ethers.ZeroAddress, { value: ethers.parseEther("1.0") }))
                .to.be.revertedWithCustomError(reach, "ZeroAddress");
        });

        it("Should revert if user tries to pay themselves", async function () {
            await expect(reach.connect(user1).deposit("test", user1.address, { value: ethers.parseEther("1.0") }))
                .to.be.revertedWith("Cannot pay yourself");
        });

        it("Should distribute funds correctly on deposit", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const instantAmount = depositAmount / 2n;
            const fee = (instantAmount * 10n) / 100n;
            const kolInstantAmount = instantAmount - fee;
            
            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);
            
            await reach.connect(user1).deposit("test-deposit", user2.address, { value: depositAmount });
            
            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);
            
            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);
        });

        it("Should revert if identifier already exists", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "duplicate-identifier";
            
            // First deposit with the identifier should succeed
            await reach.connect(user1).deposit(identifier, user2.address, { value: depositAmount });
            
            // Second deposit with the same identifier should fail
            await expect(reach.connect(user1).deposit(identifier, user2.address, { value: depositAmount }))
                .to.be.revertedWithCustomError(reach, "DuplicateIdentifier");
        });
    });

    describe("Release Funds", function () {
        beforeEach(async function () {
            // Grant ENGINE_ROLE to deployer for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            
            // Create a deposit
            await reach.connect(user1).deposit("test-release", user2.address, { value: ethers.parseEther("1.0") });
        });

        it("Should release funds to KOL", async function () {
            const depositId = 1;
            const deposit = await reach.getDepositDetails(depositId);
            const escrowAmount = deposit.escrowAmount;
            const fee = (escrowAmount * 10n) / 100n;
            const kolAmount = escrowAmount - fee;
            
            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);
            
            await expect(reach.releaseFunds(depositId))
                .to.emit(reach, "FundsReleased")
                .withArgs(depositId, "test-release", user2.address, kolAmount);
            
            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);
            
            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolAmount);
            
            const updatedDeposit = await reach.getDepositDetails(depositId);
            expect(updatedDeposit.released).to.be.true;
        });

        it("Should revert if deposit is already processed", async function () {
            const depositId = 1;
            
            // Release funds first time
            await reach.releaseFunds(depositId);
            
            // Try to release again
            await expect(reach.releaseFunds(depositId))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });

        it("Should revert if caller doesn't have ENGINE_ROLE", async function () {
            const depositId = 1;
            
            await expect(reach.connect(user1).releaseFunds(depositId))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });
    });

    describe("Refund", function () {
        beforeEach(async function () {
            // Grant ENGINE_ROLE to deployer for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            
            // Create a deposit
            await reach.connect(user1).deposit("test-refund", user2.address, { value: ethers.parseEther("1.0") });
        });

        it("Should refund funds to requester after response time", async function () {
            const depositId = 1;
            const deposit = await reach.getDepositDetails(depositId);
            
            // Fast forward time past response time
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]); // 5 days + 1 second
            await ethers.provider.send("evm_mine");
            
            const requesterBefore = await ethers.provider.getBalance(user1.address);
            
            await expect(reach.refund(depositId))
                .to.emit(reach, "RefundIssued")
                .withArgs(depositId, "test-refund", user1.address, deposit.escrowAmount);
            
            const requesterAfter = await ethers.provider.getBalance(user1.address);
            
            expect(requesterAfter - requesterBefore).to.equal(deposit.escrowAmount);
            
            const updatedDeposit = await reach.getDepositDetails(depositId);
            expect(updatedDeposit.refunded).to.be.true;
        });

        it("Should revert if response time has not elapsed", async function () {
            const depositId = 1;
            
            await expect(reach.refund(depositId))
                .to.be.revertedWithCustomError(reach, "TimeWindowNotElapsed");
        });

        it("Should revert if deposit is already processed", async function () {
            const depositId = 1;
            
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            
            // Refund first time
            await reach.refund(depositId);
            
            // Try to refund again
            await expect(reach.refund(depositId))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Admin Functions", function () {
        beforeEach(async function () {
            // Grant ADMIN_ROLE to deployer for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
        });

        it("Should update fees receiver", async function () {
            const newReceiver = user2.address;
            
            await expect(reach.updateFeesReceiver(newReceiver))
                .to.emit(reach, "FeesReceiverUpdated")
                .withArgs(FEES_RECEIVER_ADDRESS, newReceiver);
            
            expect(await reach.feesReceiver()).to.equal(newReceiver);
        });

        it("Should pause and unpause the contract", async function () {
            // First verify we can make a deposit when not paused
            await expect(
                reach.connect(user1).deposit("test-before-pause", user2.address, { value: ethers.parseEther("1.0") })
            ).to.not.be.reverted;
            
            // Pause the contract
            await reach.pause();
            
            // Verify the contract is paused
            const isPaused = await reach.paused();
            expect(isPaused).to.be.true;
            
            // Try to deposit while paused - this should fail
            await expect(
                reach.connect(user1).deposit("test-during-pause", user2.address, { value: ethers.parseEther("1.0") })
            ).to.be.reverted;
            
            // Unpause the contract
            await reach.unpause();
            
            // Verify the contract is unpaused
            const isUnpaused = await reach.paused();
            expect(isUnpaused).to.be.false;
            
            // Should be able to deposit after unpausing
            await expect(
                reach.connect(user1).deposit("test-after-unpause", user2.address, { value: ethers.parseEther("1.0") })
            ).to.not.be.reverted;
        });

        it("Should recover funds", async function () {
            // First create a deposit to have funds in the contract
            await reach.connect(user1).deposit("test-recover", user2.address, { value: ethers.parseEther("1.0") });
            
            const contractBalance = await ethers.provider.getBalance(await reach.getAddress());
            const userBefore = await ethers.provider.getBalance(user1.address);

            // Fast forward time past response time
            await ethers.provider.send("evm_increaseTime", [6 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            
            const tx = await reach.connect(user1).forceRefund(1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const userAfter = await ethers.provider.getBalance(user1.address);
            
            expect(userAfter - userBefore + gasUsed).to.equal(contractBalance);
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            // Create multiple deposits
            await reach.connect(user1).deposit("test-view-1", user2.address, { value: ethers.parseEther("1.0") });
            await reach.connect(user1).deposit("test-view-2", user2.address, { value: ethers.parseEther("0.5") });
        });

        it("Should return user deposits", async function () {
            const userDeposits = await reach.getUserDeposits(user1.address, 0, 10);
            expect(userDeposits.length).to.equal(2);
            expect(userDeposits[0]).to.equal(1);
            expect(userDeposits[1]).to.equal(2);
        });

        it("Should return deposit details", async function () {
            const deposit = await reach.getDepositDetails(1);
            expect(deposit.identifier).to.equal("test-view-1");
            expect(deposit.requester).to.equal(user1.address);
            expect(deposit.recipient).to.equal(user2.address);
            expect(deposit.escrowAmount).to.equal(ethers.parseEther("0.5")); // Half of the deposit amount
            expect(deposit.released).to.be.false;
            expect(deposit.refunded).to.be.false;
        });
    });
}); 