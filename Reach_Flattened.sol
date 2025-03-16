// Sources flattened with hardhat v2.22.17 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts/utils/Context.sol@v5.1.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/access/Ownable.sol@v5.1.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/utils/Pausable.sol@v5.1.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/Pausable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Context {
    bool private _paused;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Initializes the contract in unpaused state.
     */
    constructor() {
        _paused = false;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}


// File @openzeppelin/contracts/utils/ReentrancyGuard.sol@v5.1.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}


// File contracts/Reach.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;



contract Reach is Pausable, ReentrancyGuard, Ownable {
    uint256 public constant PLATFORM_FEE = 10; // 10% platform fee
    uint256 public constant RESPONSE_TIME = 5 days;
    uint256 public constant MINIMUM_PAYMENT = 0.01 ether;

    uint256 public depositId; 
    address public feesReceiver;
    
    struct Deposit {
        string  identifier;
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

    constructor(address _feesReceiver) Ownable(msg.sender) {
        if(_feesReceiver == address(0)) revert ZeroAddress();
        feesReceiver = _feesReceiver;
    }

    function deposit(string memory _identifier, address _kolAddress) 
        external 
        payable 
        whenNotPaused 
        nonReentrant 
    {
        if(msg.value < MINIMUM_PAYMENT) revert InsufficientPayment();
        if(_kolAddress == address(0)) revert ZeroAddress();
        if(_kolAddress == msg.sender) revert("Cannot pay yourself");
        
        depositId++;
        
        uint256 totalAmount = msg.value;
        uint256 instantAmount = totalAmount / 2;
        uint256 escrowAmount = totalAmount - instantAmount;
        uint256 fee = (instantAmount * PLATFORM_FEE) / 100;
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
        onlyOwner 
        whenNotPaused 
        nonReentrant 
    {
        Deposit storage deposit = deposits[_depositId];
        
        if (deposit.requester == address(0)) revert InvalidDeposit();
        if (deposit.released || deposit.refunded) revert AlreadyProcessed();

        uint256 fee = (deposit.escrowAmount * PLATFORM_FEE) / 100;
        uint256 kolAmount = deposit.escrowAmount - fee;

        deposit.released = true;

        (bool feeSent, ) = feesReceiver.call{value: fee}("");
        require(feeSent, "Fee transfer failed");

        (bool kolSent, ) = deposit.recipient.call{value: kolAmount}("");
        require(kolSent, "KOL transfer failed");

        emit FundsReleased(_depositId, deposit.identifier, deposit.recipient, kolAmount);
    }

    function refund(uint256 _depositId) 
        external 
        whenNotPaused 
        nonReentrant 
        onlyOwner
    {
        Deposit storage deposit = deposits[_depositId];
        
        if (deposit.requester == address(0)) revert InvalidDeposit();
        if (deposit.released || deposit.refunded) revert AlreadyProcessed();
        if (msg.sender != owner() && msg.sender != deposit.requester) revert Unauthorized();
        if (block.timestamp < deposit.timestamp + RESPONSE_TIME) revert TimeWindowNotElapsed();

        deposit.refunded = true;

        (bool requesterSent, ) = deposit.requester.call{value: deposit.escrowAmount}("");
        require(requesterSent, "Requester transfer failed");

        emit RefundIssued(_depositId, deposit.identifier, deposit.requester, deposit.escrowAmount);
    }

    function updateFeesReceiver(address _newReceiver) external onlyOwner {
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function recoverFunds() 
        external 
        onlyOwner 
        nonReentrant 
    {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to recover");
        
        (bool sent, ) = owner().call{value: balance}("");
        require(sent, "Recovery transfer failed");
        
        emit Withdrawal(owner(), balance);
    }
}
