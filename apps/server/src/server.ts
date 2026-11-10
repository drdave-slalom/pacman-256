import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { CONNECTION_ROOM, GAME_ROOM, PROTOCOL_VERSION } from "@maze/shared";
import { ConnectionRoom } from "./connection-room.ts";
import { GameRoom, gameRoomWithSeedSource, type MazeSeedSource } from "./game-room.ts";

export interface GameServerOptions {
  /** Trusted server-side maze seed source (tests); defaults to a random uint32. */
  mazeSeedSource?: MazeSeedSource;
}

export function createGameServer(options: GameServerOptions = {}) {
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: false,
    greet: false,
    express: (app) => {
      app.get("/health", (_request, response) => {
        response.json({ status: "ok", protocolVersion: PROTOCOL_VERSION });
      });
      const clientDist = process.env.CLIENT_DIST ?? path.resolve(process.cwd(), "client-dist");
      if (existsSync(clientDist)) {
        app.use(express.static(clientDist));
      }
    },
  });
  server.define(CONNECTION_ROOM, ConnectionRoom);
  server.define(
    GAME_ROOM,
    options.mazeSeedSource ? gameRoomWithSeedSource(options.mazeSeedSource) : GameRoom,
  );
  return { server, httpServer };
}
