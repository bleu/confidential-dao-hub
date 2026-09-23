import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { artifacts } from "hardhat";

async function main() {
  const { abi } = await artifacts.readArtifact("ConfidentialVesting");
  const output = path.resolve(__dirname, "../../abi/vesting/ConfidentialVesting.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(abi, null, 2)}\n`);
  console.log(`Vesting ABI: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
