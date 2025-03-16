// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Authority.sol";

contract Reach is Pausable, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    ReachAuthority public authority;

    uint256 public platformFee = 10; // 10% platform fee
    uint256 public responseTime = 5 days;
    uint256 public minimumPayment = 0.001 ether;

    uint256 public depositId; 
    address public feesReceiver;
    
    struct Deposit {
        string identifier;
        address requester;
        address payable recipient;
        uint256 escrowAmount;  // Only the escrowed 50%
        uint256 timestamp;
        bool released;
        bool refunded;
    }

    mapping(uint256 => Deposit) public deposits;
    mapping(address => uint256[]) public userDeposits;

    event PaymentDeposited(uint256 indexed depositId, string identifier, address requester, address kol, uint256 totalAmount, uint256 instantAmount, uint256 escrowAmount);
    event FundsReleased(uint256 indexed depositId, string identifier, address kol, uint256 amount);
    event RefundIssued(uint256 indexed depositId, string identifier, address requester, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);
    event FeesReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    error PaymentDepositFailed();
    error ZeroAddress();
    error InvalidDeposit();
    error AlreadyProcessed();
    error TimeWindowNotElapsed();
    error InsufficientPayment();
    error Unauthorized();

        modifier onlyRole(bytes32 role) {
        if (authority.hasRole(role, msg.sender)) {
            _;
        } else {
            revert Unauthorized();
        }
    }

    constructor(address _feesReceiver, address _authority) {
        if(_feesReceiver == address(0)) revert ZeroAddress();
        feesReceiver = _feesReceiver;
        authority = ReachAuthority(_authority);
    }

    function deposit(string memory _identifier, address _kolAddress) 
        external 
        payable 
        whenNotPaused 
        nonReentrant 
    {
        if(msg.value < minimumPayment) revert InsufficientPayment();
        if(_kolAddress == address(0)) revert ZeroAddress();
        if(_kolAddress == msg.sender) revert("Cannot pay yourself");
        
        depositId++;
        
        uint256 totalAmount = msg.value;
        uint256 instantAmount = totalAmount / 2;
        uint256 escrowAmount = totalAmount - instantAmount;
        uint256 fee = (instantAmount * platformFee) / 100;
        uint256 kolInstantAmount = instantAmount - fee;

        // Send instant payment to KOL
        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        require(feeSent, "Fee transfer failed");
        
        (bool kolSent, ) = payable(_kolAddress).call{value: kolInstantAmount}("");
        require(kolSent, "KOL instant transfer failed");

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

        emit PaymentDeposited(depositId, _identifier, msg.sender, _kolAddress, totalAmount, kolInstantAmount, escrowAmount);
    }

    function releaseFunds(uint256 _depositId) 
        external 
        onlyRole(ENGINE_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        Deposit storage _deposit = deposits[_depositId];
        
        if (_deposit.requester == address(0)) revert InvalidDeposit();
        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();

        uint256 fee = (_deposit.escrowAmount * platformFee) / 100;
        uint256 kolAmount = _deposit.escrowAmount - fee;

        _deposit.released = true;

        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        require(feeSent, "Fee transfer failed");

        (bool kolSent, ) = _deposit.recipient.call{value: kolAmount}("");
        require(kolSent, "KOL transfer failed");

        emit FundsReleased(_depositId, _deposit.identifier, _deposit.recipient, kolAmount);
    }

    function refund(uint256 _depositId) 
        external 
        whenNotPaused 
        nonReentrant 
        onlyRole(ENGINE_ROLE)
    {
        Deposit storage _deposit = deposits[_depositId];
        
        if (_deposit.requester == address(0)) revert InvalidDeposit();
        if (_deposit.released || _deposit.refunded) revert AlreadyProcessed();
        if (block.timestamp < _deposit.timestamp + responseTime) revert TimeWindowNotElapsed();

        _deposit.refunded = true;

        (bool requesterSent, ) = _deposit.requester.call{value: _deposit.escrowAmount}("");
        require(requesterSent, "Requester transfer failed");

        emit RefundIssued(_depositId, _deposit.identifier, _deposit.requester, _deposit.escrowAmount);
    }

    function updateFeesReceiver(address _newReceiver) external onlyRole(ADMIN_ROLE) {
        if(_newReceiver == address(0)) revert ZeroAddress();
        address oldReceiver = feesReceiver;
        feesReceiver = _newReceiver;
        emit FeesReceiverUpdated(oldReceiver, _newReceiver);
    }

    function getUserDeposits(address _user) external view returns (uint256[] memory) {
        return userDeposits[_user];
    }

    function getDepositDetails(uint256 _depositId) external view returns (Deposit memory) {
        return deposits[_depositId];
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function recoverFunds(uint256 _amount) 
        external 
        onlyRole(ADMIN_ROLE) 
        nonReentrant 
    {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to recover");
        
        (bool sent, ) = msg.sender.call{value: _amount}("");
        require(sent, "Recovery transfer failed");
        
        emit Withdrawal(msg.sender, _amount);
    }
}
