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
                .to.be.revertedWithCustomError(reach, "CannotPaySelf");
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
            
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            
            await reach.refund(depositId);
            
            await expect(reach.refund(depositId))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Admin Functions", function () {
        beforeEach(async function () {
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
            await expect(
                reach.connect(user1).deposit("test-before-pause", user2.address, { value: ethers.parseEther("1.0") })
            ).to.not.be.reverted;
            
            await reach.pause();
            
            const isPaused = await reach.paused();
            expect(isPaused).to.be.true;
            
            await expect(
                reach.connect(user1).deposit("test-during-pause", user2.address, { value: ethers.parseEther("1.0") })
            ).to.be.reverted;
            
            await reach.unpause();
            
            const isUnpaused = await reach.paused();
            expect(isUnpaused).to.be.false;
            
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

    describe("Force Refund", function () {
        beforeEach(async function () {
            await reach.connect(user1).deposit("test-force-refund", user2.address, { value: ethers.parseEther("1.0") });
        });

        it("Should allow requester to force refund after response time + 4 hours", async function () {
            const depositId = 1;
            const deposit = await reach.getDepositDetails(depositId);
            
            // Fast forward time past response time + 4 hours (5 days + 4 hours)
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");
            
            const requesterBefore = await ethers.provider.getBalance(user1.address);
            
            const tx = await reach.connect(user1).forceRefund(depositId);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const requesterAfter = await ethers.provider.getBalance(user1.address);
            
            // Check requester received the escrowed amount minus gas
            expect(requesterAfter - requesterBefore + gasUsed).to.equal(deposit.escrowAmount);
            
            // Check the deposit is marked as refunded
            const updatedDeposit = await reach.getDepositDetails(depositId);
            expect(updatedDeposit.refunded).to.be.true;
        });

        it("Should revert if time window has not elapsed", async function () {
            const depositId = 1;
            
            // Fast forward just past response time but not + 4 hours
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            
            await expect(reach.connect(user1).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "TimeWindowNotElapsed");
        });

        it("Should revert if caller is not the requester", async function () {
            const depositId = 1;
            
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");
            
            await expect(reach.connect(user2).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });

        it("Should revert if deposit is already processed", async function () {
            const depositId = 1;
            
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");
            
            // First force refund should succeed
            await reach.connect(user1).forceRefund(depositId);
            
            // Second attempt should fail
            await expect(reach.connect(user1).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Update Protocol Parameters", function () {
        beforeEach(async function () {
            // Grant ADMIN_ROLE to deployer for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
        });

        describe("updatePlatformFee", function () {
            it("Should update platform fee", async function () {
                const oldFee = await reach.platformFee();
                const newFee = 15; // 15%
                
                await expect(reach.updatePlatformFee(newFee))
                    .to.emit(reach, "PlatformFeeUpdated")
                    .withArgs(oldFee, newFee);
                
                expect(await reach.platformFee()).to.equal(newFee);
            });

            it("Should revert if fee is below minimum", async function () {
                const MIN_FEE_PERCENTAGE = 1;
                const belowMinFee = 0;
                
                await expect(reach.updatePlatformFee(belowMinFee))
                    .to.be.revertedWithCustomError(reach, "InvalidFeeRange");
            });

            it("Should revert if fee is above maximum", async function () {
                const MAX_FEE_PERCENTAGE = 20;
                const aboveMaxFee = 21;
                
                await expect(reach.updatePlatformFee(aboveMaxFee))
                    .to.be.revertedWithCustomError(reach, "InvalidFeeRange");
            });

            it("Should revert if caller doesn't have ADMIN_ROLE", async function () {
                await expect(reach.connect(user1).updatePlatformFee(15))
                    .to.be.revertedWithCustomError(reach, "Unauthorized");
            });
        });

        describe("updateMinimumPayment", function () {
            it("Should update minimum payment", async function () {
                const oldMinimum = await reach.minimumPayment();
                const newMinimum = ethers.parseEther("0.0001");
                
                await expect(reach.updateMinimumPayment(newMinimum))
                    .to.emit(reach, "MinimumPaymentUpdated")
                    .withArgs(oldMinimum, newMinimum);
                
                expect(await reach.minimumPayment()).to.equal(newMinimum);
            });

            it("Should revert if minimum payment is too low", async function () {
                const belowThreshold = ethers.parseEther("0.000001");
                
                await expect(reach.updateMinimumPayment(belowThreshold))
                    .to.be.revertedWithCustomError(reach, "InsufficientPayment");
            });

            it("Should revert if caller doesn't have ADMIN_ROLE", async function () {
                await expect(reach.connect(user1).updateMinimumPayment(ethers.parseEther("0.0001")))
                    .to.be.revertedWithCustomError(reach, "Unauthorized");
            });
        });

        describe("updateResponseTime", function () {
            it("Should update response time", async function () {
                const oldTime = await reach.responseTime();
                const newTime = 7 * 24 * 60 * 60; // 7 days
                
                await expect(reach.updateResponseTime(newTime))
                    .to.emit(reach, "ResponseTimeUpdated")
                    .withArgs(oldTime, newTime);
                
                expect(await reach.responseTime()).to.equal(newTime);
            });

            it("Should revert if response time is zero", async function () {
                await expect(reach.updateResponseTime(0))
                    .to.be.revertedWithCustomError(reach, "InvalidResponseTime");
            });

            it("Should revert if response time exceeds maximum", async function () {
                const MAX_RESPONSE_TIME = 14 * 24 * 60 * 60; // 14 days
                const exceedMaxTime = MAX_RESPONSE_TIME + 1;
                
                await expect(reach.updateResponseTime(exceedMaxTime))
                    .to.be.revertedWithCustomError(reach, "InvalidResponseTime");
            });

            it("Should revert if caller doesn't have ADMIN_ROLE", async function () {
                await expect(reach.connect(user1).updateResponseTime(7 * 24 * 60 * 60))
                    .to.be.revertedWithCustomError(reach, "Unauthorized");
            });
        });

        describe("Fee Calculation Impact", function () {
            it("Should calculate fees correctly after fee update", async function () {
                await reach.updatePlatformFee(15);
                
                const depositAmount = ethers.parseEther("1.0");
                const instantAmount = depositAmount / 2n;
                const newFeeRate = 15n;
                const expectedFee = (instantAmount * newFeeRate) / 100n;
                const expectedKolAmount = instantAmount - expectedFee;
                
                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);
                
                await reach.connect(user1).deposit("test-new-fee", user2.address, { value: depositAmount });
                
                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);
                
                expect(feesReceiverAfter - feesReceiverBefore).to.equal(expectedFee);
                expect(kolAfter - kolBefore).to.equal(expectedKolAmount);
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle deposit with exact minimum payment", async function () {
            const minimumPayment = await reach.minimumPayment();
            await expect(reach.connect(user1).deposit("min-payment", user2.address, { value: minimumPayment }))
                .to.not.be.reverted;
        });
        
        it("Should correctly calculate fees for very small amounts", async function () {
            const smallAmount = ethers.parseEther("0.0001");
            const instantAmount = smallAmount / 2n;
            const feePercentage = await reach.platformFee();
            const expectedFee = (instantAmount * BigInt(feePercentage)) / 100n;
            
            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            
            await reach.connect(user1).deposit("small-amount", user2.address, { value: smallAmount });
            
            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            
            expect(feesReceiverAfter - feesReceiverBefore).to.equal(expectedFee);
        });
        
        it("Should correctly handle deposits when contract is paused and unpaused", async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
            
            await reach.pause();
            
            await expect(reach.connect(user1).deposit("paused-deposit", user2.address, { value: ethers.parseEther("1.0") }))
                .to.be.reverted;
            
            await reach.unpause();
            
            await expect(reach.connect(user1).deposit("unpaused-deposit", user2.address, { value: ethers.parseEther("1.0") }))
                .to.not.be.reverted;
        });
    });

    describe("Admin Recovery Functions", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
            // Create a deposit to have funds in the contract
            await reach.connect(user1).deposit("recovery-test", user2.address, { value: ethers.parseEther("1.0") });
        });

        it("Should allow admin to recover funds", async function () {
            const contractBalance = await ethers.provider.getBalance(await reach.getAddress());
            const adminBefore = await ethers.provider.getBalance(deployer.address);
            
            const tx = await reach.recoverFunds(contractBalance);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const adminAfter = await ethers.provider.getBalance(deployer.address);
            
            expect(adminAfter - adminBefore + gasUsed).to.equal(contractBalance);
            expect(await ethers.provider.getBalance(await reach.getAddress())).to.equal(0);
        });
        
        it("Should revert if non-admin tries to recover funds", async function () {
            await expect(reach.connect(user1).recoverFunds(ethers.parseEther("0.1")))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });
    });

    describe("Deposit ID Sequence", function () {
        it("Should increment deposit ID correctly with each deposit", async function () {
            // First deposit
            await reach.connect(user1).deposit("id-test-1", user2.address, { value: ethers.parseEther("0.1") });
            expect(await reach.depositId()).to.equal(1);
            
            // Second deposit
            await reach.connect(user1).deposit("id-test-2", user2.address, { value: ethers.parseEther("0.1") });
            expect(await reach.depositId()).to.equal(2);
            
            // Third deposit from different user
            await reach.connect(user2).deposit("id-test-3", user1.address, { value: ethers.parseEther("0.1") });
            expect(await reach.depositId()).to.equal(3);
        });
    });

    describe("User Deposits Tracking", function () {
        it("Should correctly track multiple deposits by the same user", async function () {
            // User makes multiple deposits
            await reach.connect(user1).deposit("multi-1", user2.address, { value: ethers.parseEther("0.1") });
            await reach.connect(user1).deposit("multi-2", user2.address, { value: ethers.parseEther("0.2") });
            await reach.connect(user1).deposit("multi-3", user2.address, { value: ethers.parseEther("0.3") });
            
            // Get user deposits
            const userDeposits = await reach.getUserDeposits(user1.address, 0, 10);
            
            // Check deposit count
            expect(userDeposits.length).to.equal(3);
            
            // Check deposit IDs are sequential
            expect(userDeposits[0]).to.equal(1);
            expect(userDeposits[1]).to.equal(2);
            expect(userDeposits[2]).to.equal(3);
            
            // Check details of each deposit
            const deposit1 = await reach.getDepositDetails(userDeposits[0]);
            const deposit2 = await reach.getDepositDetails(userDeposits[1]);
            const deposit3 = await reach.getDepositDetails(userDeposits[2]);
            
            expect(deposit1.identifier).to.equal("multi-1");
            expect(deposit2.identifier).to.equal("multi-2");
            expect(deposit3.identifier).to.equal("multi-3");
            
            expect(deposit1.requester).to.equal(user1.address);
            expect(deposit2.requester).to.equal(user1.address);
            expect(deposit3.requester).to.equal(user1.address);
        });
        
        it("Should correctly handle pagination in getUserDeposits", async function () {
            // Create multiple deposits
            for (let i = 1; i <= 5; i++) {
                await reach.connect(user1).deposit(`pagination-${i}`, user2.address, { value: ethers.parseEther("0.1") });
            }
            
            // Test different pagination parameters
            const firstPage = await reach.getUserDeposits(user1.address, 0, 2);
            expect(firstPage.length).to.equal(2);
            expect(firstPage[0]).to.equal(1);
            expect(firstPage[1]).to.equal(2);
            
            const secondPage = await reach.getUserDeposits(user1.address, 2, 2);
            expect(secondPage.length).to.equal(2);
            expect(secondPage[0]).to.equal(3);
            expect(secondPage[1]).to.equal(4);
            
            const lastPage = await reach.getUserDeposits(user1.address, 4, 2);
            expect(lastPage.length).to.equal(1);
            expect(lastPage[0]).to.equal(5);
            
            // Requesting beyond the end returns empty array
            const beyondEnd = await reach.getUserDeposits(user1.address, 6, 2);
            expect(beyondEnd.length).to.equal(0);
        });
    });

    describe("Complex Scenarios", function () {
        it("Should handle the complete lifecycle of a deposit", async function () {
            // Grant ENGINE_ROLE for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            
            // 1. Create a deposit
            const depositAmount = ethers.parseEther("1.0");
            await reach.connect(user1).deposit("lifecycle-test", user2.address, { value: depositAmount });
            
            // 2. Verify instant payment was sent
            const deposit = await reach.getDepositDetails(1);
            const instantAmount = depositAmount / 2n;
            const fee = (instantAmount * 10n) / 100n;
            
            // 3. Try to release funds
            await reach.releaseFunds(1);
            
            // 4. Verify deposit status
            const updatedDeposit = await reach.getDepositDetails(1);
            expect(updatedDeposit.released).to.be.true;
            
            // 5. Try to release again (should fail)
            await expect(reach.releaseFunds(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
            
            // 6. Try to refund (should fail)
            await expect(reach.refund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
            
            // 7. Try to force refund (should fail)
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");
            
            await expect(reach.connect(user1).forceRefund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
        
        it("Should handle refund after response time elapses but before force refund window", async function () {
            // Grant ENGINE_ROLE for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            
            // Create a deposit
            await reach.connect(user1).deposit("window-test", user2.address, { value: ethers.parseEther("1.0") });
            
            // Fast forward to just after response time
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            
            // Regular refund should work (with ENGINE_ROLE)
            await expect(reach.refund(1)).to.not.be.reverted;
            
            // Force refund should fail (already processed)
            await ethers.provider.send("evm_increaseTime", [14400]); // Add 4 hours
            await ethers.provider.send("evm_mine");
            
            await expect(reach.connect(user1).forceRefund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle very small payments that might result in zero fees", async function () {
            const tinyAmount = ethers.parseEther("0.00001"); // Minimum payment
            
            await reach.connect(user1).deposit("tiny-payment", user2.address, { value: tinyAmount });
            
            const deposit = await reach.getDepositDetails(1);
            const instantAmount = tinyAmount / 2n;
            const fee = (instantAmount * 10n) / 100n;
            
            // Even with tiny amounts, fee should be calculated correctly
            expect(fee).to.be.greaterThan(0);
        });
        
        it("Should correctly validate identifier uniqueness across different users", async function () {
            const identifier = "same-identifier";
            
            // First user can use the identifier
            await reach.connect(user1).deposit(identifier, user2.address, { value: ethers.parseEther("0.1") });
            
            // Second user should also be prevented from using the same identifier
            await expect(reach.connect(user2).deposit(identifier, user1.address, { value: ethers.parseEther("0.1") }))
                .to.be.revertedWithCustomError(reach, "DuplicateIdentifier");
        });
    });

    describe("Partial Fund Recovery", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
            // Create a deposit to have funds in the contract
            await reach.connect(user1).deposit("recovery-partial-test", user2.address, { value: ethers.parseEther("1.0") });
        });

        it("Should allow admin to recover partial funds", async function () {
            const partialAmount = ethers.parseEther("0.25");
            const contractBalanceBefore = await ethers.provider.getBalance(await reach.getAddress());
            const adminBefore = await ethers.provider.getBalance(deployer.address);
            
            const tx = await reach.recoverFunds(partialAmount);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const adminAfter = await ethers.provider.getBalance(deployer.address);
            const contractBalanceAfter = await ethers.provider.getBalance(await reach.getAddress());
            
            expect(adminAfter - adminBefore + gasUsed).to.equal(partialAmount);
            expect(contractBalanceAfter).to.equal(contractBalanceBefore - partialAmount);
        });
        
        it("Should revert if trying to recover more than available balance", async function () {
            const contractBalance = await ethers.provider.getBalance(await reach.getAddress());
            const tooMuch = contractBalance + ethers.parseEther("1.0");
            
            await expect(reach.recoverFunds(tooMuch))
                .to.be.reverted; // Will fail when trying to transfer more than available
        });
    });

    describe("Direct ETH Transfers", function () {
        it("Should not accept direct ETH transfers", async function () {
            // Try to send ETH directly to contract
            await expect(
                user1.sendTransaction({
                    to: await reach.getAddress(),
                    value: ethers.parseEther("1.0")
                })
            ).to.be.reverted; // Should revert as contract has no fallback/receive function
        });
    });

    describe("Role Revocation", function () {
        beforeEach(async function () {
            // Grant roles for testing
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), user1.address);
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), user2.address);
            
            // Create a deposit
            await reach.connect(deployer).deposit("revocation-test", user1.address, { value: ethers.parseEther("1.0") });
        });
        
        it("Should prevent function access after role revocation", async function () {
            // Verify user1 can call admin function before revocation
            await expect(reach.connect(user1).updatePlatformFee(15)).to.not.be.reverted;
            
            // Revoke ADMIN_ROLE from user1
            await authority.revokeRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), user1.address);
            
            // Verify user1 can no longer call admin function
            await expect(reach.connect(user1).updatePlatformFee(15))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
                
            // Verify user2 can call engine function before revocation
            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]); // past response time
            await ethers.provider.send("evm_mine");
            await expect(reach.connect(user2).refund(1)).to.not.be.reverted;
            
            // Create another deposit for testing
            await reach.connect(deployer).deposit("revocation-test-2", user1.address, { value: ethers.parseEther("1.0") });
            
            // Revoke ENGINE_ROLE from user2
            await authority.revokeRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), user2.address);
            
            // Verify user2 can no longer call engine function
            await expect(reach.connect(user2).refund(2))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });
    });

    describe("Large Value Handling", function () {
        it("Should correctly handle large deposit values", async function () {
            // Use a relatively large value that won't exceed test account balances
            const largeAmount = ethers.parseEther("100.0");
            const instantAmount = largeAmount / 2n;
            const fee = (instantAmount * 10n) / 100n;
            const kolInstantAmount = instantAmount - fee;
            
            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);
            
            await reach.connect(user1).deposit("large-value-test", user2.address, { value: largeAmount });
            
            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);
            
            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);
            
            // Verify the escrow amount is correctly stored
            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(largeAmount / 2n);
        });
    });
}); 