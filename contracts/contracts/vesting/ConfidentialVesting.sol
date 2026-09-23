// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice Shared custody for fixed, confidential grants. See docs/adr/0006-vesting.md.
contract ConfidentialVesting is ZamaEthereumConfig, ReentrancyGuardTransient {
    struct Grant {
        address treasury;
        address recipient;
        address token;
        uint48 start;
        uint48 end;
        uint48 cliff;
        bool revocable;
        bool revoked;
        uint256 revokedAt;
        euint64 refundEntitlement;
        euint64 refunded;
        euint64 allocation;
        euint64 claimed;
    }

    error InvalidSchedule();
    error InvalidAddress();
    error UnknownGrant();
    error UnauthorizedRecipient();
    error UnauthorizedTreasury();
    error IrrevocableGrant();
    error AlreadyRevoked();
    error GrantNotRevoked();

    uint256 private _grantCount;
    mapping(uint256 grantId => Grant grant) private _grants;

    event GrantRefundRetried(uint256 indexed grantId);
    event GrantRevoked(uint256 indexed grantId);
    event GrantClaimed(uint256 indexed grantId);
    event GrantCreated(uint256 indexed grantId, address indexed treasury, address indexed recipient, address token);

    function createGrant(
        address recipient,
        address token,
        uint48 start,
        uint48 end,
        uint48 cliff,
        bool revocable,
        externalEuint64 amount,
        bytes calldata inputProof
    ) external nonReentrant returns (uint256 grantId) {
        if (end <= start || end <= block.timestamp || (cliff != 0 && (cliff < start || cliff > end))) {
            revert InvalidSchedule();
        }
        if (recipient == address(0) || recipient == address(this) || token.code.length == 0) {
            revert InvalidAddress();
        }
        euint64 requested = FHE.fromExternal(amount, inputProof);
        FHE.allowTransient(requested, token);
        euint64 received = IERC7984(token).confidentialTransferFrom(msg.sender, address(this), requested);
        grantId = ++_grantCount;
        Grant storage grant = _grants[grantId];
        grant.treasury = msg.sender;
        grant.recipient = recipient;
        grant.token = token;
        grant.start = start;
        grant.end = end;
        grant.cliff = cliff;
        grant.revocable = revocable;
        grant.allocation = FHE.add(received, uint64(0));
        // Derive a grant-specific zero; trivial zero handles can be shared across grants.
        grant.claimed = FHE.sub(grant.allocation, grant.allocation);
        grant.refundEntitlement = grant.claimed;
        grant.refunded = grant.claimed;
        _allow(grant, grant.allocation);
        _allow(grant, grant.claimed);
        emit GrantCreated(grantId, msg.sender, recipient, token);
    }

    function claim(uint256 grantId) external nonReentrant {
        Grant storage grant = _grants[grantId];
        if (grant.treasury == address(0)) revert UnknownGrant();
        if (msg.sender != grant.recipient) revert UnauthorizedRecipient();
        uint256 timestamp = grant.revoked ? grant.revokedAt : block.timestamp;
        euint64 available = FHE.sub(_vestedAt(grant, timestamp), grant.claimed);
        FHE.allowTransient(available, grant.token);
        euint64 sent = IERC7984(grant.token).confidentialTransfer(grant.recipient, available);
        grant.claimed = FHE.add(grant.claimed, sent);
        _allow(grant, grant.claimed);
        emit GrantClaimed(grantId);
    }

    function revoke(uint256 grantId) external nonReentrant {
        Grant storage grant = _grants[grantId];
        if (grant.treasury == address(0)) revert UnknownGrant();
        if (msg.sender != grant.treasury) revert UnauthorizedTreasury();
        if (!grant.revocable) revert IrrevocableGrant();
        if (grant.revoked) revert AlreadyRevoked();
        grant.revoked = true;
        grant.revokedAt = block.timestamp;
        grant.refundEntitlement = FHE.sub(grant.allocation, _vestedAt(grant, block.timestamp));
        _allow(grant, grant.refundEntitlement);
        _refund(grant);
        emit GrantRevoked(grantId);
    }

    function retryRefund(uint256 grantId) external nonReentrant {
        Grant storage grant = _grants[grantId];
        if (grant.treasury == address(0)) revert UnknownGrant();
        if (msg.sender != grant.treasury) revert UnauthorizedTreasury();
        if (!grant.revoked) revert GrantNotRevoked();
        _refund(grant);
        emit GrantRefundRetried(grantId);
    }

    function getGrant(uint256 grantId) external view returns (Grant memory) {
        if (_grants[grantId].treasury == address(0)) revert UnknownGrant();
        return _grants[grantId];
    }

    function _vestedAt(Grant storage grant, uint256 timestamp) private returns (euint64) {
        if (timestamp < grant.start || timestamp < grant.cliff) return FHE.asEuint64(0);
        if (timestamp >= grant.end) return grant.allocation;
        // A uint64 allocation times a uint48 elapsed duration fits in uint128.
        return
            FHE.asEuint64(
                FHE.div(
                    FHE.mul(FHE.asEuint128(grant.allocation), uint128(timestamp - grant.start)),
                    uint128(grant.end - grant.start)
                )
            );
    }

    function _refund(Grant storage grant) private {
        euint64 outstanding = FHE.sub(grant.refundEntitlement, grant.refunded);
        FHE.allowTransient(outstanding, grant.token);
        euint64 sent = IERC7984(grant.token).confidentialTransfer(grant.treasury, outstanding);
        grant.refunded = FHE.add(grant.refunded, sent);
        _allow(grant, grant.refunded);
    }

    function _allow(Grant storage grant, euint64 amount) private {
        FHE.allowThis(amount);
        FHE.allow(amount, grant.treasury);
        FHE.allow(amount, grant.recipient);
    }
}
