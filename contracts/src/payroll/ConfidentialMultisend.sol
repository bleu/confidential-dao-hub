// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract ConfidentialMultisend is ZamaEthereumConfig, ReentrancyGuardTransient {
    error InvalidBatchSize(uint256 size);
    error MismatchedArrays();
    error InvalidRecipient(address recipient);

    event Payment(
        address indexed sender,
        address indexed token,
        address indexed recipient,
        euint64 requestedAmount,
        euint64 actualAmount
    );

    function multisend(
        address token,
        address[] calldata recipients,
        externalEuint64[] calldata encryptedAmounts,
        bytes calldata inputProof
    ) external nonReentrant {
        require(recipients.length > 0 && recipients.length <= 10, InvalidBatchSize(recipients.length));
        require(recipients.length == encryptedAmounts.length, MismatchedArrays());
        for (uint256 i; i < recipients.length; ++i) {
            require(recipients[i] != address(0) && recipients[i] != address(this), InvalidRecipient(recipients[i]));
        }
        euint64[] memory amounts = new euint64[](encryptedAmounts.length);
        euint64 total = FHE.asEuint64(0);
        ebool valid = FHE.asEbool(true);
        for (uint256 i; i < amounts.length; ++i) {
            amounts[i] = FHE.fromExternal(encryptedAmounts[i], inputProof);
            euint64 next = FHE.add(total, amounts[i]);
            valid = FHE.and(valid, FHE.ge(next, total));
            total = next;
        }
        total = FHE.select(valid, total, FHE.asEuint64(0));
        FHE.allowTransient(total, token);
        euint64 pulled = IERC7984(token).confidentialTransferFrom(msg.sender, address(this), total);
        ebool funded = FHE.and(valid, FHE.eq(pulled, total));
        for (uint256 i; i < amounts.length; ++i) {
            // Fresh handles keep repeated inputs from sharing recipient permissions.
            amounts[i] = FHE.select(FHE.randEbool(), amounts[i], amounts[i]);
            euint64 outgoing = FHE.select(funded, amounts[i], FHE.asEuint64(0));
            FHE.allowTransient(outgoing, token);
            euint64 actual = IERC7984(token).confidentialTransfer(recipients[i], outgoing);
            actual = FHE.select(FHE.randEbool(), actual, actual);
            FHE.allow(actual, recipients[i]);
            FHE.allowThis(amounts[i]);
            FHE.allow(amounts[i], msg.sender);
            FHE.allow(amounts[i], recipients[i]);
            FHE.allowThis(actual);
            FHE.allow(actual, msg.sender);
            emit Payment(msg.sender, token, recipients[i], amounts[i], actual);
        }
    }
}
