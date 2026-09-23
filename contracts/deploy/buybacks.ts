import { createFeatureDeployment } from "../scripts/deployment/deploy";
import { buybacksDeployment } from "../scripts/buybacks/deployment";

export default createFeatureDeployment(buybacksDeployment);
