import net from "node:net";
import tls from "node:tls";
import { Buffer } from "node:buffer";

export interface SmtpEmailConfig {
  smtpHost?: string;
  smtpPort: number;
  useSsl: boolean;
  username?: string;
  password?: string;
  from?: string;
  to?: string;
}

export interface EmailNotificationMessage {
  subject: string;
  text: string;
}

type SmtpSocket = net.Socket | tls.TLSSocket;

const DEFAULT_TIMEOUT_MS = 10_000;

function sanitizeSmtpError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text
    .replace(/(password|pass|token|secret|authorization)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
}

function requireSmtpTarget(config: SmtpEmailConfig): { host: string; port: number } {
  if (!config.smtpHost) throw new Error("SMTP host is not configured");
  if (!Number.isInteger(config.smtpPort) || config.smtpPort <= 0) throw new Error("SMTP port is invalid");
  return { host: config.smtpHost, port: config.smtpPort };
}

function recipients(config: SmtpEmailConfig): string[] {
  return (config.to ?? "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function buildMessage(config: SmtpEmailConfig, message: EmailNotificationMessage): string {
  const from = config.from || config.username;
  const to = recipients(config).join(", ");
  if (!from) throw new Error("SMTP from/username is not configured");
  if (!to) throw new Error("SMTP recipient is not configured");
  return [
    `From: ${escapeHeader(from)}`,
    `To: ${escapeHeader(to)}`,
    `Subject: ${escapeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(message.text),
  ].join("\r\n");
}

class SmtpSession {
  private buffer = "";

  constructor(
    private socket: SmtpSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += String(chunk);
    });
  }

  async read(expect: number | number[]): Promise<string> {
    const expected = Array.isArray(expect) ? expect : [expect];
    const response = await this.readAny();
    if (!expected.includes(response.code)) {
      throw new Error(`SMTP expected ${expected.join("/")} but got ${response.code}: ${response.text}`);
    }
    return response.text;
  }

  writeLine(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeData(data: string): void {
    this.socket.write(data);
  }

  async upgradeTls(host: string): Promise<void> {
    const plainSocket = this.socket;
    plainSocket.removeAllListeners("data");
    const upgraded = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket: plainSocket,
        servername: host,
      });
      const timer = setTimeout(() => {
        cleanup();
        tlsSocket.destroy();
        reject(new Error("SMTP STARTTLS timeout"));
      }, this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        tlsSocket.off("secureConnect", onSecureConnect);
        tlsSocket.off("error", onError);
      };
      const onSecureConnect = () => {
        cleanup();
        resolve(tlsSocket);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      tlsSocket.once("secureConnect", onSecureConnect);
      tlsSocket.once("error", onError);
    });
    this.socket = upgraded;
    this.buffer = "";
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += String(chunk);
    });
  }

  close(): void {
    this.socket.end();
  }

  destroy(): void {
    this.socket.destroy();
  }

  private async readAny(): Promise<{ code: number; text: string }> {
    const parsed = this.parseResponse();
    if (parsed) return parsed;

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("SMTP response timeout"));
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off("data", onData);
        this.socket.off("error", onError);
        this.socket.off("close", onClose);
      };
      const onData = () => {
        const next = this.parseResponse();
        if (!next) return;
        cleanup();
        resolve(next);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SMTP socket closed"));
      };
      this.socket.on("data", onData);
      this.socket.on("error", onError);
      this.socket.on("close", onClose);
    });
  }

  private parseResponse(): { code: number; text: string } | null {
    const end = this.buffer.indexOf("\r\n");
    if (end < 0) return null;

    const lines = this.buffer.split("\r\n");
    let consumed = 0;
    let finalLine: string | undefined;
    for (const line of lines) {
      if (!line) break;
      consumed += line.length + 2;
      if (/^\d{3} /.test(line)) {
        finalLine = line;
        break;
      }
      if (!/^\d{3}-/.test(line)) break;
    }
    if (!finalLine) return null;

    const text = this.buffer.slice(0, consumed).trim();
    this.buffer = this.buffer.slice(consumed);
    return { code: Number(finalLine.slice(0, 3)), text };
  }
}

async function connect(config: SmtpEmailConfig, timeoutMs: number): Promise<{ session: SmtpSession; host: string }> {
  const { host, port } = requireSmtpTarget(config);
  const socket = await new Promise<SmtpSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP connect timeout"));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    const onConnect = (s: SmtpSocket) => {
      cleanup();
      resolve(s);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    if (config.useSsl) {
      const s = tls.connect({ host, port, servername: host }, () => onConnect(s));
      s.once("error", onError);
    } else {
      const s = net.connect({ host, port }, () => onConnect(s));
      s.once("error", onError);
    }
  });
  socket.setTimeout(timeoutMs);
  return { session: new SmtpSession(socket, timeoutMs), host };
}

async function prepareSession(config: SmtpEmailConfig, timeoutMs: number): Promise<SmtpSession> {
  const { session, host } = await connect(config, timeoutMs);
  await session.read(220);
  session.writeLine("EHLO miniclaw.local");
  await session.read(250);
  if (!config.useSsl) {
    session.writeLine("STARTTLS");
    await session.read(220);
    await session.upgradeTls(host);
    session.writeLine("EHLO miniclaw.local");
    await session.read(250);
  }
  return session;
}

export async function verifySmtpReachability(config: SmtpEmailConfig, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  let session: SmtpSession | undefined;
  try {
    session = await prepareSession(config, timeoutMs);
    session.writeLine("QUIT");
    await session.read(221).catch(() => undefined);
  } catch (err) {
    throw new Error(sanitizeSmtpError(err));
  } finally {
    session?.close();
  }
}

export async function sendSmtpEmail(
  config: SmtpEmailConfig,
  message: EmailNotificationMessage,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
  let session: SmtpSession | undefined;
  try {
    session = await prepareSession(config, timeoutMs);

    if (!config.username || !config.password) {
      throw new Error("SMTP username/password is not configured");
    }
    session.writeLine("AUTH LOGIN");
    await session.read(334);
    session.writeLine(Buffer.from(config.username, "utf8").toString("base64"));
    await session.read(334);
    session.writeLine(Buffer.from(config.password, "utf8").toString("base64"));
    await session.read(235);

    const from = config.from || config.username;
    const to = recipients(config);
    if (!from) throw new Error("SMTP from/username is not configured");
    if (!to.length) throw new Error("SMTP recipient is not configured");

    session.writeLine(`MAIL FROM:<${from}>`);
    await session.read(250);
    for (const recipient of to) {
      session.writeLine(`RCPT TO:<${recipient}>`);
      await session.read([250, 251]);
    }
    session.writeLine("DATA");
    await session.read(354);
    session.writeData(`${buildMessage(config, message)}\r\n.\r\n`);
    await session.read(250);
    session.writeLine("QUIT");
    await session.read(221).catch(() => undefined);
  } catch (err) {
    throw new Error(sanitizeSmtpError(err));
  } finally {
    session?.close();
  }
}

export const __testables = { buildMessage, recipients, sanitizeSmtpError };
