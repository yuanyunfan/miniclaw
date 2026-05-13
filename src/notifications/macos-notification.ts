import { execFile } from "node:child_process";

export interface MacosNotificationInput {
  title: string;
  body: string;
  subtitle?: string;
}

export interface MacosNotificationResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 512)}"`;
}

export function buildDisplayNotificationScript(input: MacosNotificationInput): string {
  const parts = [
    `display notification ${appleScriptString(input.body)}`,
    `with title ${appleScriptString(input.title)}`,
  ];
  if (input.subtitle) parts.push(`subtitle ${appleScriptString(input.subtitle)}`);
  return parts.join(" ");
}

export async function sendMacosNotification(input: MacosNotificationInput): Promise<MacosNotificationResult> {
  if (process.platform !== "darwin") {
    return { ok: false, skipped: true, error: "macOS notification is only available on darwin" };
  }
  const script = buildDisplayNotificationScript(input);
  return await new Promise<MacosNotificationResult>((resolve) => {
    execFile("osascript", ["-e", script], { timeout: 5000 }, (err) => {
      if (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      resolve({ ok: true });
    });
  });
}

export const __testables = { appleScriptString };
