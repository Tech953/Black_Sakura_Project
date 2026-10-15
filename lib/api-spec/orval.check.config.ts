import path from "path";
import { createOrvalConfig } from "./orval.config";

const stagingRoot = process.env.API_CODEGEN_STAGING_ROOT;
if (!stagingRoot) {
  throw new Error(
    "API_CODEGEN_STAGING_ROOT must point to a temporary directory for staged code generation.",
  );
}

export default createOrvalConfig(path.resolve(stagingRoot));
