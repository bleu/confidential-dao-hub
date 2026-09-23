import hre from "hardhat";

import { runPreflightCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { vestingDeployment } from "./deployment";

runPreflightCommand(hre, vestingDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
