import type { AgentProvider } from "../../config/types.js";
import type { AgentTaskRuntimeOverride } from "../../runtime/agent-runtime.js";

export interface AgentRunManagerRoleModelOverride extends AgentTaskRuntimeOverride {
  provider?: AgentProvider;
}

export interface AgentRunManagerModelEscalationConfig {
  enabled: boolean;
  roles: string[];
  override: AgentRunManagerRoleModelOverride;
  maxAttempts: number;
}

export interface AgentRunManagerModelRoutingConfig {
  enabled: boolean;
  defaults: AgentRunManagerRoleModelOverride;
  roles: Record<string, AgentRunManagerRoleModelOverride>;
  escalation: AgentRunManagerModelEscalationConfig;
}

export interface ResolvedManagedModelRoute {
  runtimeOverride?: AgentTaskRuntimeOverride;
  escalated: boolean;
}

function mergeOverrides(
  base: AgentRunManagerRoleModelOverride | undefined,
  next: AgentRunManagerRoleModelOverride | undefined,
): AgentRunManagerRoleModelOverride {
  return {
    ...(base ?? {}),
    ...(next ?? {}),
  };
}

function hasOverrideValue(value: AgentRunManagerRoleModelOverride): boolean {
  return Boolean(value.provider || value.model || value.reasoningEffort || value.maxTurns !== undefined || value.budgetUsd !== undefined);
}

export function canEscalateManagedRole(
  routing: AgentRunManagerModelRoutingConfig | undefined,
  role: string,
  attemptsUsed: number,
): boolean {
  if (!routing?.enabled || !routing.escalation.enabled) return false;
  if (!routing.escalation.roles.includes(role)) return false;
  return attemptsUsed < routing.escalation.maxAttempts;
}

export function resolveManagedModelRoute(
  routing: AgentRunManagerModelRoutingConfig | undefined,
  role: string,
  options: { escalated?: boolean } = {},
): ResolvedManagedModelRoute {
  if (!routing?.enabled) return { escalated: false };
  const roleRoute = mergeOverrides(routing.defaults, routing.roles[role]);
  const routed = options.escalated
    ? mergeOverrides(roleRoute, routing.escalation.override)
    : roleRoute;
  return {
    escalated: Boolean(options.escalated),
    ...(hasOverrideValue(routed) ? { runtimeOverride: routed } : {}),
  };
}
