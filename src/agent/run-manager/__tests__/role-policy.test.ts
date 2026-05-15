import { describe, expect, it } from "vitest";
import {
  allowedClaudeToolsForManagedPolicy,
  buildManagedRuntimeRolePolicy,
  evaluateManagedClaudeToolUse,
  isDangerousManagedShellCommand,
  isPathInsideWorkspace,
} from "../role-policy.js";

describe("managed runtime role policy", () => {
  it("maps read-only roles to Codex read-only sandbox and Claude read-only tools", () => {
    const policy = buildManagedRuntimeRolePolicy({
      role: "planner",
      toolPolicyId: "read-only",
      canWriteWorkspace: false,
    });

    expect(policy).toMatchObject({
      toolPolicyId: "read-only",
      canWriteWorkspace: false,
      codex: { sandboxMode: "read-only", approvalPolicy: "never" },
      claude: { permissionMode: "dontAsk" },
    });
    expect(allowedClaudeToolsForManagedPolicy(policy)).toEqual(expect.arrayContaining(["Read", "Glob"]));
    expect(allowedClaudeToolsForManagedPolicy(policy)).not.toEqual(expect.arrayContaining(["Write", "Edit", "Bash", "Agent"]));
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Write",
      toolInput: { file_path: "/tmp/workspace/file.txt" },
    })).toMatchObject({ behavior: "deny" });
  });

  it("allows generator workspace writes inside cwd and denies writes outside cwd", () => {
    const policy = buildManagedRuntimeRolePolicy({
      role: "generator",
      toolPolicyId: "workspace-write",
      canWriteWorkspace: true,
    });

    expect(policy).toMatchObject({
      canWriteWorkspace: true,
      codex: { sandboxMode: "workspace-write", approvalPolicy: "never" },
      claude: { permissionMode: "acceptEdits" },
    });
    expect(allowedClaudeToolsForManagedPolicy(policy)).toEqual(expect.arrayContaining(["Write", "Edit", "Bash"]));
    expect(isPathInsideWorkspace("src/index.ts", "/tmp/workspace")).toBe(true);
    expect(isPathInsideWorkspace("../outside.ts", "/tmp/workspace")).toBe(false);
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Write",
      toolInput: { file_path: "/tmp/workspace/src/index.ts" },
    })).toMatchObject({ behavior: "allow" });
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Edit",
      toolInput: { file_path: "/tmp/outside.ts" },
    })).toMatchObject({ behavior: "deny" });
  });

  it("denies dangerous shell commands and native subagent tools at the managed boundary", () => {
    const policy = buildManagedRuntimeRolePolicy({
      role: "generator",
      toolPolicyId: "workspace-write",
      canWriteWorkspace: true,
    });

    expect(isDangerousManagedShellCommand("sudo rm -rf /")).toBe(true);
    expect(isDangerousManagedShellCommand("git status --short")).toBe(false);
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Bash",
      toolInput: { command: "git reset --hard HEAD" },
    })).toMatchObject({ behavior: "deny" });
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Bash",
      toolInput: { command: "git status --short" },
    })).toMatchObject({ behavior: "allow" });
    expect(evaluateManagedClaudeToolUse({
      policy,
      cwd: "/tmp/workspace",
      toolName: "Agent",
      toolInput: { subagent_type: "general" },
    })).toMatchObject({ behavior: "deny" });
  });
});
