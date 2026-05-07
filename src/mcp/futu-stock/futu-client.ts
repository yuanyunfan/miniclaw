import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { assertSafeOpendHost, sanitizeError } from "./safety.js";
import type { FutuHealthCheck, FutuRawBrokerData, FutuStockClient, FutuStockProfileConfig } from "./types.js";

const PYTHON_TIMEOUT_MS = 15_000;

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

function lastJsonLine(stdout: string): string {
  return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
}

function runPython(
  pythonBin: string,
  args: string[],
  stdin: string,
  timeoutMs = PYTHON_TIMEOUT_MS,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
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
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
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
    const parsed = JSON.parse(lastJsonLine(result.stdout)) as { ok?: boolean };
    return { ok: Boolean(parsed.ok), bin: profile.python_bin, futu_api_available: Boolean(parsed.ok) };
  } catch (err) {
    return { ok: false, bin: profile.python_bin, futu_api_available: false, error: sanitizeError(err) };
  }
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
    if (result.code !== 0) throw new Error(`futu python bridge exited with ${result.code}: ${sanitizeError(result.stderr)}`);
    const parsed = JSON.parse(lastJsonLine(result.stdout)) as { ok?: boolean; error?: string } & FutuRawBrokerData;
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
