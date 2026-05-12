import { parseDoctorArgs } from "./doctor/args.js";
import { diagnoseDoctorEvidence } from "./doctor/diagnosis.js";
import { collectDoctorEvidence } from "./doctor/evidence.js";
import { formatDoctorReport } from "./doctor/report.js";
import { redactSensitive } from "./doctor/redaction.js";
import type { DoctorArgs, DoctorReport, RunDoctorOptions } from "./doctor/types.js";

export type {
  CommandRunner,
  DoctorArgs,
  DoctorCategory,
  DoctorConnectivityState,
  DoctorCronJobState,
  DoctorDiagnosis,
  DoctorEvidence,
  DoctorGitState,
  DoctorIncidentType,
  DoctorLogEvidence,
  DoctorMode,
  DoctorPm2State,
  DoctorReport,
  DoctorSeverity,
  DoctorTaskEventRow,
  DoctorTaskRow,
  RunDoctorOptions,
} from "./doctor/types.js";
export { parseDoctorArgs, formatDoctorReport, redactSensitive };

export async function runDoctor(args: DoctorArgs, options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const evidence = collectDoctorEvidence(args, options);
  return { evidence, diagnosis: diagnoseDoctorEvidence(evidence) };
}
