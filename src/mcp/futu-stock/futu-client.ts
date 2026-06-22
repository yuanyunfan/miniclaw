import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { assertSafeOpendHost, sanitizeError } from "./safety.js";
import type {
  FutuHealthCheck,
  FutuRawBrokerData,
  FutuStockClient,
  FutuStockProfileConfig,
  FutuWatchlistGroupError,
  FutuWatchlistResult,
  FutuWatchlistSecurity,
} from "./types.js";

const PYTHON_TIMEOUT_MS = 45_000;
const FUTU_WATCHLIST_TIMEOUT_MS = 120_000;

const FUTU_QUERY_BRIDGE = String.raw`
import json
import sys
from datetime import datetime, timezone

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))

def fail(message):
    emit({"ok": False, "error": str(message)})
    sys.exit(0)

try:
    req = json.loads(sys.stdin.read() or "{}")
except Exception as exc:
    fail(f"invalid request json: {exc}")

try:
    try:
        from futu import *  # noqa: F403
    except Exception:
        from moomoo import *  # noqa: F403
except Exception as exc:
    fail(f"Python package futu-api/moomoo is not installed or not importable: {exc}")

profile = req.get("profile", {})
host = profile.get("opend_host", "127.0.0.1")
port = int(profile.get("opend_port", 11111))
trd_market_name = profile.get("trd_market", "HK")
security_firm_name = profile.get("security_firm", "FUTUSECURITIES")
currency_name = profile.get("currency", "HKD")
acc_index = int(profile.get("acc_index", 0))
acc_id = profile.get("acc_id")

try:
    trd_market = getattr(TrdMarket, trd_market_name)
    security_firm = getattr(SecurityFirm, security_firm_name)
    currency = getattr(Currency, currency_name, Currency.HKD)
except Exception as exc:
    fail(f"invalid enum value: {exc}")

def df_to_records(data):
    if data is None:
        return []
    if hasattr(data, "to_json"):
        return json.loads(data.to_json(orient="records", force_ascii=False))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return [{"value": str(data)}]

ctx = None
try:
    ctx = OpenSecTradeContext(filter_trdmarket=trd_market, host=host, port=port, security_firm=security_firm)
    account_kwargs = {
        "trd_env": TrdEnv.REAL,
        "acc_index": acc_index,
        "refresh_cache": True,
    }
    if acc_id:
        account_kwargs["acc_id"] = int(acc_id)

    ret, funds = ctx.accinfo_query(currency=currency, **account_kwargs)
    if ret != RET_OK:
        fail(f"accinfo_query failed: {funds}")

    ret, positions = ctx.position_list_query(**account_kwargs)
    if ret != RET_OK:
        fail(f"position_list_query failed: {positions}")

    deals = []
    try:
        ret, deal_data = ctx.deal_list_query(**account_kwargs)
        if ret == RET_OK:
            deals = df_to_records(deal_data)
    except Exception:
        deals = []

    fund_records = df_to_records(funds)
    emit({
        "ok": True,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "account": fund_records[0] if fund_records else {},
        "positions": df_to_records(positions),
        "deals": deals,
        "cash_flows": [],
    })
except Exception as exc:
    fail(exc)
finally:
    try:
        if ctx is not None:
            ctx.close()
    except Exception:
        pass
`;

const FUTU_IMPORT_CHECK = "import importlib.util, json; print(json.dumps({'ok': bool(importlib.util.find_spec('futu') or importlib.util.find_spec('moomoo'))}))";

const FUTU_WATCHLIST_BRIDGE = String.raw`
import json
import sys
import time
from datetime import datetime, timezone

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))

def fail(message):
    emit({"ok": False, "error": str(message)})
    sys.exit(0)

try:
    req = json.loads(sys.stdin.read() or "{}")
except Exception as exc:
    fail(f"invalid request json: {exc}")

try:
    try:
        from futu import *  # noqa: F403
    except Exception:
        from moomoo import *  # noqa: F403
except Exception as exc:
    fail(f"Python package futu-api/moomoo is not installed or not importable: {exc}")

profile = req.get("profile", {})
host = profile.get("opend_host", "127.0.0.1")
port = int(profile.get("opend_port", 11111))
selected_groups = [str(g).strip() for g in req.get("groups", []) if str(g).strip()]
limit = int(req.get("limit", 200))
group_interval_seconds = float(req.get("group_interval_seconds", 0) or 0)

def is_rate_limited(message):
    text = str(message).lower()
    return (
        "频率太高" in text
        or "rate limit" in text
        or "rate-limited" in text
        or "too many" in text
        or "too frequent" in text
        or "high frequency" in text
        or ("maximum" in text and " per " in text and "second" in text)
    )

def df_to_records(data):
    if data is None:
        return []
    if hasattr(data, "to_json"):
        return json.loads(data.to_json(orient="records", force_ascii=False))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return [{"value": str(data)}]

def group_name(row):
    for key in ("group_name", "name", "group", "gname"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""

ctx = None
try:
    ctx = OpenQuoteContext(host=host, port=port)
    ret, groups_data = ctx.get_user_security_group()
    if ret != RET_OK:
        fail(f"get_user_security_group failed: {groups_data}")
    groups = [group_name(row) for row in df_to_records(groups_data)]
    groups = [g for g in groups if g]
    if selected_groups:
        groups = [g for g in groups if g in selected_groups]
    if group_interval_seconds <= 0 and len(groups) > 10:
        group_interval_seconds = 3.2

    securities = []
    group_errors = []
    last_group_request_at = None
    for group in groups:
        if last_group_request_at is not None and group_interval_seconds > 0:
            elapsed = time.monotonic() - last_group_request_at
            if elapsed < group_interval_seconds:
                time.sleep(group_interval_seconds - elapsed)
        last_group_request_at = time.monotonic()
        ret, security_data = ctx.get_user_security(group)
        if ret != RET_OK:
            error = str(security_data)
            rate_limited = is_rate_limited(error)
            group_errors.append({
                "group_name": group,
                "error": error,
                "rate_limited": rate_limited,
            })
            if rate_limited:
                break
            continue
        for row in df_to_records(security_data):
            code = str(row.get("code") or "").strip()
            if not code:
                continue
            securities.append({
                "group_name": group,
                "code": code,
                "name": row.get("name"),
                "stock_type": row.get("stock_type"),
                "stock_child_type": row.get("stock_child_type"),
            })
            if len(securities) >= limit:
                break
        if len(securities) >= limit:
            break

    emit({
        "ok": True,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "group_count": len(groups),
        "securities": securities,
        "group_errors": group_errors,
        "rate_limited": any(item.get("rate_limited") for item in group_errors),
    })
except Exception as exc:
    fail(exc)
finally:
    try:
        if ctx is not None:
            ctx.close()
    except Exception:
        pass
`;

export function parseLastJsonPayload<T = unknown>(stdout: string): T {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Futu SDK logs may include braces in non-payload lines; keep scanning.
    }
  }
  throw new Error(`futu python bridge did not emit JSON payload: ${sanitizeError(stdout.slice(-800))}`);
}

function runPython(
  pythonBin: string,
  args: string[],
  stdin: string,
  timeoutMs = PYTHON_TIMEOUT_MS,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin);
  });
}

function checkTcp(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "OpenD connection timed out"));
    socket.once("error", (err) => finish(false, sanitizeError(err)));
    socket.connect(port, host);
  });
}

async function checkPython(profile: FutuStockProfileConfig): Promise<FutuHealthCheck["python"]> {
  try {
    const result = await runPython(profile.python_bin, ["-c", FUTU_IMPORT_CHECK], "", 5000);
    if (result.code !== 0) {
      return { ok: false, bin: profile.python_bin, futu_api_available: false, error: sanitizeError(result.stderr || result.stdout) };
    }
    const parsed = parseLastJsonPayload<{ ok?: boolean }>(result.stdout);
    return { ok: Boolean(parsed.ok), bin: profile.python_bin, futu_api_available: Boolean(parsed.ok) };
  } catch (err) {
    return { ok: false, bin: profile.python_bin, futu_api_available: false, error: sanitizeError(err) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseWatchlistSecurity(item: Record<string, unknown>): FutuWatchlistSecurity {
  return {
    group_name: typeof item.group_name === "string" ? item.group_name : "",
    code: typeof item.code === "string" ? item.code : "",
    name: typeof item.name === "string" ? item.name : undefined,
    stock_type: typeof item.stock_type === "string" ? item.stock_type : undefined,
    stock_child_type: typeof item.stock_child_type === "string" ? item.stock_child_type : undefined,
  };
}

function looksRateLimited(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("频率太高") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limited") ||
    lower.includes("too many") ||
    lower.includes("too frequent") ||
    lower.includes("high frequency") ||
    (lower.includes("maximum") && lower.includes(" per ") && lower.includes("second"));
}

function parseWatchlistGroupError(item: Record<string, unknown>): FutuWatchlistGroupError {
  const error = typeof item.error === "string" ? sanitizeError(item.error) : "";
  return {
    group_name: typeof item.group_name === "string" ? item.group_name : "",
    error,
    rate_limited: typeof item.rate_limited === "boolean" ? item.rate_limited : looksRateLimited(error),
  };
}

export class PythonFutuStockClient implements FutuStockClient {
  async healthCheck(profile: FutuStockProfileConfig): Promise<FutuHealthCheck> {
    try {
      assertSafeOpendHost(profile);
    } catch (err) {
      return {
        ok: false,
        opend: { ok: false, host: profile.opend_host, port: profile.opend_port, error: sanitizeError(err) },
        python: { ok: false, bin: profile.python_bin, futu_api_available: false },
      };
    }
    const [opend, python] = await Promise.all([
      checkTcp(profile.opend_host, profile.opend_port),
      checkPython(profile),
    ]);
    return {
      ok: opend.ok && python.ok,
      opend: { ok: opend.ok, host: profile.opend_host, port: profile.opend_port, error: opend.error },
      python,
    };
  }

  async getRawBrokerData(profile: FutuStockProfileConfig): Promise<FutuRawBrokerData> {
    assertSafeOpendHost(profile);
    const payload = JSON.stringify({ profile });
    const result = await runPython(profile.python_bin, ["-c", FUTU_QUERY_BRIDGE], payload);
    if (result.timedOut) throw new Error(`futu python bridge timed out after ${PYTHON_TIMEOUT_MS}ms: ${sanitizeError(result.stderr || result.stdout)}`);
    if (result.code !== 0) throw new Error(`futu python bridge exited with ${result.code ?? result.signal}: ${sanitizeError(result.stderr || result.stdout)}`);
    const parsed = parseLastJsonPayload<{ ok?: boolean; error?: string } & FutuRawBrokerData>(result.stdout);
    if (!parsed.ok) throw new Error(sanitizeError(parsed.error ?? "futu python bridge failed"));
    return {
      captured_at: parsed.captured_at,
      account: parsed.account ?? {},
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      deals: Array.isArray(parsed.deals) ? parsed.deals : [],
      cash_flows: Array.isArray(parsed.cash_flows) ? parsed.cash_flows : [],
    };
  }
}

export async function getFutuWatchlistSecurities(
  profile: FutuStockProfileConfig,
  options: { groups?: string[]; limit?: number } = {},
): Promise<FutuWatchlistSecurity[]> {
  return (await getFutuWatchlistSecuritiesResult(profile, options)).securities;
}

export async function getFutuWatchlistSecuritiesResult(
  profile: FutuStockProfileConfig,
  options: { groups?: string[]; limit?: number } = {},
): Promise<FutuWatchlistResult> {
  assertSafeOpendHost(profile);
  const payload = JSON.stringify({
    profile,
    groups: options.groups ?? [],
    limit: options.limit ?? 200,
  });
  const result = await runPython(profile.python_bin, ["-c", FUTU_WATCHLIST_BRIDGE], payload, FUTU_WATCHLIST_TIMEOUT_MS);
  if (result.timedOut) throw new Error(`futu watchlist bridge timed out after ${FUTU_WATCHLIST_TIMEOUT_MS}ms: ${sanitizeError(result.stderr || result.stdout)}`);
  if (result.code !== 0) throw new Error(`futu watchlist bridge exited with ${result.code ?? result.signal}: ${sanitizeError(result.stderr || result.stdout)}`);
  const parsed = parseLastJsonPayload<{
    ok?: boolean;
    error?: string;
    captured_at?: string;
    group_count?: number;
    securities?: unknown[];
    group_errors?: unknown[];
    rate_limited?: boolean;
  }>(result.stdout);
  if (!parsed.ok) throw new Error(sanitizeError(parsed.error ?? "futu watchlist bridge failed"));
  const groupErrors = (Array.isArray(parsed.group_errors) ? parsed.group_errors : [])
    .filter(isRecord)
    .map(parseWatchlistGroupError);
  const securities = (Array.isArray(parsed.securities) ? parsed.securities : [])
    .filter(isRecord)
    .map(parseWatchlistSecurity)
    .filter((item) => item.code);
  return {
    captured_at: typeof parsed.captured_at === "string" ? parsed.captured_at : new Date().toISOString(),
    group_count: typeof parsed.group_count === "number" && Number.isFinite(parsed.group_count) ? parsed.group_count : 0,
    securities,
    group_errors: groupErrors,
    rate_limited: Boolean(parsed.rate_limited) || groupErrors.some((item) => item.rate_limited),
  };
}

export const __testables = {
  looksRateLimited,
};
