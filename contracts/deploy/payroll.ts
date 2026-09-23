import { createFeatureDeployment } from "../scripts/deployment/deploy";
import { payrollDeployment } from "../scripts/payroll/deployment";

export default createFeatureDeployment(payrollDeployment);
