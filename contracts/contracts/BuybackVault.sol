// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPriceOracle} from "./MockPriceOracle.sol";

/// @title BuybackVault
/// @notice A standing dark pool for protocol buybacks on Zama FHEVM. The treasury
///         funds an FHE-encrypted budget; sellers rest encrypted offers with an
///         encrypted price floor into rolling settlement windows. Fills are
///         computed under FHE against an encrypted running budget:
///
///             fill      = min(offer, remaining)
///             remaining = remaining - fill
///
///         Windows settle at the oracle price when they roll (permissionless
///         after expiry). At claim time each fill only counts if the settlement
///         price met the seller's encrypted floor — nobody else can tell whose
///         floor failed. Unspent budget carries over to the next window, and the
///         treasury can top the budget up confidentially at any time, so an open
///         window carries no information about actual buyback demand.
///
///         After a disclosure delay, anyone can trigger KMS-verified public
///         decryption of a settled window's total ("confidential during
///         execution, accountable afterward").
///
/// @dev PoC limitations (documented, intentional):
///      - Treasury solvency is NOT verified on-chain; if the vault is short of
///        cUSDT, claim payouts silently transfer 0 (ERC-7984 all-or-nothing).
///      - Budget reserved by a fill whose price floor later fails is not
///        recycled within that window (redistribution would need loops).
///      - Disclosed totals are a snapshot at disclosure time; floor-failed
///        fills claimed afterwards are not reflected.
///      - One offer per seller per window; participation metadata is public,
///        only amounts and floors are encrypted.
contract BuybackVault is ZamaEthereumConfig, Ownable {
    /// @notice Governance token bought back by the treasury (ERC-7984).
    IERC7984 public immutable CTOKEN;
    /// @notice Confidential payment token (ERC-7984), e.g. cUSDT.
    IERC7984 public immutable CUSDT;
    /// @notice Settlement price source (2-decimal cUSDT per cTOKEN).
    IPriceOracle public immutable ORACLE;

    /// @notice Delay after a window settles before its total can be publicly disclosed.
    uint64 public constant DISCLOSURE_DELAY = 5 minutes;
    /// @notice Encrypted budgets are clamped to this cap (1e9 tokens at 6 decimals)
    ///         so that fill * price can never overflow euint64.
    uint64 public constant MAX_BUDGET = 1e15;
    /// @notice Max settlement price: 100.00 cUSDT per cTOKEN. MAX_BUDGET * MAX_PRICE < 2**64.
    uint64 public constant MAX_PRICE = 10_000;

    /// @notice Length of a settlement window in seconds.
    uint64 public epochDuration;

    struct Epoch {
        euint64 budget; // encrypted, cTOKEN units (carryover + top-ups)
        euint64 remaining; // encrypted running budget
        euint64 totalFilled; // encrypted matched amount (floor-failed fills backed out at claim)
        uint64 settlementPrice; // PUBLIC, 2dp; 0 while the window is open
        uint64 openedAt;
        uint64 endsAt; // window can be rolled permissionlessly after this
        uint64 closedAt;
        bool open;
        bool disclosed;
        uint64 disclosedTotal; // plaintext total after disclosure
    }

    struct Position {
        euint64 offer; // encrypted amount actually escrowed
        euint64 fill; // encrypted matched amount (before the price-floor gate)
        euint64 minPrice; // encrypted seller floor, 2dp; 0 = any price
        bool submitted;
        bool claimed;
    }

    uint256 public epochCount;
    uint256 public currentEpochId; // only meaningful while hasOpenEpoch
    bool public hasOpenEpoch;

    mapping(uint256 epochId => Epoch) private _epochs;
    mapping(uint256 epochId => mapping(address seller => Position)) private _positions;

    event EpochOpened(uint256 indexed epochId, uint64 endsAt);
    event EpochClosed(uint256 indexed epochId, uint64 settlementPrice);
    event BudgetToppedUp(uint256 indexed epochId);
    event OfferSubmitted(uint256 indexed epochId, address indexed seller);
    event Claimed(uint256 indexed epochId, address indexed seller);
    event DisclosureRequested(uint256 indexed epochId, bytes32 totalFilledHandle);
    event EpochDisclosed(uint256 indexed epochId, uint64 totalFilled);
    event EpochDurationSet(uint64 duration);

    constructor(address cToken_, address cUsdt_, address oracle_, uint64 epochDuration_) Ownable(msg.sender) {
        require(cToken_ != address(0) && cUsdt_ != address(0) && oracle_ != address(0), "vault: zero address");
        require(epochDuration_ >= 60 && epochDuration_ <= 30 days, "vault: bad duration");
        CTOKEN = IERC7984(cToken_);
        CUSDT = IERC7984(cUsdt_);
        ORACLE = IPriceOracle(oracle_);
        epochDuration = epochDuration_;
    }

    /// @notice Starts the pool with an encrypted initial budget. After this the
    ///         pool stays open forever: windows roll, budget carries over.
    function openEpoch(externalEuint64 budgetExt, bytes calldata inputProof) external onlyOwner {
        require(!hasOpenEpoch, "vault: epoch already open");
        euint64 budget = FHE.min(FHE.fromExternal(budgetExt, inputProof), MAX_BUDGET);
        _startEpoch(budget);
    }

    /// @dev Opens a new window with the given (already clamped/ACL'd) encrypted budget.
    function _startEpoch(euint64 budget) internal {
        uint256 epochId = epochCount++;
        Epoch storage e = _epochs[epochId];
        euint64 zero = FHE.asEuint64(0);
        e.budget = budget;
        e.remaining = budget;
        e.totalFilled = zero;
        e.openedAt = uint64(block.timestamp);
        e.endsAt = uint64(block.timestamp) + epochDuration;
        e.open = true;

        currentEpochId = epochId;
        hasOpenEpoch = true;

        FHE.allowThis(budget);
        FHE.allow(budget, owner());
        FHE.allowThis(zero);
        FHE.allow(zero, owner());

        emit EpochOpened(epochId, e.endsAt);
    }

    /// @notice Confidentially adds encrypted budget to the current window. The
    ///         amount is a ciphertext — a top-up of 0 is indistinguishable from
    ///         a real one, so top-up events carry no demand information.
    function topUp(externalEuint64 amountExt, bytes calldata inputProof) external onlyOwner {
        require(hasOpenEpoch, "vault: no open epoch");
        Epoch storage e = _epochs[currentEpochId];
        euint64 amount = FHE.min(FHE.fromExternal(amountExt, inputProof), MAX_BUDGET);
        // Both operands are <= MAX_BUDGET so the add cannot wrap; clamp after.
        e.budget = FHE.min(FHE.add(e.budget, amount), MAX_BUDGET);
        e.remaining = FHE.min(FHE.add(e.remaining, amount), MAX_BUDGET);

        FHE.allowThis(e.budget);
        FHE.allow(e.budget, owner());
        FHE.allowThis(e.remaining);
        FHE.allow(e.remaining, owner());

        emit BudgetToppedUp(currentEpochId);
    }

    /// @notice Settles the current window at the oracle price and opens the next
    ///         one with the unspent budget carried over. Permissionless once the
    ///         window has expired; the owner may roll early (demo convenience).
    function rollEpoch() public {
        require(hasOpenEpoch, "vault: no open epoch");
        Epoch storage e = _epochs[currentEpochId];
        require(msg.sender == owner() || block.timestamp >= e.endsAt, "vault: window not ended");

        uint64 price = ORACLE.price();
        require(price > 0, "vault: oracle price unset");
        if (price > MAX_PRICE) price = MAX_PRICE;

        e.open = false;
        e.closedAt = uint64(block.timestamp);
        e.settlementPrice = price;
        emit EpochClosed(currentEpochId, price);

        _startEpoch(e.remaining); // carryover: unspent budget rolls forward
    }

    /// @notice Escrows an encrypted cTOKEN offer with an encrypted price floor
    ///         into the current window (auto-rolling it first if expired) and
    ///         computes the encrypted fill against the running budget.
    /// @dev The seller must have called cTOKEN.setOperator(vault, expiry). The
    ///      effective offer is the amount actually transferred by the token
    ///      (0 if the seller's balance is insufficient — ERC-7984 all-or-nothing).
    ///      `minPriceExt` is 2dp (210 = 2.10 cUSDT); encrypt 0 to accept any price.
    function submitOffer(
        externalEuint64 amountExt,
        externalEuint64 minPriceExt,
        bytes calldata inputProof
    ) external {
        require(hasOpenEpoch, "vault: no open epoch");
        if (block.timestamp >= _epochs[currentEpochId].endsAt) rollEpoch();

        uint256 epochId = currentEpochId;
        Epoch storage e = _epochs[epochId];
        Position storage p = _positions[epochId][msg.sender];
        require(!p.submitted, "vault: already submitted");
        p.submitted = true;

        euint64 amount = FHE.fromExternal(amountExt, inputProof);
        euint64 minPrice = FHE.fromExternal(minPriceExt, inputProof);
        FHE.allowTransient(amount, address(CTOKEN));
        // Actual escrowed amount: `amount` if the seller had the balance, else 0.
        euint64 offer = CTOKEN.confidentialTransferFrom(msg.sender, address(this), amount);

        euint64 fill = FHE.min(offer, e.remaining);
        e.remaining = FHE.sub(e.remaining, fill);
        e.totalFilled = FHE.add(e.totalFilled, fill);
        p.offer = offer;
        p.fill = fill;
        p.minPrice = minPrice;

        FHE.allowThis(offer);
        FHE.allow(offer, msg.sender);
        FHE.allowThis(fill);
        FHE.allow(fill, msg.sender);
        FHE.allowThis(minPrice);
        FHE.allow(minPrice, msg.sender);
        FHE.allowThis(e.remaining);
        FHE.allow(e.remaining, owner());
        FHE.allowThis(e.totalFilled);
        FHE.allow(e.totalFilled, owner());

        emit OfferSubmitted(epochId, msg.sender);
    }

    /// @notice Claims payout and refund for a settled window. The fill only
    ///         counts if the settlement price met the seller's encrypted floor;
    ///         otherwise the full offer is refunded — indistinguishably.
    function claim(uint256 epochId) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open, "vault: window not settled");
        Position storage p = _positions[epochId][msg.sender];
        require(p.submitted, "vault: no offer");
        require(!p.claimed, "vault: already claimed");
        p.claimed = true;

        // Price-floor gate, evaluated under FHE: floor failed => fill counts as 0.
        ebool floorMet = FHE.le(p.minPrice, e.settlementPrice);
        euint64 effectiveFill = FHE.select(floorMet, p.fill, FHE.asEuint64(0));

        // price is 2dp: payout = fill * price / 100. effectiveFill <= MAX_BUDGET
        // and price <= MAX_PRICE, so the product fits euint64.
        euint64 payout = FHE.div(FHE.mul(effectiveFill, e.settlementPrice), 100);
        euint64 refund = FHE.sub(p.offer, effectiveFill);

        // Keep disclosed totals honest: back out the floor-failed portion.
        e.totalFilled = FHE.sub(e.totalFilled, FHE.sub(p.fill, effectiveFill));
        FHE.allowThis(e.totalFilled);
        FHE.allow(e.totalFilled, owner());

        FHE.allowTransient(payout, address(CUSDT));
        CUSDT.confidentialTransfer(msg.sender, payout);
        FHE.allowTransient(refund, address(CTOKEN));
        CTOKEN.confidentialTransfer(msg.sender, refund);

        emit Claimed(epochId, msg.sender);
    }

    /// @notice Sets the duration of future windows (current window keeps its endsAt).
    function setEpochDuration(uint64 duration) external onlyOwner {
        require(duration >= 60 && duration <= 30 days, "vault: bad duration");
        epochDuration = duration;
        emit EpochDurationSet(duration);
    }

    /// @notice After DISCLOSURE_DELAY past window settlement, anyone can mark the
    ///         window's encrypted total for public decryption via the Zama KMS.
    /// @dev Off-chain: call the relayer's publicDecrypt on the totalFilled handle,
    ///      then submit the cleartext + KMS proof to `finalizeDisclosure`.
    function requestDisclosure(uint256 epochId) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open && e.closedAt != 0, "vault: window not settled");
        require(block.timestamp >= e.closedAt + DISCLOSURE_DELAY, "vault: disclosure delay not elapsed");
        require(!e.disclosed, "vault: already disclosed");

        FHE.makePubliclyDecryptable(e.totalFilled);

        emit DisclosureRequested(epochId, FHE.toBytes32(e.totalFilled));
    }

    /// @notice Stores the publicly decrypted window total after verifying the KMS
    ///         signatures over the cleartext. Callable by anyone with a valid proof.
    /// @param cleartexts ABI-encoded cleartext list from the relayer's publicDecrypt.
    /// @param decryptionProof KMS public decryption proof from the relayer.
    function finalizeDisclosure(uint256 epochId, bytes calldata cleartexts, bytes calldata decryptionProof) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open && e.closedAt != 0, "vault: window not settled");
        require(!e.disclosed, "vault: already disclosed");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(e.totalFilled);
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        uint64 total = abi.decode(cleartexts, (uint64));
        e.disclosed = true;
        e.disclosedTotal = total;

        emit EpochDisclosed(epochId, total);
    }

    // --- Views (ciphertext handles for the frontend; decryption is ACL-gated) ---

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        return _epochs[epochId];
    }

    function getMyOffer(uint256 epochId) external view returns (euint64) {
        return _positions[epochId][msg.sender].offer;
    }

    function getMyFill(uint256 epochId) external view returns (euint64) {
        return _positions[epochId][msg.sender].fill;
    }

    function getMyMinPrice(uint256 epochId) external view returns (euint64) {
        return _positions[epochId][msg.sender].minPrice;
    }

    function getPosition(uint256 epochId, address seller) external view returns (bool submitted, bool claimed) {
        Position storage p = _positions[epochId][seller];
        return (p.submitted, p.claimed);
    }
}
