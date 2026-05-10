import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCmbCreditCardEmailConfig } from "../config.js";

let tmp = "";

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = "";
  delete process.env.MINICLAW_CMB_CREDIT_CARD_EMAIL_CONFIG_DIR;
});

describe("cmb-credit-card-email config", () => {
  it("loads skip_when_no_new_transactions with a false default", () => {
    tmp = mkdtempSync(join(tmpdir(), "miniclaw-cmb-config-"));
    process.env.MINICLAW_CMB_CREDIT_CARD_EMAIL_CONFIG_DIR = tmp;
    writeFileSync(join(tmp, "default.yaml"), "email_profile: cmb\n");

    expect(loadCmbCreditCardEmailConfig().skip_when_no_new_transactions).toBe(false);

    writeFileSync(join(tmp, "polling.yaml"), [
      "email_profile: cmb",
      "skip_when_no_new_transactions: true",
      "",
    ].join("\n"));
    expect(loadCmbCreditCardEmailConfig("polling").skip_when_no_new_transactions).toBe(true);
  });
});
