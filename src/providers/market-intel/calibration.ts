import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

const CONFIG_PATH_DEFAULT = join(homedir(), ".miniclaw/providers/market-intel/calibration.yaml");

export interface MarketIntelScoringCalibrationRule {
  source: string;
  weight: number;
  confidence_cap?: number;
  samples: number;
  hit_rate?: number;
  avg_brier_score?: number;
  rationale: string;
}

export interface MarketIntelScoringCalibrationConfig {
  version: 1;
  generated_at: string;
  min_samples: number;
  source_weights: MarketIntelScoringCalibrationRule[];
  prompt_rules: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseRule(value: unknown): MarketIntelScoringCalibrationRule | undefined {
  if (!isRecord(value)) return undefined;
  const source = str(value.source);
  const weight = num(value.weight);
  const samples = num(value.samples);
  const rationale = str(value.rationale);
  if (!source || weight === undefined || samples === undefined || !rationale) return undefined;
  return {
    source,
    weight,
    confidence_cap: num(value.confidence_cap),
    samples,
    hit_rate: num(value.hit_rate),
    avg_brier_score: num(value.avg_brier_score),
    rationale,
  };
}

export function getMarketIntelScoringCalibrationConfigPath(): string {
  return process.env.MINICLAW_MARKET_INTEL_CALIBRATION_CONFIG ?? CONFIG_PATH_DEFAULT;
}

export function loadMarketIntelScoringCalibrationConfig(path = getMarketIntelScoringCalibrationConfigPath()): MarketIntelScoringCalibrationConfig | undefined {
  if (!existsSync(path)) return undefined;
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error(`market-intel calibration config must be a YAML object: ${path}`);
  const rules = Array.isArray(raw.source_weights)
    ? raw.source_weights.map(parseRule).filter((item): item is MarketIntelScoringCalibrationRule => Boolean(item))
    : [];
  const promptRules = Array.isArray(raw.prompt_rules)
    ? raw.prompt_rules.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    version: 1,
    generated_at: str(raw.generated_at) ?? new Date().toISOString(),
    min_samples: num(raw.min_samples) ?? 5,
    source_weights: rules,
    prompt_rules: promptRules,
  };
}

export function writeMarketIntelScoringCalibrationConfig(
  config: MarketIntelScoringCalibrationConfig,
  path = getMarketIntelScoringCalibrationConfigPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yamlDump(config, { lineWidth: 120, noRefs: true }), "utf8");
}

export function calibrationRuleForSource(
  calibration: MarketIntelScoringCalibrationConfig | undefined,
  source: string,
): MarketIntelScoringCalibrationRule | undefined {
  return calibration?.source_weights.find((rule) => rule.source === source);
}
