// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPriceOracle} from "../buybacks/interfaces/IPriceOracle.sol";

/// @title MockPriceOracle
/// @notice PoC stand-in for a real price feed (Chainlink/TWAP adapter would
///         implement IPriceOracle). Owner-settable so demos can move the market.
contract MockPriceOracle is IPriceOracle, Ownable {
    uint64 public price;

    event PriceSet(uint64 price);

    constructor(uint64 initialPrice) Ownable(msg.sender) {
        price = initialPrice;
        emit PriceSet(initialPrice);
    }

    function setPrice(uint64 newPrice) external onlyOwner {
        price = newPrice;
        emit PriceSet(newPrice);
    }
}
