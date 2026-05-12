import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IncidentRow } from "../../store/incidents.js";
import { evaluateRepairPolicy } from "../doctor-repair/policy.js";
import { parseChangedFiles, validateChangedPaths } from "../doctor-repair/path-policy.js";
import { buildRepairPrompt } from "../doctor-repair/prompt.js";
import { formatDoctorRepairResult } from "../doctor-repair/report.js";
import { repairVerificationCommands, runVerification } from "../doctor-repair/verification.js";
import {
  buildRepairCommitMessage,
  commitVerifiedRepair,
  prepareRepairWorktree,
  pushRepairBranch,
  repairBranch,
  repairWorkspacePath,
  sanitizeRepairId,
} from "../doctor-repair/worktree.js";

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "incident-123456",
    dedupe_key: "task:task-1:failed",
    type: "task_failed",
    severity: "warning",
    status: "diagnosed",
    title: "Task failed: task-1",
    summary: "TypeError in MiniClaw routing",
    subject_id: "task-1",
    subject_type: "task",
    source_json: JSON.stringify({ task_id: "task-1" }),
    evidence_json: JSON.stringify({ logs: ["TypeError: boom"] }),
    diagnosis_json: JSON.stringify({
      incidentType: "task_failed",
      category: "miniclaw_bug",
      repairAllowed: true,
      recommendedAction: "Patch the MiniClaw bug.",
    }),
    created_at: "2026-05-10T01:00:00.000Z",
    updated_at: "2026-05-10T01:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

describe("doctor repair policy boundary", () => {
  it("keeps eligibility gates independent from runtime config loading", () => {
    const blocked = evaluateRepairPolicy(
      incident({
        status: "resolved",
        type: "connectivity_failed",
        diagnosis_json: JSON.stringify({ category: "provider_auth", repairAllowed: false }),
      }),
      { execute: true, force: false, autoRepairEnabled: false },
    );

    expect(blocked).toMatchObject({
      allowed: false,
      blockers: [
        "incident status is resolved",
        "diagnosis does not allow repair",
        "category provider_auth is not auto-repairable",
        "incident type connectivity_failed is not repairable by policy",
        "doctor.auto_repair_enabled is false",
      ],
      warnings: [],
    });
  });

  it("lets force bypass repairAllowed/type/config gates while preserving category blockers", () => {
    const result = evaluateRepairPolicy(
      incident({
        type: "connectivity_failed",
        diagnosis_json: JSON.stringify({ category: "provider_auth", repairAllowed: false }),
      }),
      { execute: true, force: true, autoRepairEnabled: false },
    );

    expect(result.allowed).toBe(false);
    expect(result.blockers).toEqual(["category provider_auth is not auto-repairable"]);
    expect(result.warnings).toEqual(["--force bypasses repairAllowed/type/config gates but not path verification"]);
  });
});

describe("doctor repair path policy boundary", () => {
  const pathPolicy = {
    allowedPaths: ["src/**/*.ts", "docs/**/*.md", "config.example.yaml"],
    blockedPaths: [".env", ".env.*", "**/*.db", "**/*.sqlite", "**/*.log"],
  };

  it("parses git porcelain changes including renames", () => {
    expect(parseChangedFiles([
      " M src/ops/doctor.ts",
      "R  src/old.ts -> src/new.ts",
      "?? docs/plans/fix.md",
    ].join("\n"))).toEqual([
      "src/ops/doctor.ts",
      "src/new.ts",
      "docs/plans/fix.md",
    ]);
  });

  it("validates allowed and blocked globs without config coupling", () => {
    expect(validateChangedPaths(["src/fix.ts", "docs/auto-doctor.md", "config.example.yaml"], pathPolicy)).toEqual([]);
    expect(validateChangedPaths(["data.db", "logs/miniclaw.log", "README.md"], pathPolicy)).toEqual([
      "data.db: blocked path",
      "logs/miniclaw.log: blocked path",
      "README.md: not in allowed_paths",
    ]);
  });
});

describe("doctor repair prompt boundary", () => {
  it("renders stable incident context and path policy instructions", () => {
    const prompt = buildRepairPrompt(incident(), {
      allowedPaths: ["src/**/*.ts", "docs/**/*.md"],
      blockedPaths: [".env", "**/*.db"],
    });

    expect(prompt).toMatchInlineSnapshot(`
      "You are MiniClaw Self-Repair Worker.

      Goal: produce the smallest safe code fix for the incident below in this isolated worktree.

      Rules:
      - Do not edit secrets, credentials, cookies, sessions, runtime DBs, logs, or user config.
      - Keep changes within the configured allowed paths.
      - Add or update focused tests when the bug is testable.
      - Run targeted verification and report exact commands.
      - Do not restart MiniClaw, push to main, force-push, or modify the original worktree.

      Incident:
      {
        "id": "incident-123456",
        "type": "task_failed",
        "severity": "warning",
        "status": "diagnosed",
        "title": "Task failed: task-1",
        "summary": "TypeError in MiniClaw routing",
        "subject_id": "task-1",
        "subject_type": "task",
        "source": {
          "task_id": "task-1"
        },
        "evidence": {
          "logs": [
            "TypeError: boom"
          ]
        },
        "diagnosis": {
          "incidentType": "task_failed",
          "category": "miniclaw_bug",
          "repairAllowed": true,
          "recommendedAction": "Patch the MiniClaw bug."
        }
      }

      Allowed paths:
      - src/**/*.ts
      - docs/**/*.md

      Blocked paths:
      - .env
      - **/*.db"
    `);
  });
});

describe("doctor repair verification boundary", () => {
  it("selects targeted tests and standard gates from changed paths", () => {
    expect(repairVerificationCommands(["src/routing/intent.ts"]).map(([cmd, args]) => [cmd, args.join(" ")])).toEqual([
      ["pnpm", "run quality:g0"],
      ["pnpm", "run quality:secrets"],
      ["pnpm", "exec vitest run src/routing/__tests__"],
      ["pnpm", "run typecheck"],
      ["pnpm", "run lint"],
      ["pnpm", "test"],
      ["pnpm", "run build"],
    ]);
  });

  it("stops verification after the first failed command and preserves truncated output", () => {
    const run = vi.fn((cmd: string, args: string[]) => {
      const label = [cmd, ...args].join(" ");
      if (label === "pnpm run typecheck") throw new Error("x".repeat(5000));
      return `${label} ok`;
    });

    const results = runVerification("/repo", ["docs/features/13-auto-doctor.md"], run);

    expect(results.map((item) => [item.command, item.ok])).toEqual([
      ["pnpm run quality:g0", true],
      ["pnpm run quality:secrets", true],
      ["pnpm run typecheck", false],
    ]);
    expect(results.at(-1)?.output).toHaveLength(4000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("doctor repair worktree boundary", () => {
  it("derives stable sanitized worktree paths and branch names", () => {
    expect(sanitizeRepairId("incident:abc/def")).toBe("incident-abc-def");
    expect(repairWorkspacePath("/tmp/repairs", "incident:abc/def")).toBe(join("/tmp/repairs", "incident-abc-def"));
    expect(repairBranch("incident:abc/def")).toBe("doctor-repair/incident-abc-def");
  });

  it("creates missing worktrees and validates existing ones before reuse", () => {
    const root = mkdtempSync(join(tmpdir(), "miniclaw-repair-boundary-"));
    const workspace = join(root, "incident-1");
    const run = vi.fn(() => "");

    try {
      prepareRepairWorktree(workspace, "doctor-repair/incident-1", root, run, "/source");
      expect(run).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "-B", "doctor-repair/incident-1", workspace, "HEAD"],
        "/source",
      );

      run.mockClear();
      mkdirSync(workspace);
      prepareRepairWorktree(workspace, "doctor-repair/incident-1", root, run, "/source");
      expect(run).toHaveBeenCalledWith("git", ["status", "--short"], workspace);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds repair commit metadata and pushes only the isolated branch ref", () => {
    const row = incident();
    const run = vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git" && args.join(" ") === "diff --cached --name-only") return "src/fix.ts\n";
      if (cmd === "git" && args.join(" ") === "rev-parse HEAD") return "commit-sha\n";
      return "";
    });

    expect(buildRepairCommitMessage(row)).toMatchObject({
      title: "fix: repair MiniClaw incident incident",
      body: expect.stringContaining("Co-authored-by: Codex <codex@openai.com>"),
    });
    expect(commitVerifiedRepair(row, ["src/fix.ts"], "/repo", { authorName: "yuanyunfan", authorEmail: "me@example.test" }, run)).toBe("commit-sha");
    expect(pushRepairBranch("doctor-repair/incident-123456", "/repo", run)).toBe("origin/doctor-repair/incident-123456");
    expect(run).toHaveBeenCalledWith("git", ["config", "user.name", "yuanyunfan"], "/repo");
    expect(run).toHaveBeenCalledWith("git", ["add", "--", "src/fix.ts"], "/repo");
    expect(run).toHaveBeenCalledWith("git", ["push", "origin", "HEAD:refs/heads/doctor-repair/incident-123456"], "/repo");
  });
});

describe("doctor repair report boundary", () => {
  it("formats dry-run, policy, changed-file, and verification sections", () => {
    const text = formatDoctorRepairResult({
      ok: false,
      dryRun: false,
      incident: { id: "incident-123456", title: "Task failed: task-1" },
      policy: { blockers: ["blocked"], warnings: ["review manually"] },
      workspacePath: "/repo/repairs/incident-123456",
      branch: "doctor-repair/incident-123456",
      baseSha: "base-sha",
      pushError: "permission denied",
      changedFiles: ["src/fix.ts"],
      verification: [
        { ok: true, command: "pnpm run typecheck" },
        { ok: false, command: "pnpm run lint" },
      ],
      message: "repair branch push failed: permission denied",
    });

    expect(text).toContain("MiniClaw Doctor Repair: blocked");
    expect(text).toContain("Incident: incident Task failed: task-1");
    expect(text).toContain("- blocker: blocked");
    expect(text).toContain("- warning: review manually");
    expect(text).toContain("- src/fix.ts");
    expect(text).toContain("- failed: pnpm run lint");
  });
});
