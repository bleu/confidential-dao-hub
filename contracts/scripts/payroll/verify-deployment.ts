import hre from "hardhat";

import { runVerifyCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { payrollDeployment } from "./deployment";

runVerifyCommand(hre, payrollDeployment).catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
