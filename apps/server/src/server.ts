import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CONNECTION_ROOM, PROTOCOL_VERSION } from "@maze/shared";
import { ConnectionRoom } from "./connection-room.ts";

export function createGameServer() {
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: false,
    greet: false,
    express: (app) => {
      app.get("/health", (_request, response) => {
        response.json({ status: "ok", protocolVersion: PROTOCOL_VERSION });
      });
    },
  });
  server.define(CONNECTION_ROOM, ConnectionRoom);
  return { server, httpServer };
}
