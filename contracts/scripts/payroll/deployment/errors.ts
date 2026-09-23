const SAFE_MESSAGES = [
  "EXPECTED_DEPLOYER_ADDRESS is required for a Sepolia payroll deployment.",
  "Payroll deployment requires Sepolia chain ID 11155111.",
  "Payroll deployment records are exported only for Sepolia.",
];

export function safeCommandError(error: unknown): string {
  if (error instanceof Error && SAFE_MESSAGES.includes(error.message)) return error.message;
  return "Payroll deployment command failed. Review the local configuration and deployment state.";
}
