import hre from "hardhat";

import { runPreflightCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { buybacksDeployment } from "./deployment";

runPreflightCommand(hre, buybacksDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
