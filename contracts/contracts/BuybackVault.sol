// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title BuybackVault
/// @notice Dark-pool-style confidential buyback vault. The treasury (owner) opens
///         sealed epochs with an FHE-encrypted budget (in cTOKEN units) and a public
///         reference price. Sellers escrow cTOKEN offers whose amounts stay encrypted;
///         fills are computed under FHE with a first-come-first-served running budget:
///
///             fill      = min(offer, remaining)
///             remaining = remaining - fill
///
///         After the epoch closes, sellers claim an encrypted cUSDT payout
///         (fill * price) plus an encrypted cTOKEN refund (offer - fill). After a
///         disclosure delay, anyone can trigger public decryption of the epoch's
///         total filled amount ("confidential during execution, accountable after").
///
/// @dev PoC limitations (documented, intentional):
///      - Treasury solvency is NOT verified on-chain. The treasury is expected to
///        fund the vault with cUSDT before opening an epoch; if underfunded, claim
///        payouts silently transfer 0 (ERC-7984 all-or-nothing transfer semantics).
///      - One offer per seller per epoch; no cancellation; one epoch open at a time.
///      - Participation metadata (who offered, when, number of offers) is public;
///        only amounts are encrypted.
contract BuybackVault is ZamaEthereumConfig, Ownable {
    /// @notice Governance token bought back by the treasury (ERC-7984).
    IERC7984 public immutable CTOKEN;
    /// @notice Confidential payment token (ERC-7984), e.g. cUSDT.
    IERC7984 public immutable CUSDT;

    /// @notice Delay after epoch close before the epoch total can be publicly disclosed.
    uint64 public constant DISCLOSURE_DELAY = 5 minutes;
    /// @notice Encrypted budgets are clamped to this cap (1e9 tokens at 6 decimals)
    ///         so that fill * price can never overflow euint64.
    uint64 public constant MAX_BUDGET = 1e15;
    /// @notice Max price: 1000 cUSDT-units per cTOKEN-unit. MAX_BUDGET * MAX_PRICE < 2**64.
    uint64 public constant MAX_PRICE = 1000;

    struct Epoch {
        euint64 budget; // encrypted, cTOKEN units
        euint64 remaining; // encrypted running budget
        euint64 totalFilled; // encrypted cumulative fills
        uint64 price; // PUBLIC: cUSDT base units per cTOKEN base unit (both 6dp)
        uint64 openedAt;
        uint64 closedAt;
        bool open;
        bool disclosed;
        uint64 disclosedTotal; // plaintext total after disclosure
    }

    struct Position {
        euint64 offer; // encrypted amount actually escrowed
        euint64 fill; // encrypted filled amount
        bool submitted;
        bool claimed;
    }

    uint256 public epochCount;
    uint256 public currentEpochId; // only meaningful while hasOpenEpoch
    bool public hasOpenEpoch;

    mapping(uint256 epochId => Epoch) private _epochs;
    mapping(uint256 epochId => mapping(address seller => Position)) private _positions;

    event EpochOpened(uint256 indexed epochId, uint64 price);
    event OfferSubmitted(uint256 indexed epochId, address indexed seller);
    event EpochClosed(uint256 indexed epochId);
    event Claimed(uint256 indexed epochId, address indexed seller);
    event DisclosureRequested(uint256 indexed epochId, bytes32 totalFilledHandle);
    event EpochDisclosed(uint256 indexed epochId, uint64 totalFilled);

    constructor(address cToken_, address cUsdt_) Ownable(msg.sender) {
        require(cToken_ != address(0) && cUsdt_ != address(0), "vault: zero token address");
        CTOKEN = IERC7984(cToken_);
        CUSDT = IERC7984(cUsdt_);
    }

    /// @notice Opens a new epoch with an encrypted cTOKEN budget and a public price.
    /// @dev The treasury must fund the vault with cUSDT beforehand (best-effort, see
    ///      contract-level PoC note). The budget is clamped to MAX_BUDGET under FHE.
    function openEpoch(externalEuint64 budgetExt, bytes calldata inputProof, uint64 price) external onlyOwner {
        require(!hasOpenEpoch, "vault: epoch already open");
        require(price > 0 && price <= MAX_PRICE, "vault: invalid price");

        euint64 budget = FHE.min(FHE.fromExternal(budgetExt, inputProof), MAX_BUDGET);
        euint64 zero = FHE.asEuint64(0);

        uint256 epochId = epochCount++;
        Epoch storage e = _epochs[epochId];
        e.budget = budget;
        e.remaining = budget;
        e.totalFilled = zero;
        e.price = price;
        e.openedAt = uint64(block.timestamp);
        e.open = true;

        currentEpochId = epochId;
        hasOpenEpoch = true;

        FHE.allowThis(budget);
        FHE.allow(budget, owner());
        FHE.allowThis(zero);
        FHE.allow(zero, owner());

        emit EpochOpened(epochId, price);
    }

    /// @notice Escrows an encrypted cTOKEN offer into the open epoch and computes the
    ///         encrypted fill against the running budget. One offer per seller per epoch.
    /// @dev The seller must have called cTOKEN.setOperator(vault, expiry) beforehand.
    ///      The effective offer is the amount actually transferred by the token
    ///      (0 if the seller's balance is insufficient — ERC-7984 all-or-nothing).
    function submitOffer(externalEuint64 amountExt, bytes calldata inputProof) external {
        require(hasOpenEpoch, "vault: no open epoch");
        uint256 epochId = currentEpochId;
        Epoch storage e = _epochs[epochId];
        Position storage p = _positions[epochId][msg.sender];
        require(!p.submitted, "vault: already submitted");
        p.submitted = true;

        euint64 amount = FHE.fromExternal(amountExt, inputProof);
        FHE.allowTransient(amount, address(CTOKEN));
        // Actual escrowed amount: `amount` if the seller had the balance, else 0.
        euint64 offer = CTOKEN.confidentialTransferFrom(msg.sender, address(this), amount);

        euint64 fill = FHE.min(offer, e.remaining);
        e.remaining = FHE.sub(e.remaining, fill);
        e.totalFilled = FHE.add(e.totalFilled, fill);
        p.offer = offer;
        p.fill = fill;

        FHE.allowThis(offer);
        FHE.allow(offer, msg.sender);
        FHE.allowThis(fill);
        FHE.allow(fill, msg.sender);
        FHE.allowThis(e.remaining);
        FHE.allow(e.remaining, owner());
        FHE.allowThis(e.totalFilled);
        FHE.allow(e.totalFilled, owner());

        emit OfferSubmitted(epochId, msg.sender);
    }

    /// @notice Closes the open epoch. Claims become available; no FHE work needed.
    function closeEpoch() external onlyOwner {
        require(hasOpenEpoch, "vault: no open epoch");
        uint256 epochId = currentEpochId;
        Epoch storage e = _epochs[epochId];
        e.open = false;
        e.closedAt = uint64(block.timestamp);
        hasOpenEpoch = false;

        emit EpochClosed(epochId);
    }

    /// @notice Claims the encrypted cUSDT payout (fill * price) and cTOKEN refund
    ///         (offer - fill) for a closed epoch.
    function claim(uint256 epochId) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open, "vault: epoch still open");
        Position storage p = _positions[epochId][msg.sender];
        require(p.submitted, "vault: no offer");
        require(!p.claimed, "vault: already claimed");
        p.claimed = true;

        // Amounts and price are both 6dp; price is defined as cUSDT base units per
        // cTOKEN base unit, so payout needs no division. Scalar mul: 365k HCU.
        euint64 payout = FHE.mul(p.fill, e.price);
        euint64 refund = FHE.sub(p.offer, p.fill); // >= 0 since fill = min(offer, ...)

        FHE.allowTransient(payout, address(CUSDT));
        CUSDT.confidentialTransfer(msg.sender, payout);
        FHE.allowTransient(refund, address(CTOKEN));
        CTOKEN.confidentialTransfer(msg.sender, refund);

        emit Claimed(epochId, msg.sender);
    }

    /// @notice After DISCLOSURE_DELAY past epoch close, anyone can mark the epoch's
    ///         encrypted total for public decryption via the Zama KMS.
    /// @dev Off-chain: call the relayer's publicDecrypt on the totalFilled handle,
    ///      then submit the cleartext + KMS proof to `finalizeDisclosure`.
    function requestDisclosure(uint256 epochId) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open && e.closedAt != 0, "vault: epoch not closed");
        require(block.timestamp >= e.closedAt + DISCLOSURE_DELAY, "vault: disclosure delay not elapsed");
        require(!e.disclosed, "vault: already disclosed");

        FHE.makePubliclyDecryptable(e.totalFilled);

        emit DisclosureRequested(epochId, FHE.toBytes32(e.totalFilled));
    }

    /// @notice Stores the publicly decrypted epoch total after verifying the KMS
    ///         signatures over the cleartext. Callable by anyone with a valid proof.
    /// @param cleartexts ABI-encoded cleartext list from the relayer's publicDecrypt.
    /// @param decryptionProof KMS public decryption proof from the relayer.
    function finalizeDisclosure(uint256 epochId, bytes calldata cleartexts, bytes calldata decryptionProof) external {
        require(epochId < epochCount, "vault: unknown epoch");
        Epoch storage e = _epochs[epochId];
        require(!e.open && e.closedAt != 0, "vault: epoch not closed");
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

    function getPosition(uint256 epochId, address seller) external view returns (bool submitted, bool claimed) {
        Position storage p = _positions[epochId][seller];
        return (p.submitted, p.claimed);
    }
}
