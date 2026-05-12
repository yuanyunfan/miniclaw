interface RepairReportResult {
  ok: boolean;
  dryRun: boolean;
  incident: {
    id: string;
    title: string;
  };
  policy: {
    blockers: readonly string[];
    warnings: readonly string[];
  };
  workspacePath: string;
  branch: string;
  baseSha?: string;
  commitSha?: string;
  pushed?: boolean;
  pushTarget?: string;
  pushError?: string;
  changedFiles: readonly string[];
  verification: readonly {
    ok: boolean;
    command: string;
  }[];
  message: string;
}

export function formatDoctorRepairResult(result: RepairReportResult): string {
  return [
    `MiniClaw Doctor Repair: ${result.ok ? "ok" : "blocked"}`,
    "",
    `Incident: ${result.incident.id.slice(0, 8)} ${result.incident.title}`,
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    `Workspace: ${result.workspacePath}`,
    `Branch: ${result.branch}`,
    ...(result.baseSha ? [`Base SHA: ${result.baseSha}`] : []),
    ...(result.commitSha ? [`Commit SHA: ${result.commitSha}`] : []),
    ...(result.pushed ? [`Pushed: ${result.pushTarget ?? "yes"}`] : []),
    ...(result.pushError ? [`Push error: ${result.pushError}`] : []),
    `Message: ${result.message}`,
    "",
    "Policy:",
    result.policy.blockers.length ? result.policy.blockers.map((item) => `- blocker: ${item}`).join("\n") : "- allowed",
    ...result.policy.warnings.map((item) => `- warning: ${item}`),
    "",
    "Changed files:",
    ...(result.changedFiles.length ? result.changedFiles.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "Verification:",
    ...(result.verification.length
      ? result.verification.map((item) => `- ${item.ok ? "ok" : "failed"}: ${item.command}`)
      : ["- (not run)"]),
  ].join("\n");
}
