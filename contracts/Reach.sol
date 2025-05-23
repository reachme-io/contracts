// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Authority.sol";

contract Reach is Pausable, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    uint256 public constant PERCENTAGE_BASE = 100;
    uint256 public constant MAX_FEE_PERCENTAGE = 20;
    uint256 public constant MIN_FEE_PERCENTAGE = 1;
    uint256 public constant MIN_PAYMENT_THRESHOLD = 0.00001 ether;
    uint256 public constant MAX_RESPONSE_TIME = 14 days;

    ReachAuthority public authority;

    uint256 public platformFee = 10;
    uint256 public responseTime = 5 days;
    uint256 public minimumPayment = 0.001 ether;

    uint256 public depositId;
    address public feesReceiver;

    struct Deposit {
        string identifier;
        address requester;
        address payable recipient;
        uint256 escrowAmount; // 50% of the total payment
        uint256 timestamp;
        bool released;
        bool refunded;
    }

    mapping(uint256 => Deposit) public deposits;
    mapping(address => uint256[]) public userDeposits;
    mapping(string => bool) public identifierExists;

    event PaymentDeposited(
        uint256 indexed depositId,
        string identifier,
        address requester,
        address kol,
        uint256 totalAmount,
        uint256 instantAmount,
        uint256 escrowAmount
    );
    event FundsReleased(
        uint256 indexed depositId,
        string identifier,
        address kol,
        uint256 amount
    );
    event RefundIssued(
        uint256 indexed depositId,
        string identifier,
        address requester,
        uint256 amount
    );
    event Withdrawal(address indexed to, uint256 amount);
    event FeesReceiverUpdated(
        address indexed oldReceiver,
        address indexed newReceiver
    );

    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event MinimumPaymentUpdated(uint256 oldMinimum, uint256 newMinimum);
    event ResponseTimeUpdated(uint256 oldTime, uint256 newTime);

    error PaymentDepositFailed();
    error DuplicateIdentifier();
    error CannotPaySelf();
    error ZeroAddress();
    error InvalidDeposit();
    error AlreadyProcessed();
    error TimeWindowNotElapsed();
    error InsufficientPayment();
    error Unauthorized();
    error InvalidFeeRange();
    error InvalidResponseTime();
    error FeeTransferFailed();
    error KOLTransferFailed();
    error RefundTransferFailed();
    error RecoveryTransferFailed();

    modifier onlyRole(bytes32 role) {
        if (authority.hasRole(role, msg.sender)) {
            _;
        } else {
            revert Unauthorized();
        }
    }

    constructor(address _feesReceiver, address _authority) {
        if (_feesReceiver == address(0)) revert ZeroAddress();
        feesReceiver = _feesReceiver;
        authority = ReachAuthority(_authority);
    }

    function deposit(
        string memory _identifier,
        address _kolAddress
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < minimumPayment) revert InsufficientPayment();
        if (_kolAddress == address(0)) revert ZeroAddress();
        if (_kolAddress == msg.sender) revert CannotPaySelf();
        if (identifierExists[_identifier]) revert DuplicateIdentifier();
        identifierExists[_identifier] = true;

        depositId++;

        uint256 totalAmount = msg.value;
        uint256 instantAmount = totalAmount / 2;
        uint256 escrowAmount = totalAmount - instantAmount;
        uint256 fee = calculateFee(instantAmount);
        uint256 kolInstantAmount = instantAmount - fee;

        // Send instant payment to KOL
        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        if (!feeSent) revert FeeTransferFailed();

        (bool kolSent, ) = payable(_kolAddress).call{value: kolInstantAmount}(
            ""
        );
        if (!kolSent) revert KOLTransferFailed();

        // Store only escrow amount in deposit
        deposits[depositId] = Deposit({
            identifier: _identifier,
            requester: msg.sender,
            recipient: payable(_kolAddress),
            escrowAmount: escrowAmount,
            timestamp: block.timestamp,
            released: false,
            refunded: false
        });

        userDeposits[msg.sender].push(depositId);

        emit PaymentDeposited(
            depositId,
            _identifier,
            msg.sender,
            _kolAddress,
            totalAmount,
            kolInstantAmount,
            escrowAmount
        );
    }

    function releaseFunds(
        uint256 _depositId
    ) external onlyRole(ENGINE_ROLE) whenNotPaused nonReentrant {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.requester == address(0)) revert InvalidDeposit();
        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();

        uint256 fee = calculateFee(_deposit.escrowAmount);
        uint256 kolAmount = _deposit.escrowAmount - fee;

        _deposit.released = true;

        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        if (!feeSent) revert FeeTransferFailed();

        (bool kolSent, ) = _deposit.recipient.call{value: kolAmount}("");
        if (!kolSent) revert KOLTransferFailed();

        emit FundsReleased(
            _depositId,
            _deposit.identifier,
            _deposit.recipient,
            kolAmount
        );
    }

    function refund(
        uint256 _depositId
    ) external whenNotPaused nonReentrant onlyRole(ENGINE_ROLE) {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.requester == address(0)) revert InvalidDeposit();
        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();
        if (block.timestamp < _deposit.timestamp + responseTime)
            revert TimeWindowNotElapsed();

        _deposit.refunded = true;

        (bool requesterSent, ) = _deposit.requester.call{
            value: _deposit.escrowAmount
        }("");
        if (!requesterSent) revert RefundTransferFailed();

        emit RefundIssued(
            _depositId,
            _deposit.identifier,
            _deposit.requester,
            _deposit.escrowAmount
        );
    }

    function updateFeesReceiver(
        address _newReceiver
    ) external onlyRole(ADMIN_ROLE) {
        if (_newReceiver == address(0)) revert ZeroAddress();
        address oldReceiver = feesReceiver;
        feesReceiver = _newReceiver;
        emit FeesReceiverUpdated(oldReceiver, _newReceiver);
    }

    function updatePlatformFee(uint256 _newFee) external onlyRole(ADMIN_ROLE) {
        if (_newFee < MIN_FEE_PERCENTAGE || _newFee > MAX_FEE_PERCENTAGE)
            revert InvalidFeeRange();
        uint256 oldFee = platformFee;
        platformFee = _newFee;
        emit PlatformFeeUpdated(oldFee, _newFee);
    }

    function updateMinimumPayment(
        uint256 _newMinimum
    ) external onlyRole(ADMIN_ROLE) {
        if (_newMinimum < MIN_PAYMENT_THRESHOLD) revert InsufficientPayment();
        uint256 oldMinimum = minimumPayment;
        minimumPayment = _newMinimum;
        emit MinimumPaymentUpdated(oldMinimum, _newMinimum);
    }

    function updateResponseTime(
        uint256 _newTime
    ) external onlyRole(ADMIN_ROLE) {
        if (_newTime == 0 || _newTime > MAX_RESPONSE_TIME)
            revert InvalidResponseTime();
        uint256 oldTime = responseTime;
        responseTime = _newTime;
        emit ResponseTimeUpdated(oldTime, _newTime);
    }

    function getUserDeposits(
        address _user,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] storage userDeps = userDeposits[_user];
        
        // Return empty array if offset is out of bounds
        if (offset >= userDeps.length) {
            return new uint256[](0);
        }
        
        uint256 length = limit > userDeps.length - offset
            ? userDeps.length - offset
            : limit;
        uint256[] memory result = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = userDeps[offset + i];
        }
        return result;
    }

    function getDepositDetails(
        uint256 _depositId
    ) external view returns (Deposit memory) {
        return deposits[_depositId];
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function calculateFee(uint256 amount) internal view returns (uint256) {
        return (amount * platformFee) / PERCENTAGE_BASE;
    }

    function forceRefund(uint256 _depositId) external nonReentrant {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();
        if (block.timestamp < (_deposit.timestamp + responseTime + 14400))
            // 4 hours after max response time
            revert TimeWindowNotElapsed();
        
        if (_deposit.requester != msg.sender) revert Unauthorized();

        _deposit.refunded = true;

        (bool success, ) = _deposit.requester.call{
            value: _deposit.escrowAmount
        }("");
        if (!success) revert RefundTransferFailed();

        emit RefundIssued(
            _depositId,
            _deposit.identifier,
            _deposit.requester,
            _deposit.escrowAmount
        );
    }

    function recoverFunds(
        uint256 _amount
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to recover");

        (bool sent, ) = msg.sender.call{value: _amount}("");
        if (!sent) revert RecoveryTransferFailed();

        emit Withdrawal(msg.sender, _amount);
    }
}
