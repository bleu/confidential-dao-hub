import { parseAbi } from "viem";

export const PAYROLL_CHAIN_ID = 11155111;

export const PAYROLL_CONTRACTS = {
  multisend: "0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91",
  demoToken: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA",
} as const;

export const payrollMultisendAbi = parseAbi([
  "event Payment(address indexed sender, address indexed token, address indexed recipient, bytes32 requestedAmount, bytes32 actualAmount)",
  "function multisend(address token, address[] recipients, bytes32[] encryptedAmounts, bytes inputProof)",
]);

export const confidentialTokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function setOperator(address operator, uint48 until)",
]);

export function payrollDecryptionScope(tokenAddress: string) {
  return {
    chainId: PAYROLL_CHAIN_ID,
    contractAddresses: [PAYROLL_CONTRACTS.multisend, tokenAddress],
  } as const;
}
