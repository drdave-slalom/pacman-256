import { createGameServer } from "./server.ts";

const portText = process.env.PORT ?? "2567";
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65_535) {
  throw new Error(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(portText)}.`);
}

const port = Number(portText);
const { server } = createGameServer();
await server.listen(port, "127.0.0.1");
console.info(`Colyseus listening at http://127.0.0.1:${port}; health: /health`);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await server.gracefullyShutdown(false);
  } catch (error) {
    console.error("Server shutdown failed", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
