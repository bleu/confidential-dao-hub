// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ConfidentialGovToken} from "../ConfidentialGovToken.sol";

/// @dev Test-only token restrictions; never deploy with real funds.
contract VestingTestToken is ConfidentialGovToken {
    error TransferRejected();

    mapping(address recipient => uint8 mode) private _transferModes;

    address private _callbackTarget;
    bytes private _callbackData;

    constructor() ConfidentialGovToken("Vesting Test Token", "VTT", 10_000) {}

    function setTransferMode(address recipient, uint8 mode) external {
        _transferModes[recipient] = mode;
    }

    function setCallback(address target, bytes calldata data) external {
        _callbackTarget = target;
        _callbackData = data;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        return Address.functionCall(target, data);
    }

    function _update(address from, address to, euint64 amount) internal override returns (euint64) {
        if (_callbackTarget != address(0)) {
            address target = _callbackTarget;
            _callbackTarget = address(0);
            Address.functionCall(target, _callbackData);
        }
        if (_transferModes[to] == 2) revert TransferRejected();
        return super._update(from, to, _transferModes[to] == 1 ? FHE.asEuint64(0) : amount);
    }
}
