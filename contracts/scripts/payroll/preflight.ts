import hre from "hardhat";

import { runPreflightCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { payrollDeployment } from "./deployment";

runPreflightCommand(hre, payrollDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
