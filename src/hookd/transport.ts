import { createConnection } from "node:net";

export function sendHookdEvent(socketPath: string, event: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let timer: NodeJS.Timeout | undefined;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(event)}\n`);
      timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("hookd response timeout"));
      }, timeoutMs);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      socket.end();
      if (timer) clearTimeout(timer);
      try {
        const response = JSON.parse(line) as { ok?: boolean; error?: string; result?: unknown };
        if (response.ok) resolve(response.result ?? response);
        else reject(new Error(response.error ?? "hookd request failed"));
      } catch (err) {
        reject(err);
      }
    });
    socket.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
