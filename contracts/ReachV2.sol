// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Authority.sol";

contract ReachV2 is Pausable, ReentrancyGuard {
    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    uint256 public constant PERCENTAGE_BASE = 100;
    uint256 public constant MAXIMUM_PERCENTAGE = 100;
    uint256 public constant MINIMUM_PERCENTAGE = 0;
    uint256 public constant MAX_FEE_PERCENTAGE = 20;
    uint256 public constant MIN_FEE_PERCENTAGE = 1;
    uint256 public constant MIN_PAYMENT_THRESHOLD = 0.00001 ether;
    uint256 public constant MAX_RESPONSE_TIME = 90 days;

    ReachAuthority public authority;

    uint256 public platformFee = 10;
    uint256 public minimumPayment = 0.001 ether;

    uint256 public depositId;
    address public feesReceiver;
    address public proofSigner;

    mapping(uint256 => Deposit) public deposits;
    mapping(address => uint256[]) public userDeposits;

    mapping(uint256 => mapping(uint256 => uint256)) public poolNonceBitArrays;

    // Structs
    struct Deposit {
        string identifier;
        address requester;
        address recipient;
        uint256 responseTime;
        uint256 refundPercentage;
        uint256 escrowAmount;
        uint256 timestamp;
        bool released;
        bool refunded;
    }

    // Events
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

    event FeesReceiverUpdated(
        address indexed oldReceiver,
        address indexed newReceiver
    );

    event ProofSignerUpdated(
        address indexed oldProofSigner,
        address indexed newProofSigner
    );

    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event MinimumPaymentUpdated(uint256 oldMinimum, uint256 newMinimum);

    // Errors
    error Unauthorized();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error InvalidSignatureLength();
    error InvalidSigner(address signer, address expectedSigner);
    error InvalidSignature();
    error InsufficientPayment();
    error ZeroAddress();
    error CannotPaySelf();
    error FeeTransferFailed();
    error KOLTransferFailed();
    error InvalidPercentage();
    error InvalidDeposit();
    error AlreadyProcessed();
    error RefundTransferFailed();
    error InvalidFeeRange();
    error TimeWindowNotElapsed();
    error InvalidAmount();
    error InvalidResponseTime();

    // Modifiers
    modifier onlyRole(bytes32 role) {
        if (authority.hasRole(role, msg.sender)) {
            _;
        } else {
            revert Unauthorized();
        }
    }

    // Constructor
    constructor(
        address _authority,
        address _proofSigner,
        address _feesReceiver
    ) {
        authority = ReachAuthority(_authority);
        proofSigner = _proofSigner;
        feesReceiver = _feesReceiver;
        DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    // Internal Functions
    function _computeDomainSeparator() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes("Reach")),
                    keccak256(bytes("2")),
                    block.chainid,
                    address(this)
                )
            );
    }

    function refund(
        uint256 _depositId
    ) external whenNotPaused nonReentrant onlyRole(ENGINE_ROLE) {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.requester == address(0)) revert InvalidDeposit();
        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();

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

    function release(
        uint256 _depositId
    ) external onlyRole(ENGINE_ROLE) whenNotPaused nonReentrant {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.recipient == address(0)) revert InvalidDeposit();
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

    function deposit(
        string memory _identifier,
        uint256 _amount,
        address _kol,
        address _requester,
        uint256 _responseTime,
        uint256 _refundPercentage,
        uint256 _deadline,
        uint256 _nonce,
        bytes memory _signature
    ) external payable nonReentrant whenNotPaused {
        if (
            !_verifySignature(
                _identifier,
                _amount,
                _kol,
                _requester,
                _responseTime,
                _refundPercentage,
                _deadline,
                _nonce,
                _signature
            )
        ) revert InvalidSignature();

        _deposit(
            _identifier,
            _amount,
            _kol,
            _requester,
            _responseTime,
            _refundPercentage
        );
    }

    function _deposit(
        string memory _identifier,
        uint256 _amount,
        address _kol,
        address _requester,
        uint256 _responseTime,
        uint256 _refundPercentage
    ) internal {
        if (msg.value < MIN_PAYMENT_THRESHOLD) revert InsufficientPayment();
        if (msg.value < _amount) revert InsufficientPayment();
        if (_responseTime > MAX_RESPONSE_TIME) revert InvalidResponseTime();
        if (_kol == address(0) || _requester == address(0))
            revert ZeroAddress();
        if (_kol == _requester) revert CannotPaySelf();
        if (
            _refundPercentage > MAXIMUM_PERCENTAGE ||
            _refundPercentage < MINIMUM_PERCENTAGE
        ) revert InvalidPercentage();

        depositId++;

        uint256 totalAmount = msg.value;
        uint256 instantPercentage = PERCENTAGE_BASE - _refundPercentage;
        uint256 instantAmount = (totalAmount * instantPercentage) /
            PERCENTAGE_BASE;
        uint256 escrowAmount = totalAmount - instantAmount;
        uint256 fee = calculateFee(instantAmount);
        uint256 kolInstantAmount = instantAmount - fee;

        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        if (!feeSent) revert FeeTransferFailed();

        (bool kolSent, ) = payable(_kol).call{value: kolInstantAmount}("");
        if (!kolSent) revert KOLTransferFailed();

        deposits[depositId] = Deposit({
            identifier: _identifier,
            requester: _requester,
            recipient: _kol,
            responseTime: _responseTime,
            refundPercentage: _refundPercentage,
            escrowAmount: escrowAmount,
            timestamp: block.timestamp,
            released: false,
            refunded: false
        });

        userDeposits[_requester].push(depositId);

        emit PaymentDeposited(
            depositId,
            _identifier,
            _requester,
            _kol,
            totalAmount,
            kolInstantAmount,
            escrowAmount
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

    function updateProofSigner(
        address _newProofSigner
    ) external onlyRole(ADMIN_ROLE) {
        if (_newProofSigner == address(0)) revert ZeroAddress();
        address oldProofSigner = proofSigner;
        proofSigner = _newProofSigner;
        emit ProofSignerUpdated(oldProofSigner, _newProofSigner);
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

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function _verifySignature(
        string memory _identifier,
        uint256 _amount,
        address _kolAddress,
        address _requester,
        uint256 _responseTime,
        uint256 _refundPercentage,
        uint256 _deadline,
        uint256 _nonce,
        bytes memory _signature
    ) internal returns (bool) {
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encodePacked(
                        DOMAIN_SEPARATOR,
                        _identifier,
                        _amount,
                        _kolAddress,
                        _requester,
                        _responseTime,
                        _refundPercentage,
                        _deadline,
                        _nonce
                    )
                )
            )
        );

        if (block.timestamp > _deadline) revert SignatureExpired();

        uint256 segmentId = _nonce / 256;
        uint256 mask = 1 << (_nonce % 256);

        if (poolNonceBitArrays[_nonce][segmentId] & mask != 0)
            revert NonceAlreadyUsed();

        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        address signer = ecrecover(ethSignedMessageHash, v, r, s);

        if (signer != proofSigner) revert InvalidSigner(signer, proofSigner);

        poolNonceBitArrays[_nonce][segmentId] |= mask;

        return true;
    }

    function forceRefund(uint256 _depositId) external nonReentrant {
        Deposit storage _deposit = deposits[_depositId];

        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();
        if (
            block.timestamp <
            (_deposit.timestamp + _deposit.responseTime + 14400)
        ) revert TimeWindowNotElapsed();

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

    // View Functions
    function splitSignature(
        bytes memory sig
    ) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        if (sig.length != 65) revert InvalidSignatureLength();

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
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

    function calculateFee(uint256 amount) internal view returns (uint256) {
        return (amount * platformFee) / PERCENTAGE_BASE;
    }
}
