// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ConfidentialMultisend} from "../../payroll/ConfidentialMultisend.sol";

contract PayrollTestToken is ERC7984, ZamaEthereumConfig {
    error TransferRejected(uint256 transfer);

    uint256 private _revertAt;
    uint256 private _limitAt;
    uint64 private _transferLimit;
    address private _multisend;
    uint256 private _reenterAt;
    uint256 private _transfers;
    bool private _reuseZeroResult;

    function reuseZeroResult() external {
        _reuseZeroResult = true;
    }

    constructor() ERC7984("Payroll test token", "TEST", "") {
        _mint(msg.sender, FHE.asEuint64(1_000));
    }

    function limitTransfer(uint256 transfer, uint64 limit) external {
        _limitAt = transfer;
        _transferLimit = limit;
        _transfers = 0;
    }

    function revertOnTransfer(uint256 transfer) external {
        _revertAt = transfer;
        _transfers = 0;
    }

    function reenterOnTransfer(address multisend_, uint256 transfer) external {
        _multisend = multisend_;
        _reenterAt = transfer;
        _transfers = 0;
    }

    function _update(address from, address to, euint64 amount) internal override returns (euint64) {
        ++_transfers;
        require(_transfers != _revertAt, TransferRejected(_transfers));
        if (_transfers == _reenterAt) {
            ConfidentialMultisend(_multisend).multisend(address(this), new address[](0), new externalEuint64[](0), "");
        }
        if (_transfers == _limitAt) amount = FHE.min(amount, _transferLimit);
        euint64 actual = super._update(from, to, amount);
        if (_reuseZeroResult) {
            // Used only with zero requests to model a token that shares its zero handle.
            actual = FHE.asEuint64(0);
            FHE.allow(actual, from);
            FHE.allow(actual, to);
            FHE.allowThis(actual);
        }
        return actual;
    }
}
