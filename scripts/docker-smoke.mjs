import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { Client } from "@colyseus/sdk";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 }).trim();
const image = process.env.DOCKER_IMAGE ?? "maze-workshop:ci";

test("game image serves static client, health, and real Colyseus create/join", { timeout: 60_000 }, async (t) => {
  // Random loopback-only host port; exercise a non-default container PORT too.
  const id = docker("run", "--detach", "--publish", "127.0.0.1::3187", "--env", "PORT=3187", image);
  const rooms = [];
  t.after(async () => {
    try {
      await Promise.all(rooms.map((room) => room.leave()));
      console.info(docker("logs", id));
    } finally { docker("rm", "--force", id); }
  });
  assert.equal(docker("inspect", "--format", "{{.Config.User}}", id), "node");
  docker("exec", id, "node", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    assert.notEqual(process.getuid(), 0);
    for (const path of ['/app/factory-control', '/app/node_modules/@maze/factory-control', '/app/node_modules/@maze/factory-control-shared', '/app/node_modules/@maze/factory-control-web', '/app/node_modules/@maze/factory-control-tui', '/app/node_modules/phaser']) {
      assert.equal(existsSync(path), false, path);
    }
    assert.equal(process.env.CLIENT_DIST, '/app/apps/client/dist');
  `);
  const mapping = docker("port", id, "3187/tcp");
  const endpoint = `http://${mapping}`;
  const get = (route) => fetch(`${endpoint}${route}`, { signal: AbortSignal.timeout(3000) });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await get("/health");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok", protocolVersion: 1 });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(ready, "container health did not become ready");
  const response = await get("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith(".js")), "built client JS referenced");
  for (const asset of assets) {
    const result = await get(asset);
    assert.equal(result.status, 200, asset);
    assert.ok((await result.arrayBuffer()).byteLength > 0, asset);
    assert.doesNotMatch(result.headers.get("content-type") ?? "", /text\/html/, asset);
  }
  const client = new Client(endpoint.replace("http:", "ws:"));
  const host = await client.create("game", { protocolVersion: 1, displayName: "Image host" });
  rooms.push(host);
  const guest = await client.joinById(host.roomId, { protocolVersion: 1, displayName: "Image guest" });
  rooms.push(guest);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { guest.onStateChange.remove(check); reject(new Error("No two-player authoritative state")); }, 5000);
    const check = () => {
      if (guest.state?.players?.size === 2) { clearTimeout(timer); guest.onStateChange.remove(check); resolve(); }
    };
    guest.onStateChange(check);
    check();
  });
  console.info("Verified nonroot runtime, PORT override, protocol v1 health, HTML/assets, and two-player Colyseus HTTP/WebSocket route.");
});
