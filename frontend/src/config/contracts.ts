import { parseAbi } from "viem";

// Sepolia deployment (deployed 2026-07-06, deployer 0x5C1dB091655210fBdCa4C8787BC9e1BdECD07ad6)
export const CHAIN_ID = 11155111;

export const CONTRACTS = {
  cToken: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f",
  cUsdt: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA",
  vault: "0x84b187a0D9Dd071d18Fb89b5c68c320Ca14B96D4",
} as const;

// euint64 / externalEuint64 are bytes32 at the ABI level.
export const vaultAbi = parseAbi([
  "struct Epoch { bytes32 budget; bytes32 remaining; bytes32 totalFilled; uint64 price; uint64 openedAt; uint64 closedAt; bool open; bool disclosed; uint64 disclosedTotal; }",
  "function epochCount() view returns (uint256)",
  "function currentEpochId() view returns (uint256)",
  "function hasOpenEpoch() view returns (bool)",
  "function owner() view returns (address)",
  "function DISCLOSURE_DELAY() view returns (uint64)",
  "function getEpoch(uint256 epochId) view returns (Epoch memory)",
  "function getMyOffer(uint256 epochId) view returns (bytes32)",
  "function getMyFill(uint256 epochId) view returns (bytes32)",
  "function getPosition(uint256 epochId, address seller) view returns (bool submitted, bool claimed)",
  "function openEpoch(bytes32 budgetExt, bytes inputProof, uint64 price)",
  "function submitOffer(bytes32 amountExt, bytes inputProof)",
  "function closeEpoch()",
  "function claim(uint256 epochId)",
  "function requestDisclosure(uint256 epochId)",
  "function finalizeDisclosure(uint256 epochId, bytes cleartexts, bytes decryptionProof)",
]);

export const tokenAbi = parseAbi([
  "function faucet(uint64 amount)",
  "function FAUCET_CAP() view returns (uint64)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function symbol() view returns (string)",
]);
