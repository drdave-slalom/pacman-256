import { serverHost, serverPort } from "./config.ts";
import { createApiServer } from "./http.ts";
import { SnapshotService } from "./service.ts";

const root = process.env.FACTORY_ROOT ?? process.cwd();
const service = new SnapshotService({ root, noGh: false });
const server = createApiServer(service);

server.listen(serverPort(), serverHost(), () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : serverPort();
  // eslint-disable-next-line no-console
  console.log(`factory-control server listening on http://${serverHost()}:${port} (root: ${root})`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
