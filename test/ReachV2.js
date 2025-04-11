const { expect } = require("chai");
const { ethers } = require("hardhat");

const SIGNER_ADDRESS = '0xb3842098899ca72b724732CCb83D78Fa025A331c';
const FEES_RECEIVER_ADDRESS = '0xb3842098899ca72b724732CCb83D78Fa025A331c';
const PROOF_SIGNER_ADDRESS = '0x0000000000000000000000000000000000000000';

async function generateSignature(domainSeparator, identifier, amount, kolAddress, requester, responseTime, refundPercentage, deadline, proofSigner) {
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "string", "uint256", "address", "address", "uint256", "uint256", "uint256"],
            [domainSeparator, identifier, amount, kolAddress, requester, responseTime, refundPercentage, deadline]
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
    let defaultResponseTime, defaultRefundPercentage;

    beforeEach(async () => {
        [deployer, treasuryAddress, proofSigner, user1, user2] = await ethers.getSigners();
        defaultResponseTime = 5 * 24 * 60 * 60; // 5 days in seconds
        defaultRefundPercentage = 5000; // 50% in basis points

        // Deploy core contracts
        const Authority = await ethers.getContractFactory("ReachAuthority");
        authority = await Authority.deploy(
            deployer.address,
            SIGNER_ADDRESS
        );

        const Reach = await ethers.getContractFactory("ReachV2");
        reach = await Reach.deploy(
            await authority.getAddress(),
            proofSigner.address,
            FEES_RECEIVER_ADDRESS
        );
    });

    // Helper function to simplify deposit calls in tests
    async function makeDeposit(from, baseIdentifier, kolAddress, requesterAddress, amount, refundPercentage = defaultRefundPercentage) {
        const identifier = `${baseIdentifier}`;
        const currentBlockTime = await getCurrentBlockTimestamp();
        const deadline = currentBlockTime + 3600; // 1 hour from current block time

        const domainSeparator = await reach.DOMAIN_SEPARATOR();

        const signature = await generateSignature(
            domainSeparator,
            identifier,
            amount,
            kolAddress,
            requesterAddress,
            defaultResponseTime,
            refundPercentage,
            deadline,
            proofSigner
        );

        const tx = await reach.connect(from).deposit(
            identifier,
            amount,
            kolAddress,
            requesterAddress,
            defaultResponseTime,
            refundPercentage,
            deadline,
            signature,
            { value: amount }
        );

        return tx;
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
            expect(await reach.platformFee()).to.equal(1000); // 10% in basis points
            expect(await reach.minimumPayment()).to.equal(ethers.parseEther("0.001"));
        });
    });

    describe("Deposit", function () {
        it("Should allow a user to deposit funds with valid signature", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "test-deposit-2";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
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
            const identifier = "test-below-minimum";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                identifier,
                belowMinimum,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                belowMinimum,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: belowMinimum }
            )).to.be.revertedWithCustomError(reach, "InsufficientPayment");
        });

        it("Should revert if KOL address is zero", async function () {
            const identifier = "test-zero-address";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                identifier,
                ethers.parseEther("1.0"),
                ethers.ZeroAddress,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                ethers.parseEther("1.0"),
                ethers.ZeroAddress,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: ethers.parseEther("1.0") }
            )).to.be.revertedWithCustomError(reach, "ZeroAddress");
        });

        it("Should revert if user tries to pay themselves", async function () {
            const identifier = "test-self-payment";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                identifier,
                ethers.parseEther("1.0"),
                user1.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                ethers.parseEther("1.0"),
                user1.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: ethers.parseEther("1.0") }
            )).to.be.revertedWithCustomError(reach, "CannotPaySelf");
        });

        it("Should distribute funds correctly on deposit", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (depositAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;
            const kolInstantAmount = instantAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await makeDeposit(user1, "test-deposit", user2.address, user1.address, depositAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);
        });

        it("Should accept deposits where msg.value is greater than amount", async function () {
            const requiredAmount = ethers.parseEther("1.5");
            const tipAmount = ethers.parseEther("0.5");
            const totalAmount = requiredAmount + tipAmount;
            const identifier = "test-with-tip";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                requiredAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (totalAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;
            const kolInstantAmount = instantAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);
            const contractBefore = await ethers.provider.getBalance(await reach.getAddress());

            await expect(reach.connect(user1).deposit(
                identifier,
                requiredAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: totalAmount }
            )).to.emit(reach, "PaymentDeposited");

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);
            const contractAfter = await ethers.provider.getBalance(await reach.getAddress());

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);

            const expectedEscrowAmount = totalAmount - instantAmount;
            expect(contractAfter - contractBefore).to.equal(expectedEscrowAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(expectedEscrowAmount);
        });

        it("Should revert if msg.value is less than amount", async function () {
            const requestedAmount = ethers.parseEther("1.0");
            const sentAmount = ethers.parseEther("0.5");
            const identifier = "test-insufficient-value";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                requestedAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                requestedAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: sentAmount }
            )).to.be.revertedWithCustomError(reach, "InsufficientPayment");
        });
    });

    describe("Release Funds", function () {
        let identifier;

        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            await makeDeposit(user1, "test-release", user2.address, user1.address, ethers.parseEther("1.0"));
            const deposit = await reach.getDepositDetails(1);
            identifier = deposit.identifier;
        });

        it("Should release funds to KOL", async function () {
            const depositId = 1;
            const deposit = await reach.getDepositDetails(depositId);
            const escrowAmount = deposit.escrowAmount;
            const fee = (escrowAmount * 1000n) / 10000n;
            const kolAmount = escrowAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await expect(reach.release(depositId))
                .to.emit(reach, "FundsReleased")
                .withArgs(depositId, identifier, user2.address, kolAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolAmount);

            const updatedDeposit = await reach.getDepositDetails(depositId);
            expect(updatedDeposit.released).to.be.true;
        });

        it("Should revert if deposit is already processed", async function () {
            const depositId = 1;
            await reach.release(depositId);
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
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
            await makeDeposit(user1, "test-refund", user2.address, user1.address, ethers.parseEther("1.0"));
        });

        it("Should refund funds to requester after response time", async function () {
            const depositId = 1;
            const deposit = await reach.getDepositDetails(depositId);

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
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
                makeDeposit(user1, "test-during-pause-2", user2.address, user1.address, ethers.parseEther("1.0"))
            ).to.be.reverted;

            await reach.unpause();

            const isUnpaused = await reach.paused();
            expect(isUnpaused).to.be.false;

            await expect(
                makeDeposit(user1, "test-after-unpause-3", user2.address, user1.address, ethers.parseEther("1.0"))
            ).to.not.be.reverted;
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
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
            expect(deposit.escrowAmount).to.equal(ethers.parseEther("0.5"));
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

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");

            const requesterBefore = await ethers.provider.getBalance(user1.address);

            const tx = await reach.connect(user1).forceRefund(depositId);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const requesterAfter = await ethers.provider.getBalance(user1.address);

            expect(requesterAfter - requesterBefore + gasUsed).to.equal(deposit.escrowAmount);

            const updatedDeposit = await reach.getDepositDetails(depositId);
            expect(updatedDeposit.refunded).to.be.true;
        });

        it("Should revert if time window has not elapsed", async function () {
            const depositId = 1;

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user1).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "TimeWindowNotElapsed");
        });

        it("Should revert if caller is not the requester", async function () {
            const depositId = 1;

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user2).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });

        it("Should revert if deposit is already processed", async function () {
            const depositId = 1;

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");

            await reach.connect(user1).forceRefund(depositId);

            await expect(reach.connect(user1).forceRefund(depositId))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Update Protocol Parameters", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
        });

        describe("updatePlatformFee", function () {
            it("Should update platform fee", async function () {
                const oldFee = await reach.platformFee();
                const newFee = 1500; // 15%

                await expect(reach.updatePlatformFee(newFee))
                    .to.emit(reach, "PlatformFeeUpdated")
                    .withArgs(oldFee, newFee);

                expect(await reach.platformFee()).to.equal(newFee);
            });

            it("Should revert if fee is below minimum", async function () {
                const belowMinFee = 99; // Below 1% = 100
                await expect(reach.updatePlatformFee(belowMinFee))
                    .to.be.revertedWithCustomError(reach, "InvalidFeeRange");
            });

            it("Should revert if fee is above maximum", async function () {
                const aboveMaxFee = 2001; // Above 20% = 2000
                await expect(reach.updatePlatformFee(aboveMaxFee))
                    .to.be.revertedWithCustomError(reach, "InvalidFeeRange");
            });

            it("Should revert if caller doesn't have ADMIN_ROLE", async function () {
                await expect(reach.connect(user1).updatePlatformFee(1500))
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
                await reach.updatePlatformFee(1500); // 15%

                const depositAmount = ethers.parseEther("1.0");
                const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
                const instantAmount = (depositAmount * instantPercentage) / 10000n;
                const newFeeRate = 1500n;
                const expectedFee = (instantAmount * newFeeRate) / 10000n;
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
            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (smallAmount * instantPercentage) / 10000n;
            const feePercentage = await reach.platformFee();
            const expectedFee = (instantAmount * BigInt(feePercentage)) / 10000n;

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

        it("Should revert when using the same identifier twice", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "duplicate-identifier";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();
            const signature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            await reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: depositAmount }
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                signature,
                { value: depositAmount }
            )).to.be.revertedWithCustomError(reach, "IdentifierAlreadyUsed");
        });
    });

    describe("Deposit ID Sequence", function () {
        it("Should increment deposit ID correctly with each deposit", async function () {
            await makeDeposit(user1, "id-test-1", user2.address, user1.address, ethers.parseEther("0.1"));
            expect(await reach.depositId()).to.equal(1);

            await makeDeposit(user1, "id-test-2", user2.address, user1.address, ethers.parseEther("0.1"));
            expect(await reach.depositId()).to.equal(2);

            await makeDeposit(user2, "id-test-3", user1.address, user2.address, ethers.parseEther("0.1"));
            expect(await reach.depositId()).to.equal(3);
        });
    });

    describe("User Deposits Tracking", function () {
        it("Should correctly track multiple deposits by the same user", async function () {
            await makeDeposit(user1, "multi-1", user2.address, user1.address, ethers.parseEther("0.1"));
            await makeDeposit(user1, "multi-2", user2.address, user1.address, ethers.parseEther("0.2"));
            await makeDeposit(user1, "multi-3", user2.address, user1.address, ethers.parseEther("0.3"));

            const userDeposits = await reach.getUserDeposits(user1.address, 0, 10);
            expect(userDeposits.length).to.equal(3);
            expect(userDeposits[0]).to.equal(1);
            expect(userDeposits[1]).to.equal(2);
            expect(userDeposits[2]).to.equal(3);

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
            for (let i = 1; i <= 5; i++) {
                await makeDeposit(user1, `pagination-${i}`, user2.address, user1.address, ethers.parseEther("0.1"));
            }

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

            const beyondEnd = await reach.getUserDeposits(user1.address, 6, 2);
            expect(beyondEnd.length).to.equal(0);
        });
    });

    describe("Complex Scenarios", function () {
        it("Should handle the complete lifecycle of a deposit", async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);

            const depositAmount = ethers.parseEther("1.0");
            await makeDeposit(user1, "lifecycle-test", user2.address, user1.address, depositAmount);

            const deposit = await reach.getDepositDetails(1);
            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (depositAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;

            await reach.release(1);

            const updatedDeposit = await reach.getDepositDetails(1);
            expect(updatedDeposit.released).to.be.true;

            await expect(reach.release(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");

            await expect(reach.refund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user1).forceRefund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });

        it("Should handle refund after response time elapses but before force refund window", async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);

            await makeDeposit(user1, "window-test", user2.address, user1.address, ethers.parseEther("1.0"));

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.refund(1)).to.not.be.reverted;

            await ethers.provider.send("evm_increaseTime", [14400]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user1).forceRefund(1))
                .to.be.revertedWithCustomError(reach, "AlreadyProcessed");
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle very small payments that might result in zero fees", async function () {
            const tinyAmount = ethers.parseEther("0.001");
            await makeDeposit(user1, "tiny-payment", user2.address, user1.address, tinyAmount);

            const deposit = await reach.getDepositDetails(1);
            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (tinyAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;

            expect(fee).to.be.greaterThan(0);
        });
    });

    describe("Direct BNB Transfers", function () {
        it("Should not accept direct BNB transfers", async function () {
            await expect(
                user1.sendTransaction({
                    to: await reach.getAddress(),
                    value: ethers.parseEther("1.0")
                })
            ).to.be.reverted;
        });
    });

    describe("Role Revocation", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), user1.address);
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), user2.address);
            await makeDeposit(deployer, "revocation-test", user1.address, deployer.address, ethers.parseEther("1.0"));
        });

        it("Should prevent function access after role revocation", async function () {
            await expect(reach.connect(user1).updatePlatformFee(1500)).to.not.be.reverted;

            await authority.revokeRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), user1.address);

            await expect(reach.connect(user1).updatePlatformFee(1500))
                .to.be.revertedWithCustomError(reach, "Unauthorized");

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            await expect(reach.connect(user2).refund(1)).to.not.be.reverted;

            await makeDeposit(deployer, "revocation-test-2", user1.address, deployer.address, ethers.parseEther("1.0"));

            await authority.revokeRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), user2.address);

            await expect(reach.connect(user2).refund(2))
                .to.be.revertedWithCustomError(reach, "Unauthorized");
        });
    });

    describe("Large Value Handling", function () {
        it("Should correctly handle large deposit values", async function () {
            const largeAmount = ethers.parseEther("100.0");
            const instantPercentage = 10000n - BigInt(defaultRefundPercentage);
            const instantAmount = (largeAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;
            const kolInstantAmount = instantAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await makeDeposit(user1, "large-value-test", user2.address, user1.address, largeAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(largeAmount - instantAmount);
        });
    });

    describe("Different Refund Percentages", function () {
        async function makeDepositWithCustomRefund(refundPercentage, amount) {
            const identifier = `refund-${refundPercentage}-test`;
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;
            const responseTime = 5 * 24 * 60 * 60;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100), // Convert to basis points
                deadline,
                proofSigner
            );

            return reach.connect(user1).deposit(
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                signature,
                { value: amount }
            );
        }

        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
        });

        it("Should correctly distribute funds with 80% refund rate", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 80; // 80% = 8000 basis points

            const instantPercentage = 10000 - Math.round(refundPercentage * 100);
            const instantAmount = (depositAmount * BigInt(instantPercentage)) / 10000n;
            const escrowAmount = depositAmount - instantAmount;
            const fee = (instantAmount * 1000n) / 10000n;
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

        it("Should correctly handle 0% refund rate (full immediate payment)", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 0;

            const instantAmount = depositAmount;
            const escrowAmount = 0n;
            const fee = (instantAmount * 1000n) / 10000n;
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

            const instantAmount = 0n;
            const escrowAmount = depositAmount;
            const fee = 0n;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(instantAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(escrowAmount);
        });

        it("Should handle release with different refund percentages", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 80;

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            const escrowAmount = (depositAmount * BigInt(Math.round(refundPercentage * 100))) / 10000n;
            const fee = (escrowAmount * 1000n) / 10000n;
            const kolReleaseAmount = escrowAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await reach.release(1);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolReleaseAmount);

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
        async function makeDepositWithCustomRefund(refundPercentage, amount) {
            const identifier = `refund-${refundPercentage}-test`;
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;
            const responseTime = 5 * 24 * 60 * 60;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                proofSigner
            );

            return reach.connect(user1).deposit(
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                signature,
                { value: amount }
            );
        }

        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
        });

        it("Should correctly refund with 80% in escrow", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 80;

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            const escrowAmount = (depositAmount * BigInt(Math.round(refundPercentage * 100))) / 10000n;

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");

            const requesterBefore = await ethers.provider.getBalance(user1.address);

            await reach.refund(1);

            const requesterAfter = await ethers.provider.getBalance(user1.address);

            expect(requesterAfter - requesterBefore).to.equal(escrowAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.refunded).to.be.true;
        });

        it("Should allow force refund with different percentages", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 80;

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            const escrowAmount = (depositAmount * BigInt(Math.round(refundPercentage * 100))) / 10000n;

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 14400 + 1]);
            await ethers.provider.send("evm_mine");

            const requesterBefore = await ethers.provider.getBalance(user1.address);

            const tx = await reach.connect(user1).forceRefund(1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const requesterAfter = await ethers.provider.getBalance(user1.address);

            expect(requesterAfter - requesterBefore + gasUsed).to.equal(escrowAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.refunded).to.be.true;
        });

        it("Should correctly calculate total refund with 100% in escrow", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 100;

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");

            const requesterBefore = await ethers.provider.getBalance(user1.address);

            await reach.refund(1);

            const requesterAfter = await ethers.provider.getBalance(user1.address);

            expect(requesterAfter - requesterBefore).to.equal(depositAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.refunded).to.be.true;
        });
    });

    describe("Edge Cases with Custom Refund Percentages", function () {
        async function makeDepositWithCustomRefund(refundPercentage, amount) {
            const identifier = `refund-${refundPercentage}-test`;
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;
            const responseTime = 5 * 24 * 60 * 60;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                proofSigner
            );

            return reach.connect(user1).deposit(
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                signature,
                { value: amount }
            );
        }

        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
        });

        it("Should handle minimum payment with high refund percentage", async function () {
            const minimumPayment = await reach.minimumPayment();
            const refundPercentage = 95;

            const instantPercentage = 10000 - Math.round(refundPercentage * 100);
            const instantAmount = (minimumPayment * BigInt(instantPercentage)) / 10000n;
            const escrowAmount = minimumPayment - instantAmount;

            await makeDepositWithCustomRefund(refundPercentage, minimumPayment);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(escrowAmount);
        });

        it("Should handle scenarios with tiny immediate payment and fee", async function () {
            const amount = ethers.parseEther("0.001");
            const refundPercentage = 99;

            const instantPercentage = 10000 - Math.round(refundPercentage * 100);
            const instantAmount = (amount * BigInt(instantPercentage)) / 10000n;
            const fee = (instantAmount * 1000n) / 10000n;

            expect(fee).to.be.gt(0);

            await makeDepositWithCustomRefund(refundPercentage, amount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.escrowAmount).to.equal(amount - instantAmount);
        });

        it("Should work with variable refund percentages across multiple deposits", async function () {
            const amount = ethers.parseEther("0.1");

            await makeDepositWithCustomRefund(25, amount);
            await makeDepositWithCustomRefund(50, amount);
            await makeDepositWithCustomRefund(75, amount);

            const deposit1 = await reach.getDepositDetails(1);
            expect(deposit1.escrowAmount).to.equal((amount * BigInt(Math.round(25 * 100))) / 10000n);

            const deposit2 = await reach.getDepositDetails(2);
            expect(deposit2.escrowAmount).to.equal((amount * BigInt(Math.round(50 * 100))) / 10000n);

            const deposit3 = await reach.getDepositDetails(3);
            expect(deposit3.escrowAmount).to.equal((amount * BigInt(Math.round(75 * 100))) / 10000n);

            await reach.release(1);

            await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");
            await reach.refund(2);

            await ethers.provider.send("evm_increaseTime", [14400]);
            await ethers.provider.send("evm_mine");
            await reach.connect(user1).forceRefund(3);

            const updatedDeposit1 = await reach.getDepositDetails(1);
            expect(updatedDeposit1.released).to.be.true;

            const updatedDeposit2 = await reach.getDepositDetails(2);
            expect(updatedDeposit2.refunded).to.be.true;

            const updatedDeposit3 = await reach.getDepositDetails(3);
            expect(updatedDeposit3.refunded).to.be.true;
        });
    });

    describe("Different Response Times", function () {
        async function makeDepositWithCustomResponseTime(identifier, responseTime, amount) {
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;
            const refundPercentage = defaultRefundPercentage;

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
                signature,
                { value: amount }
            );
        }

        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE")), deployer.address);
        });

        it("Should work with very short response time (1 hour)", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 3600;

            await makeDepositWithCustomResponseTime('custom-response-time-1hour', responseTime, depositAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.responseTime).to.equal(responseTime);

            await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.refund(1)).to.not.be.reverted;
        });

        it("Should work with medium response time (30 days)", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 30 * 24 * 60 * 60;

            await makeDepositWithCustomResponseTime('custom-response-time-30days', responseTime, depositAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.responseTime).to.equal(responseTime);

            await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.refund(1)).to.not.be.reverted;
        });

        it("Should work with maximum response time (90 days)", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 90 * 24 * 60 * 60;

            await makeDepositWithCustomResponseTime('custom-response-time-90days', responseTime, depositAmount);

            const deposit = await reach.getDepositDetails(1);
            expect(deposit.responseTime).to.equal(responseTime);

            await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.refund(1)).to.not.be.reverted;
        });

        it("Should revert with response time exceeding maximum (90 days)", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 90 * 24 * 60 * 60 + 1;

            await expect(
                makeDepositWithCustomResponseTime('custom-response-time-90+1sec', responseTime, depositAmount)
            ).to.be.revertedWithCustomError(reach, "InvalidResponseTime");
        });

        it("Should correctly enforce force refund window with different response times", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 12 * 60 * 60;

            await makeDepositWithCustomResponseTime('custom-response-time-12hours', responseTime, depositAmount);

            await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user1).forceRefund(1))
                .to.be.revertedWithCustomError(reach, "TimeWindowNotElapsed");

            await ethers.provider.send("evm_increaseTime", [14400]);
            await ethers.provider.send("evm_mine");

            await expect(reach.connect(user1).forceRefund(1)).to.not.be.reverted;
        });

        it("Should correctly enforce engine refund with short response time", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const responseTime = 600;

            await makeDepositWithCustomResponseTime('custom-response-time-1', responseTime, depositAmount);

            await expect(reach.refund(1)).to.not.be.reverted;

            await makeDepositWithCustomResponseTime('custom-response-time-2', responseTime, depositAmount);

            await ethers.provider.send("evm_increaseTime", [responseTime + 1]);
            await ethers.provider.send("evm_mine");

            await expect(reach.refund(2)).to.not.be.reverted;
        });
    });

    describe("Domain Separator Update", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
        });

        it("Should update the domain separator correctly", async function () {
            const newName = "NewReach";
            const newVersion = "3";

            const oldDomainSeparator = await reach.DOMAIN_SEPARATOR();

            await reach.updateDomainSeparator(newName, newVersion);

            const newDomainSeparator = await reach.DOMAIN_SEPARATOR();

            expect(newDomainSeparator).to.not.equal(oldDomainSeparator);

            const expectedDomainSeparator = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                    [
                        ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
                        ethers.keccak256(ethers.toUtf8Bytes(newName)),
                        ethers.keccak256(ethers.toUtf8Bytes(newVersion)),
                        await ethers.provider.getNetwork().then(network => network.chainId),
                        reach.target
                    ]
                )
            );

            expect(newDomainSeparator).to.equal(expectedDomainSeparator);
        });

        it("Should revert if caller doesn't have ADMIN_ROLE", async function () {
            const newName = "NewReach";
            const newVersion = "3";

            await expect(
                reach.connect(user1).updateDomainSeparator(newName, newVersion)
            ).to.be.revertedWithCustomError(reach, "Unauthorized");
        });
    });

    describe("Signature Integrity", function () {
        it("Should revert with an invalid signature", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "invalid-signature-test";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const validSignature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            const tamperedSignature = validSignature.slice(0, -2) + "00";

            await expect(reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                tamperedSignature,
                { value: depositAmount }
            )).to.be.revertedWithCustomError(reach, "ECDSAInvalidSignature");
        });

        it("Should revert if the message is tampered with", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "tampered-message-test";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const validSignature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                proofSigner
            );

            const tamperedAmount = ethers.parseEther("2.0");

            await expect(reach.connect(user1).deposit(
                identifier,
                tamperedAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                validSignature,
                { value: tamperedAmount }
            )).to.be.revertedWithCustomError(reach, "InvalidSigner");
        });

        it("Should revert if the signer is incorrect", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const identifier = "incorrect-signer-test";
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const incorrectSigner = user1;
            const invalidSignature = await generateSignature(
                domainSeparator,
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                incorrectSigner
            );

            await expect(reach.connect(user1).deposit(
                identifier,
                depositAmount,
                user2.address,
                user1.address,
                defaultResponseTime,
                defaultRefundPercentage,
                deadline,
                invalidSignature,
                { value: depositAmount }
            )).to.be.revertedWithCustomError(reach, "InvalidSigner");
        });
    });

    describe("Decimal Percentage Handling", function () {
        beforeEach(async function () {
            await authority.grantRole(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")), deployer.address);
        });

        async function makeDepositWithCustomRefund(refundPercentage, amount) {
            const identifier = `refund-${refundPercentage}-test`;
            const currentBlockTime = await getCurrentBlockTimestamp();
            const deadline = currentBlockTime + 3600;
            const responseTime = 5 * 24 * 60 * 60;

            const domainSeparator = await reach.DOMAIN_SEPARATOR();

            const signature = await generateSignature(
                domainSeparator,
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                proofSigner
            );

            return reach.connect(user1).deposit(
                identifier,
                amount,
                user2.address,
                user1.address,
                responseTime,
                Math.round(refundPercentage * 100),
                deadline,
                signature,
                { value: amount }
            );
        }

        it("Should correctly handle 10.25% platform fee", async function () {
            const newFee = 1025; // 10.25%
            await reach.updatePlatformFee(newFee);

            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 50; // 50% = 5000 basis points

            const instantPercentage = 10000n - BigInt(Math.round(refundPercentage * 100));
            const instantAmount = (depositAmount * instantPercentage) / 10000n;
            const fee = (instantAmount * BigInt(newFee)) / 10000n;
            const kolInstantAmount = instantAmount - fee;

            const feesReceiverBefore = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolBefore = await ethers.provider.getBalance(user2.address);

            await makeDepositWithCustomRefund(refundPercentage, depositAmount);

            const feesReceiverAfter = await ethers.provider.getBalance(FEES_RECEIVER_ADDRESS);
            const kolAfter = await ethers.provider.getBalance(user2.address);

            expect(feesReceiverAfter - feesReceiverBefore).to.equal(fee);
            expect(kolAfter - kolBefore).to.equal(kolInstantAmount);
        });

        it("Should correctly handle 33.33% refund percentage", async function () {
            const depositAmount = ethers.parseEther("1.0");
            const refundPercentage = 33.33; // 33.33% = 3333 basis points

            const instantPercentage = 10000n - BigInt(Math.round(refundPercentage * 100));
            const instantAmount = (depositAmount * instantPercentage) / 10000n;
            const escrowAmount = depositAmount - instantAmount;
            const fee = (instantAmount * 1000n) / 10000n;
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
    });
});