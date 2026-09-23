const SAFE_MESSAGES = [
  "EXPECTED_DEPLOYER_ADDRESS is required for a Sepolia deployment.",
  "Deployment requires Sepolia chain ID 11155111.",
  "Deployment records are exported only for Sepolia.",
];

export function safeCommandError(error: unknown): string {
  if (error instanceof Error && SAFE_MESSAGES.includes(error.message)) return error.message;
  return "Deployment command failed. Review the local configuration and deployment state.";
}
