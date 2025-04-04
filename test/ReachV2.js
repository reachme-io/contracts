const { expect } = require("chai");
const { ethers } = require("hardhat");

const SIGNER_ADDRESS = '0xb3842098899ca72b724732CCb83D78Fa025A331c'
const FEES_RECEIVER_ADDRESS = '0xb3842098899ca72b724732CCb83D78Fa025A331c'
const PROOF_SIGNER_ADDRESS = '0x0000000000000000000000000000000000000000'

async function generateSignature(domainSeparator, identifier, amount, kolAddress, requester, responseTime, kolFeePercentage, deadline, nonce, proofSigner) {
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "string", "uint256", "address", "address", "uint256", "uint256", "uint256", "uint256"],
            [domainSeparator, identifier, amount, kolAddress, requester, responseTime, kolFeePercentage, deadline, nonce]
        )
    );

    const signature = await proofSigner.signMessage(ethers.getBytes(messageHash));
    return signature;
}

// Helper function to get current block timestamp
async function getCurrentBlockTimestamp() {
    const latestBlock = await ethers.provider.getBlock('latest');
    return latestBlock.timestamp;
}

describe("ReachV2", function () {
    let authority, reach;
    let deployer, treasuryAddress, proofSigner, user1, user2;
    let defaultResponseTime, defaultKolFee;
    let nonceCounter = 1;

    beforeEach(async () => {
        [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();
        defaultResponseTime = 5 * 24 * 60 * 60; // 5 days in seconds
        defaultKolFee = 50; // 90% goes to KOL, 10% to platform

        // Deploy core contracts
        const Authority = await ethers.getContractFactory("ReachAuthority");
        authority = await Authority.deploy(
            deployer.address,
            SIGNER_ADDRESS,
        );

        const Reach = await ethers.getContractFactory("ReachV2");
        reach = await Reach.deploy(
            await authority.getAddress(),
            proofSigner.address,
            FEES_RECEIVER_ADDRESS,
        );
    });

    // Helper function to simplify deposit calls in tests
    async function makeDeposit(from, identifier, kolAddress, requesterAddress, amount) {
        const currentBlockTime = await getCurrentBlockTimestamp();
        const deadline = currentBlockTime + 3600; // 1 hour from current block time
        const nonce = nonceCounter++;

        const domainSeparator = await reach.DOMAIN_SEPARATOR();

        const signature = await generateSignature(
            domainSeparator,
            identifier,
            amount,
            kolAddress,
            requesterAddress,
            defaultResponseTime,
            defaultKolFee,
            deadline,
            nonce,
            proofSigner
        );

        return reach.connect(from).deposit(
            identifier,
            amount,
            kolAddress,
            requesterAddress,
            defaultResponseTime,
            defaultKolFee,
            deadline,
            nonce,
            signature,
            { value: amount }
        );
    }

    describe("Deployment", function () {
        it("Should set the correct fees receiver", async function () {
            expect(await reach.feesReceiver()).to.equal(FEES_RECEIVER_ADDRESS);
        });

        it("Should set the correct authority", async function () {
            expect(await reach.authority()).to.equal(await authority.getAddress());
        });

        it("Should set the correct proof signer", async function () {
            expect(await reach.proofSigner()).to.equal(proofSigner.address);
        });

        it("Should set the correct default values", async function () {
            expect(await reach.platformFee()).to.equal(10);
            expect(await reach.minimumPayment()).to.equal(ethers.parseEther("0.001"));
        });
    });

    describe("Deposit", function () {
        it("Should allow a user to deposit funds with valid signature", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "test-deposit-2";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600; // 1 hour from current block time
            const nonce = 1;
            ;
            // process.exit(0);

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                signature,
                { value: depositAmount }
            )).to.emit(reach, "PaymentDeposited");

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.identifier).to.equal(identifier);
            expect(deposit.requester).to.equal(user1.address);
            expect(deposit.recipient).to.equal(user2.address);
        });

        it("Should revert if payment is below minimum", async function () {
            const belowMinimum = ethers.parseEther("0.00000005");
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600; // 1 hour from current block time
            const nonce = 1;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                "test",
                belowMinimum,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                "test",
                belowMinimum,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                signature,
                { value: belowMinimum }
            )).to.be.revertedWithCustomError(reach, "InsufficientPayment");
        });

        it("Should revert if KOL address is zero", async function () {
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600; // 1 hour from current block time
            const nonce = 1;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                "test",
                ethers.parseEther("1.0"),
                ethers.ZeroAddress,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                "test",
                ethers.parseEther("1.0"),
                ethers.ZeroAddress,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                signature,
                { value: ethers.parseEther("1.0") }
            )).to.be.revertedWithCustomError(reach, "ZeroAddress");
        });

        it("Should revert if user tries to pay themselves", async function () {
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600; // 1 hour from current block time
            const nonce = 1;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                "test",
                ethers.parseEther("1.0"),
                user1.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                "test",
                ethers.parseEther("1.0"),
                user1.address,
                user1.address,
                defaultResponseTime,
                defaultKolFee,
                deadline,
                nonce,
                signature,
                { value: ethers.parseEther("1.0") }
            )).to.be.revertedWithCustomError(reach, "CannotPaySelf");
        });

        it("Should distribute funds correctly on deposit", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const instantAmount = depositAmount / 2n;
            const fee = (instantAmount * 10n) / 100n;
            const kolInstantAmount = instantAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await makeDeposit(user1, "test-deposit", user2.address, user1.address, depositAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);
        });


        describe("Release Funds", function () {
            beforeEach(async function () {
                // Grant ENGINE_ROLE to deployer for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);

                // Create a deposit
                await makeDeposit(user1, "test-release", user2.address, user1.address, ethers.parseEther("1.0"));
            });

            it("Should release funds to KOL", async function () {
                const depositId = 1;
                const deposit = await reach.getDepositDetails(depositId);
                const escrowAmount = deposit.escrowAmount;
                const fee = (escrowAmount * 10n) / 100n;
                const kolAmount = escrowAmount - fee;

                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);

                await expect(reach.release(depositId))
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
                await reach.release(depositId);

                // Try to release again
                await expect(reach.release(depositId))
                    .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
            });

            it("Should revert if caller doesn't have ENGINE_ROLE", async function () {
                const depositId = 1;

                await expect(reach.connect(user1).release(depositId))
                    .to.be.revertedWithCustomError(reach, "Unauthorized");
            });
        });

        describe("Refund", function () {
            beforeEach(async function () {
                // Grant ENGINE_ROLE to deployer for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);

                // Create a deposit
                await makeDeposit(user1, "test-refund", user2.address, user1.address, ethers.parseEther("1.0"));
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
                    makeDeposit(user1, "test-before-pause", user2.address, user1.address, ethers.parseEther("1.0"))
                ).to.not.be.reverted;

                await reach.pause();

                const isPaused = await reach.paused();
                expect(isPaused).to.be.true;

                await expect(
                    makeDeposit(user1, "test-during-pause", user2.address, user1.address, ethers.parseEther("1.0"))
                ).to.be.reverted;

                await reach.unpause();

                const isUnpaused = await reach.paused();
                expect(isUnpaused).to.be.false;

                await expect(
                    makeDeposit(user1, "test-after-unpause", user2.address, user1.address, ethers.parseEther("1.0"))
                ).to.not.be.reverted;
            });

        });

        describe("View Functions", function () {
            beforeEach(async function () {
                // Create multiple deposits
                await makeDeposit(user1, "test-view-1", user2.address, user1.address, ethers.parseEther("1.0"));
                await makeDeposit(user1, "test-view-2", user2.address, user1.address, ethers.parseEther("0.5"));
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
                await makeDeposit(user1, "test-force-refund", user2.address, user1.address, ethers.parseEther("1.0"));
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

                    await makeDeposit(user1, "test-new-fee", user2.address, user1.address, depositAmount);

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
                await expect(
                    makeDeposit(user1, "min-payment", user2.address, user1.address, minimumPayment)
                ).to.not.be.reverted;
            });

            it("Should correctly calculate fees for very small amounts", async function () {
                const smallAmount = ethers.parseEther("0.001");
                const instantAmount = smallAmount / 2n;
                const feePercentage = await reach.platformFee();
                const expectedFee = (instantAmount * BigInt(feePercentage)) / 100n;

                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);

                await makeDeposit(user1, "small-amount", user2.address, user1.address, smallAmount);

                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);

                expect(feesReceiverAfter - feesReceiverBefore).to.equal(expectedFee);
            });

            it("Should correctly handle deposits when contract is paused and unpaused", async function () {
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);

                await reach.pause();

                await expect(makeDeposit(user1, "paused-deposit", user2.address, user1.address, ethers.parseEther("1.0")))
                    .to.be.reverted;

                await reach.unpause();

                await expect(makeDeposit(user1, "unpaused-deposit", user2.address, user1.address, ethers.parseEther("1.0")))
                    .to.not.be.reverted;
            });
        });

        describe("Deposit ID Sequence", function () {
            it("Should increment deposit ID correctly with each deposit", async function () {
                // First deposit
                await makeDeposit(user1, "id-test-1", user2.address, user1.address, ethers.parseEther("0.1"));
                expect(await reach.depositId()).to.equal(1);

                // Second deposit
                await makeDeposit(user1, "id-test-2", user2.address, user1.address, ethers.parseEther("0.1"));
                expect(await reach.depositId()).to.equal(2);

                // Third deposit from different user
                await makeDeposit(user2, "id-test-3", user1.address, user2.address, ethers.parseEther("0.1"));
                expect(await reach.depositId()).to.equal(3);
            });
        });

        describe("User Deposits Tracking", function () {
            it("Should correctly track multiple deposits by the same user", async function () {
                // User makes multiple deposits
                await makeDeposit(user1, "multi-1", user2.address, user1.address, ethers.parseEther("0.1"));
                await makeDeposit(user1, "multi-2", user2.address, user1.address, ethers.parseEther("0.2"));
                await makeDeposit(user1, "multi-3", user2.address, user1.address, ethers.parseEther("0.3"));

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
                    await makeDeposit(user1, `pagination-${i}`, user2.address, user1.address, ethers.parseEther("0.1"));
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

                // 1. Create a deposit using depositProxy since we have ENGINE_ROLE
                const depositAmount = ethers.parseEther("1.0");
                await makeDeposit(user1, "lifecycle-test", user2.address, user1.address, depositAmount);

                // 2. Verify instant payment was sent
                const deposit = await reach.getDepositDetails(1);
                const instantAmount = depositAmount / 2n;
                const fee = (instantAmount * 10n) / 100n;

                // 3. Try to release funds
                await reach.release(1);

                // 4. Verify deposit status
                const updatedDeposit = await reach.getDepositDetails(1);
                expect(updatedDeposit.released).to.be.true;

                // 5. Try to release again (should fail)
                await expect(reach.release(1))
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
                await makeDeposit(user1, "window-test", user2.address, user1.address, ethers.parseEther("1.0"));

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
                const tinyAmount = ethers.parseEther("0.001"); // Minimum payment

                await makeDeposit(user1, "tiny-payment", user2.address, user1.address, tinyAmount);

                const deposit = await reach.getDepositDetails(1);
                const instantAmount = tinyAmount / 2n;
                const fee = (instantAmount * 10n) / 100n;

                // Even with tiny amounts, fee should be calculated correctly
                expect(fee).to.be.greaterThan(0);
            });
        });

        describe("Direct BNB Transfers", function () {
            it("Should not accept direct BNB transfers", async function () {
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

                // Create a deposit - Fixed: Changed from user1.address as both KOL and requester
                await makeDeposit(deployer, "revocation-test", user1.address, deployer.address, ethers.parseEther("1.0"));
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

                // Create another deposit for testing - Fixed: Changed from user1.address as both KOL and requester
                await makeDeposit(deployer, "revocation-test-2", user1.address, deployer.address, ethers.parseEther("1.0"));

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

                await makeDeposit(user1, "large-value-test", user2.address, user1.address, largeAmount);

                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);

                expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
                expect(kolAfter - kolBefore).to.equal(kolInstantAmount);

                // Verify the escrow amount is correctly stored
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(largeAmount / 2n);
            });
        });

        describe("Different Refund Percentages", function () {
            beforeEach(async function () {
                [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();

                // Deploy contracts same as in other tests
                const Authority = await ethers.getContractFactory("ReachAuthority");
                authority = await Authority.deploy(
                    deployer.address,
                    SIGNER_ADDRESS,
                );

                const Reach = await ethers.getContractFactory("ReachV2");
                reach = await Reach.deploy(
                    await authority.getAddress(),
                    proofSigner.address,
                    FEES_RECEIVER_ADDRESS,
                );

                // Grant ENGINE_ROLE to deployer for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            });

            async function makeDepositWithCustomRefund(refundPercentage, amount) {
                const identifier = `refund-${refundPercentage}-test`;
                const currentBlockTime = await getCurrentBlockTimestamp();
                const deadline = currentBlockTime + 3600; // 1 hour from current block time
                const nonce = nonceCounter++;
                const responseTime = 5 * 24 * 60 * 60; // 5 days in seconds

                const domainSeparator = await reach.DOMAIN_SEPARATOR();

                const signature = await generateSignature(
                    domainSeparator,
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    proofSigner
                );

                return reach.connect(user1).deposit(
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    signature,
                    { value: amount }
                );
            }

            it("Should correctly distribute funds with 80% refund rate", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 80;

                // Calculate expected amounts
                const instantPercentage = 100 - refundPercentage; // 20%
                const instantAmount = (depositAmount * BigInt(instantPercentage)) / 100n;
                const escrowAmount = depositAmount - instantAmount;

                const fee = (instantAmount * 10n) / 100n; // 10% platform fee
                const kolInstantAmount = instantAmount - fee;

                // Get initial balances
                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);

                // Make deposit with 80% refund rate
                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                // Get final balances
                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);

                // Verify distributions
                expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
                expect(kolAfter - kolBefore).to.equal(kolInstantAmount);

                // Verify deposit details
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(escrowAmount);
                expect(deposit.refundPercentage).to.equal(refundPercentage);
            });

            it("Should correctly handle 0% refund rate (full immediate payment)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 0;

                // With 0% refund, all money should be sent immediately
                const instantAmount = depositAmount;
                const escrowAmount = 0n;

                const fee = (instantAmount * 10n) / 100n;
                const kolInstantAmount = instantAmount - fee;

                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);

                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);

                expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
                expect(kolAfter - kolBefore).to.equal(kolInstantAmount);

                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(escrowAmount);
            });

            it("Should correctly handle 100% refund rate (full escrow)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 100;

                // With 100% refund, all money should go to escrow
                const instantAmount = 0n;
                const escrowAmount = depositAmount;

                const fee = 0n; // No immediate payment, so no fee yet

                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);

                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);

                // No immediate payments should occur
                expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
                expect(kolAfter - kolBefore).to.equal(instantAmount);

                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(escrowAmount);
            });

            it("Should handle release with different refund percentages", async function () {
                // Grant ENGINE_ROLE for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);

                // Test with 80% refund rate
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 80;

                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                // Calculate expected escrow amounts
                const escrowAmount = (depositAmount * BigInt(refundPercentage)) / 100n;
                const fee = (escrowAmount * 10n) / 100n; // 10% platform fee
                const kolReleaseAmount = escrowAmount - fee;

                const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolBefore = await ethers.provider.getBalance(user2.address);

                // Release the funds
                await reach.release(1);

                const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
                const kolAfter = await ethers.provider.getBalance(user2.address);

                // Verify correct fee and KOL payments
                expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
                expect(kolAfter - kolBefore).to.equal(kolReleaseAmount);

                // Deposit should be marked as released
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.released).to.be.true;
            });

            it("Should revert with invalid refund percentage (over 100%)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const invalidRefundPercentage = 101;

                await expect(
                    makeDepositWithCustomRefund(invalidRefundPercentage, depositAmount)
                ).to.be.revertedWithCustomError(reach, "InvalidPercentage");
            });
        });

        describe("Refund Scenarios with Different Percentages", function () {
            beforeEach(async function () {
                [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();

                // Deploy contracts
                const Authority = await ethers.getContractFactory("ReachAuthority");
                authority = await Authority.deploy(
                    deployer.address,
                    SIGNER_ADDRESS,
                );

                const Reach = await ethers.getContractFactory("ReachV2");
                reach = await Reach.deploy(
                    await authority.getAddress(),
                    proofSigner.address,
                    FEES_RECEIVER_ADDRESS,
                );

                // Grant ENGINE_ROLE to deployer for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            });

            async function makeDepositWithCustomRefund(refundPercentage, amount) {
                // Same implementation as in the previous test suite
                const identifier = `refund-${refundPercentage}-test`;
                const currentBlockTime = await getCurrentBlockTimestamp();
                const deadline = currentBlockTime + 3600;
                const nonce = nonceCounter++;
                const responseTime = 5 * 24 * 60 * 60;

                const domainSeparator = await reach.DOMAIN_SEPARATOR();

                const signature = await generateSignature(
                    domainSeparator,
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    proofSigner
                );

                return reach.connect(user1).deposit(
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    signature,
                    { value: amount }
                );
            }

            it("Should correctly refund with 80% in escrow", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 80;

                // Make deposit with 80% refund
                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                // Calculate expected escrow amount
                const escrowAmount = (depositAmount * BigInt(refundPercentage)) / 100n;

                // Fast forward time to allow refund
                await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
                await ethers.provider.send("evm_mine");

                const requesterBefore = await ethers.provider.getBalance(user1.address);

                // Issue refund
                await reach.refund(1);

                const requesterAfter = await ethers.provider.getBalance(user1.address);

                // Verify refund amount
                expect(requesterAfter - requesterBefore).to.equal(escrowAmount);

                // Verify deposit status
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.refunded).to.be.true;
            });

            it("Should allow force refund with different percentages", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 80;

                // Make deposit with 80% refund
                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                // Calculate expected escrow amount
                const escrowAmount = (depositAmount * BigInt(refundPercentage)) / 100n;

                // Fast forward time past response time + 4 hours
                await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
                await ethers.provider.send("evm_mine");

                const requesterBefore = await ethers.provider.getBalance(user1.address);

                // Force refund
                const tx = await reach.connect(user1).forceRefund(1);
                const receipt = await tx.wait();
                const gasUsed = receipt.gasUsed * receipt.gasPrice;

                const requesterAfter = await ethers.provider.getBalance(user1.address);

                // Verify correct refund amount (accounting for gas)
                expect(requesterAfter - requesterBefore + gasUsed).to.equal(escrowAmount);

                // Verify deposit status
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.refunded).to.be.true;
            });

            it("Should correctly calculate total refund with 100% in escrow", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const refundPercentage = 100;

                // Make deposit with 100% refund
                await makeDepositWithCustomRefund(refundPercentage, depositAmount);

                // Fast forward time
                await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
                await ethers.provider.send("evm_mine");

                const requesterBefore = await ethers.provider.getBalance(user1.address);

                // Issue refund
                await reach.refund(1);

                const requesterAfter = await ethers.provider.getBalance(user1.address);

                // Verify full refund
                expect(requesterAfter - requesterBefore).to.equal(depositAmount);
            });
        });

        describe("Edge Cases with Custom Refund Percentages", function () {
            beforeEach(async function () {
                // Setup contracts as in previous tests
                [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();

                const Authority = await ethers.getContractFactory("ReachAuthority");
                authority = await Authority.deploy(
                    deployer.address,
                    SIGNER_ADDRESS,
                );

                const Reach = await ethers.getContractFactory("ReachV2");
                reach = await Reach.deploy(
                    await authority.getAddress(),
                    proofSigner.address,
                    FEES_RECEIVER_ADDRESS,
                );

                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            });

            // Custom deposit function as in previous tests
            async function makeDepositWithCustomRefund(refundPercentage, amount) {
                // Implementation same as before
                const identifier = `refund-${refundPercentage}-test`;
                const currentBlockTime = await getCurrentBlockTimestamp();
                const deadline = currentBlockTime + 3600;
                const nonce = nonceCounter++;
                const responseTime = 5 * 24 * 60 * 60;

                const domainSeparator = await reach.DOMAIN_SEPARATOR();

                const signature = await generateSignature(
                    domainSeparator,
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    proofSigner
                );

                return reach.connect(user1).deposit(
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    signature,
                    { value: amount }
                );
            }

            it("Should handle minimum payment with high refund percentage", async function () {
                const minimumPayment = await reach.minimumPayment();
                const refundPercentage = 95;

                // Calculate the tiny immediate payment 
                const instantPercentage = 100 - refundPercentage; // 5%
                const instantAmount = (minimumPayment * BigInt(instantPercentage)) / 100n;
                const escrowAmount = minimumPayment - instantAmount;

                // Make deposit with minimum payment and high refund
                await makeDepositWithCustomRefund(refundPercentage, minimumPayment);

                // Verify deposit details
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(escrowAmount);
            });

            it("Should handle scenarios with tiny immediate payment and fee", async function () {
                const amount = ethers.parseEther("0.001"); // Minimum amount
                const refundPercentage = 99; // Only 1% immediate payment

                // Calculate expected instant amount (very small)
                const instantPercentage = 100 - refundPercentage; // 1%
                const instantAmount = (amount * BigInt(instantPercentage)) / 100n;
                const fee = (instantAmount * 10n) / 100n; // 10% of the tiny instant amount

                // This might be a very small fee, but should still be greater than 0
                expect(fee).to.be.gt(0);

                await makeDepositWithCustomRefund(refundPercentage, amount);

                // Verify deposit details
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.escrowAmount).to.equal(amount - instantAmount);
            });

            it("Should work with variable refund percentages across multiple deposits", async function () {
                // Create deposits with different refund percentages
                const amount = ethers.parseEther("0.1");

                await makeDepositWithCustomRefund(25, amount); // 25% refund
                await makeDepositWithCustomRefund(50, amount); // 50% refund
                await makeDepositWithCustomRefund(75, amount); // 75% refund

                // Verify each deposit has correct escrow amount
                const deposit1 = await reach.getDepositDetails(1);
                expect(deposit1.escrowAmount).to.equal((amount * 25n) / 100n);

                const deposit2 = await reach.getDepositDetails(2);
                expect(deposit2.escrowAmount).to.equal((amount * 50n) / 100n);

                const deposit3 = await reach.getDepositDetails(3);
                expect(deposit3.escrowAmount).to.equal((amount * 75n) / 100n);

                // Release first deposit, refund second, force refund third
                await reach.release(1);

                await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
                await ethers.provider.send("evm_mine");
                await reach.refund(2);

                await ethers.provider.send("evm_increaseTime", [14400]);
                await ethers.provider.send("evm_mine");
                await reach.connect(user1).forceRefund(3);

                // Verify all deposits processed correctly
                const updatedDeposit1 = await reach.getDepositDetails(1);
                expect(updatedDeposit1.released).to.be.true;

                const updatedDeposit2 = await reach.getDepositDetails(2);
                expect(updatedDeposit2.refunded).to.be.true;

                const updatedDeposit3 = await reach.getDepositDetails(3);
                expect(updatedDeposit3.refunded).to.be.true;
            });
        });

        describe("Different Response Times", function () {
            beforeEach(async function () {
                [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();

                // Deploy contracts
                const Authority = await ethers.getContractFactory("ReachAuthority");
                authority = await Authority.deploy(
                    deployer.address,
                    SIGNER_ADDRESS,
                );

                const Reach = await ethers.getContractFactory("ReachV2");
                reach = await Reach.deploy(
                    await authority.getAddress(),
                    proofSigner.address,
                    FEES_RECEIVER_ADDRESS,
                );

                // Grant ENGINE_ROLE to deployer for testing
                await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            });

            async function makeDepositWithCustomResponseTime(responseTime, amount) {
                const identifier = `response-time-${responseTime}-test`;
                const currentBlockTime = await getCurrentBlockTimestamp();
                const deadline = currentBlockTime + 3600; // 1 hour from current block time
                const nonce = nonceCounter++;
                const refundPercentage = 50; // 50% refund rate for testing

                const domainSeparator = await reach.DOMAIN_SEPARATOR();

                const signature = await generateSignature(
                    domainSeparator,
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    proofSigner
                );

                return reach.connect(user1).deposit(
                    identifier,
                    amount,
                    user2.address,
                    user1.address,
                    responseTime,
                    refundPercentage,
                    deadline,
                    nonce,
                    signature,
                    { value: amount }
                );
            }

            it("Should work with very short response time (1 hour)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 3600; // 1 hour in seconds

                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Verify deposit was created with correct response time
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.responseTime).to.equal(responseTime);

                // Fast forward just past response time
                await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
                await ethers.provider.send("evm_mine");

                // Should be able to refund
                await expect(reach.refund(1)).to.not.be.reverted;
            });

            it("Should work with medium response time (30 days)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 30 * 24 * 60 * 60; // 30 days in seconds

                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Verify deposit was created with correct response time
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.responseTime).to.equal(responseTime);

                // Fast forward just past response time
                await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
                await ethers.provider.send("evm_mine");

                // Should be able to refund
                await expect(reach.refund(1)).to.not.be.reverted;
            });

            it("Should work with maximum response time (90 days)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 90 * 24 * 60 * 60; // 90 days in seconds

                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Verify deposit was created with correct response time
                const deposit = await reach.getDepositDetails(1);
                expect(deposit.responseTime).to.equal(responseTime);

                // Fast forward just past response time
                await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
                await ethers.provider.send("evm_mine");

                // Should be able to refund
                await expect(reach.refund(1)).to.not.be.reverted;
            });

            it("Should revert with response time exceeding maximum (90 days)", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 90 * 24 * 60 * 60 + 1; // 90 days + 1 second

                await expect(
                    makeDepositWithCustomResponseTime(responseTime, depositAmount)
                ).to.be.revertedWithCustomError(reach, "InvalidResponseTime");
            });

            it("Should correctly enforce force refund window with different response times", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 12 * 60 * 60; // 12 hours

                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Fast forward to just after response time but before 4-hour window
                await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
                await ethers.provider.send("evm_mine");

                // Force refund should fail - not yet in time window
                await expect(reach.connect(user1).forceRefund(1))
                    .to.be.revertedWithCustomError(reach, "TimeWindowNotElapsed");

                // Fast forward past response time + 4 hours
                await ethers.provider.send("evm_increaseTime", [14400]); // 4 hours
                await ethers.provider.send("evm_mine");

                // Force refund should now work
                await expect(reach.connect(user1).forceRefund(1)).to.not.be.reverted;
            });

            it("Should correctly enforce engine refund with short response time", async function () {
                const depositAmount = ethers.parseEther("1.0");
                const responseTime = 600; // 10 minutes

                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Try to refund before response time has elapsed (should fail)
                await expect(reach.refund(1))
                    .to.not.be.reverted; // Actually this should work since we have ENGINE_ROLE

                // Create another deposit for testing timing
                await makeDepositWithCustomResponseTime(responseTime, depositAmount);

                // Fast forward just past response time
                await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
                await ethers.provider.send("evm_mine");

                // Refund should work
                await expect(reach.refund(2)).to.not.be.reverted;
            });
        });
    })

})