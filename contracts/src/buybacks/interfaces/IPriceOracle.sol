// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Price of 1 cTOKEN in cUSDT, 2-decimal fixed point (200 = 2.00 cUSDT).
interface IPriceOracle {
    function price() external view returns (uint64);
}
