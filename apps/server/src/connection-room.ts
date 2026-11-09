import { Room, ServerError } from "@colyseus/core";
import { schema, t } from "@colyseus/schema";
import {
  PROTOCOL_VERSION,
  isProtocolCompatible,
  type RoomPhase,
} from "@maze/shared";

const ConnectionSnapshot = schema({
  protocolVersion: t.number().default(PROTOCOL_VERSION),
  phase: t.string<RoomPhase>().default("lobby"),
});

export class ConnectionRoom extends Room<{ state: InstanceType<typeof ConnectionSnapshot> }> {
  maxClients = 1;

  onCreate(options: unknown): void {
    if (
      typeof options !== "object" ||
      options === null ||
      !("protocolVersion" in options) ||
      !isProtocolCompatible(options.protocolVersion)
    ) {
      throw new ServerError(400, "PROTOCOL_MISMATCH: reload with a compatible client.");
    }
    this.setState(new ConnectionSnapshot());
  }
}
