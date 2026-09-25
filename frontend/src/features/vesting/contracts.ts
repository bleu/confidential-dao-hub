import { formatUnits, parseAbi } from "viem";

export const VESTING_CHAIN_ID = 11155111;
export const VESTING_CONTRACT = "0xD75E947e4262627E8fbE009585206F461afFA4b1" as const;
export const VESTING_DEPLOYMENT_BLOCK = 11_766_387n;

export const VESTING_TOKENS = [
  {
    address: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f",
    symbol: "cTOKEN",
    decimals: 6,
  },
  {
    address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA",
    symbol: "cUSDT",
    decimals: 6,
  },
] as const;

export type VestingToken = (typeof VESTING_TOKENS)[number];

export function findVestingToken(address: string): VestingToken | undefined {
  return VESTING_TOKENS.find((token) => token.address.toLowerCase() === address.toLowerCase());
}

export function formatVestingTokenAmount(value: bigint, token: VestingToken): string {
  const [whole, fraction] = formatUnits(value, token.decimals).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} ${token.symbol}`;
}

export const vestingAbi = parseAbi([
  "struct Grant { address treasury; address recipient; address token; uint48 start; uint48 end; uint48 cliff; bool revocable; bool revoked; uint256 revokedAt; bytes32 refundEntitlement; bytes32 refunded; bytes32 allocation; bytes32 claimed; }",
  "event GrantCreated(uint256 indexed grantId, address indexed treasury, address indexed recipient, address token)",
  "function getGrant(uint256 grantId) view returns (Grant memory)",
  "function createGrant(address recipient, address token, uint48 start, uint48 end, uint48 cliff, bool revocable, bytes32 amount, bytes inputProof) returns (uint256 grantId)",
]);

export const tokenAbi = parseAbi([
  "function isOperator(address holder, address spender) view returns (bool)",
  "function setOperator(address operator, uint48 until)",
]);

export const VESTING_DECRYPTION_SCOPE = {
  chainId: VESTING_CHAIN_ID,
  contractAddresses: [VESTING_CONTRACT],
} as const;
