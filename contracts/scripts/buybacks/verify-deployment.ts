import hre from "hardhat";

import { runVerifyCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { buybacksDeployment } from "./deployment";

runVerifyCommand(hre, buybacksDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
