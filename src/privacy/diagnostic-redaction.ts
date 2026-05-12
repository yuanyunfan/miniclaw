import { createHash } from "node:crypto";

export type DiagnosticJsonValue =
  | string
  | number
  | boolean
  | null
  | DiagnosticJsonValue[]
  | { [key: string]: DiagnosticJsonValue };

export interface DiagnosticRedactionOptions {
  maxChars?: number;
  maxDepth?: number;
  maxArrayItems?: number;
}

export const DEFAULT_DIAGNOSTIC_TEXT_CHARS = 500;
export const DIAGNOSTIC_REDACTION_POLICY =
  "shared diagnostic redaction; raw prompts/provider payloads/email bodies/cookies/tokens omitted or redacted; session/account identifiers hashed";

const AUTHORIZATION_PATTERN = /\b(authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_PATTERN = /\b((?:set-)?cookie\s*[:=]\s*)[^\s,;]+(?:;[^\s,;]+)*/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|pwd|session[_-]?id|session|account(?:[_-]?(?:id|number))?|acct|card(?:[_-]?number)?|customer(?:[_-]?id)?|validatekey|em_validatekey)\b(\s*[:=]\s*)(["']?)[^\s"',;]+["']?/gi;
const BODY_ASSIGNMENT_PATTERN =
  /\b(email[_ -]?body|raw[_ -]?email|message[_ -]?body|full[_ -]?prompt|prompt|provider[_ -]?payload|raw[_ -]?payload|raw[_ -]?response)\b(\s*[:=]\s*)(["']?)[^"']{8,}/gi;
const STANDALONE_BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})\b/g;
const PROVIDER_SESSION_PATTERN = /\b(?:codex|claude):[A-Za-z0-9._~+/=-]{6,}\b/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;

const PROMPT_KEY_PATTERN = /(^|_)(full_)?prompt(_preview)?$|message_body|email_body|raw_email|body_html|html/i;
const PAYLOAD_KEY_PATTERN = /provider_payload|raw_payload|raw_response|raw_json|raw_text|headers?/i;
const CREDENTIAL_KEY_PATTERN = /authorization|cookie|token|secret|password|pwd|api_key|access_token|refresh_token|validatekey|em_validatekey/i;
const SESSION_KEY_PATTERN = /^(session|session_id|resume_session_id|provider_session_id|agent_session_id)$/i;
const ACCOUNT_KEY_PATTERN = /account|acct|customer|card_number|phone|email/i;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 3)}...`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashDiagnosticValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function fieldKind(key: string): "prompt" | "payload" | "credential" | "session" | "account" | undefined {
  if (PROMPT_KEY_PATTERN.test(key)) return "prompt";
  if (PAYLOAD_KEY_PATTERN.test(key)) return "payload";
  if (CREDENTIAL_KEY_PATTERN.test(key)) return "credential";
  if (SESSION_KEY_PATTERN.test(key)) return "session";
  if (ACCOUNT_KEY_PATTERN.test(key)) return "account";
  return undefined;
}

function redactedFieldValue(key: string, value: unknown): string {
  const kind = fieldKind(key) ?? "value";
  if ((kind === "session" || kind === "account") && value !== undefined && value !== null && String(value)) {
    return `[redacted-${kind}:${hashDiagnosticValue(String(value))}]`;
  }
  return `[redacted-${kind}]`;
}

export function isSensitiveDiagnosticKey(key: string): boolean {
  return fieldKind(key) !== undefined;
}

export function redactDiagnosticText(
  value: string,
  options: DiagnosticRedactionOptions = {}
): string {
  const maxChars = options.maxChars ?? DEFAULT_DIAGNOSTIC_TEXT_CHARS;
  const redacted = compactText(value)
    .replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(COOKIE_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, quote: string) => {
      const q = quote || "";
      return `${key}${separator}${q}[REDACTED]${q}`;
    })
    .replace(BODY_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, quote: string) => {
      const q = quote || "";
      return `${key}${separator}${q}[REDACTED]${q}`;
    })
    .replace(STANDALONE_BEARER_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(KNOWN_TOKEN_PATTERN, "[REDACTED]")
    .replace(PROVIDER_SESSION_PATTERN, (match: string) => `[redacted-session:${hashDiagnosticValue(match)}]`)
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]");
  return truncateText(redacted, maxChars);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactDiagnosticValue(
  key: string,
  value: unknown,
  options: DiagnosticRedactionOptions = {}
): DiagnosticJsonValue {
  const maxChars = options.maxChars ?? DEFAULT_DIAGNOSTIC_TEXT_CHARS;
  const maxDepth = options.maxDepth ?? 4;
  const maxArrayItems = options.maxArrayItems ?? 20;

  if (isSensitiveDiagnosticKey(key)) return redactedFieldValue(key, value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return "[undefined]";
  if (typeof value === "string") return redactDiagnosticText(value, { maxChars });
  if (maxDepth <= 0) return redactDiagnosticText(JSON.stringify(value), { maxChars });

  if (Array.isArray(value)) {
    const mapped = value
      .slice(0, maxArrayItems)
      .map((item, index) => redactDiagnosticValue(`${key}_${index}`, item, {
        maxChars,
        maxDepth: maxDepth - 1,
        maxArrayItems,
      }));
    if (value.length > maxArrayItems) mapped.push(`[${value.length - maxArrayItems} more item(s) omitted]`);
    return mapped;
  }

  if (isPlainObject(value)) {
    const out: Record<string, DiagnosticJsonValue> = {};
    for (const [innerKey, innerValue] of Object.entries(value)) {
      out[innerKey] = redactDiagnosticValue(innerKey, innerValue, {
        maxChars,
        maxDepth: maxDepth - 1,
        maxArrayItems,
      });
    }
    return out;
  }

  return redactDiagnosticText(String(value), { maxChars });
}

export function formatDiagnosticValue(
  value: unknown,
  options: DiagnosticRedactionOptions = {}
): string {
  const maxChars = options.maxChars ?? DEFAULT_DIAGNOSTIC_TEXT_CHARS;
  if (value === null || value === undefined || value === "") return "-";
  const redacted = redactDiagnosticValue("value", value, options);
  const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  return truncateText(text, maxChars);
}
