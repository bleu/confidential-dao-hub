import { createFeatureDeployment } from "../scripts/deployment/deploy";
import { vestingDeployment } from "../scripts/vesting/deployment";

export default createFeatureDeployment(vestingDeployment);
