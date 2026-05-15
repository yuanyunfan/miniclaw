import { migration001ProgressMessageId } from "./001-progress-message-id.js";
import { migration002SmartRouterDecisions } from "./002-smart-router-decisions.js";
import { migration003TaskSourceContext } from "./003-task-source-context.js";
import { migration004DoctorIncidents } from "./004-doctor-incidents.js";
import { migration005RouterCapabilities } from "./005-router-capabilities.js";
import { migration006TaskEvents } from "./006-task-events.js";
import { migration007MarketForecasts } from "./007-market-forecasts.js";
import { migration008RouterClassifierFields } from "./008-router-classifier-fields.js";
import { migration009RouterEvaluationFields } from "./009-router-evaluation-fields.js";
import { migration010SchemaVersionHistory } from "./010-schema-version-history.js";
import { migration011CronRuns } from "./011-cron-runs.js";
import { migration012RecoveryOutbox } from "./012-recovery-outbox.js";
import { migration013AgentRunManager } from "./013-agent-run-manager.js";
import type { SchemaMigration } from "./types.js";

export const migrations: SchemaMigration[] = [
  migration001ProgressMessageId,
  migration002SmartRouterDecisions,
  migration003TaskSourceContext,
  migration004DoctorIncidents,
  migration005RouterCapabilities,
  migration006TaskEvents,
  migration007MarketForecasts,
  migration008RouterClassifierFields,
  migration009RouterEvaluationFields,
  migration010SchemaVersionHistory,
  migration011CronRuns,
  migration012RecoveryOutbox,
  migration013AgentRunManager,
];
