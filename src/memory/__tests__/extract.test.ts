import { describe, expect, it } from "vitest";
import { __testables } from "../extract.js";

describe("memory extraction schema", () => {
  it("marks every Codex output object property as required", () => {
    const schema = __testables.codexExtractSchema();
    const itemSchema = schema.properties.items.items;

    expect(itemSchema.required).toEqual(Object.keys(itemSchema.properties));
  });
});
