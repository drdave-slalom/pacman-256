import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import {
  CONNECTION_ROOM,
  PROTOCOL_VERSION,
  isConnectionState,
} from "@maze/shared";
import "./style.css";

const button = document.querySelector<HTMLButtonElement>("#connect");
const status = document.querySelector<HTMLParagraphElement>("#status");
if (!button || !status) {
  throw new Error("Connection check requires the connect button and status element.");
}
const connectButton = button;
const statusText = status;

class PreviewScene extends Phaser.Scene {
  create(): void {
    this.add.rectangle(160, 90, 280, 130, 0x243658).setStrokeStyle(3, 0x7be6d6);
    this.add.circle(120, 90, 18, 0x7be6d6);
    this.add.rectangle(200, 90, 32, 32, 0xffae80);
    this.add.text(160, 155, "Renderer ready", {
      fontFamily: "system-ui",
      fontSize: "16px",
      color: "#eef4ff",
    }).setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 320,
  height: 180,
  backgroundColor: "#10172b",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: PreviewScene,
});

// In dev, the Vite dev server proxies /multiplayer to the backend and strips
// the prefix. When the built client is served by the game server itself
// (production/Kubernetes), Colyseus's matchmaking and room routes live at the
// document root, so connect there directly.
const endpoint = new URL(
  import.meta.env.PROD ? "/" : "/multiplayer",
  window.location.href,
);
endpoint.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const client = new Client(endpoint.toString());

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  statusText.textContent = "Connecting to the local Colyseus server...";
  try {
    const room = await client.create(CONNECTION_ROOM, {
      protocolVersion: PROTOCOL_VERSION,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timed out waiting for authoritative server state.")),
        5_000,
      );
      room.onStateChange.once((state: unknown) => {
        window.clearTimeout(timer);
        if (isConnectionState(state)) {
          resolve();
        } else {
          reject(new Error("Server returned an incompatible connection snapshot."));
        }
      });
      room.onError((code, message) => {
        window.clearTimeout(timer);
        reject(new Error(`Server error ${code}: ${message}`));
      });
      room.onLeave((code) => {
        window.clearTimeout(timer);
        reject(new Error(`Server closed the connection (${code}).`));
      });
    }).finally(() => room.leave());
    statusText.textContent = `Connected: shared protocol v${PROTOCOL_VERSION}, authoritative lobby state received.`;
  } catch (error) {
    console.error("Connection check failed", error);
    statusText.textContent =
      `Connection failed: ${error instanceof Error ? error.message : String(error)}. Check the server terminal and network.`;
  } finally {
    connectButton.disabled = false;
  }
});
