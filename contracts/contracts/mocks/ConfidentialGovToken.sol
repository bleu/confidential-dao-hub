// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ConfidentialGovToken
/// @notice ERC-7984 confidential token used as the mock governance token (cTOKEN)
///         and, in demo deployments, as a stand-in confidential payment token.
///         Balances and transfer amounts are encrypted (euint64, 6 decimals).
/// @dev PoC-only: `faucet` lets anyone mint a capped plaintext amount so demo
///      users can acquire tokens. The faucet amount is public by design (it is
///      a plaintext calldata value); only balances/transfers stay confidential.
contract ConfidentialGovToken is ERC7984, ZamaEthereumConfig, Ownable {
    /// @notice Max plaintext amount mintable per faucet call (10,000 tokens, 6 decimals).
    uint64 public constant FAUCET_CAP = 10_000e6;

    constructor(
        string memory name_,
        string memory symbol_,
        uint64 initialSupply
    ) ERC7984(name_, symbol_, "") Ownable(msg.sender) {
        _mint(msg.sender, FHE.asEuint64(initialSupply));
    }

    /// @notice Demo faucet: mints `amount` (plaintext, 6 decimals) to the caller.
    function faucet(uint64 amount) external {
        require(amount <= FAUCET_CAP, "faucet: amount exceeds cap");
        _mint(msg.sender, FHE.asEuint64(amount));
    }
}
