import type { ConfigReader } from "../env.js";
import { modelClientValues } from "../schema.js";
import type { ModelClientId } from "../types.js";

export function buildModelRuntimeConfig(reader: ConfigReader) {
  return {
    modelClient: {
      defaultClient: reader.oneOf<ModelClientId>(
        [["model", "default_client"], ["model", "defaultClient"]],
        "MINICLAW_MODEL_DEFAULT_CLIENT",
        "auto",
        modelClientValues
      ),
    },
  } as const;
}
