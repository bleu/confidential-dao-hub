import hre from "hardhat";

import { runVerifyCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { vestingDeployment } from "./deployment";

runVerifyCommand(hre, vestingDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
