import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { checkControlToken, isLoopback } from "./token.ts";

function fakeReq(remoteAddress: string, token?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: token !== undefined ? { "x-control-token": token } : {},
  } as unknown as IncomingMessage;
}

function withToken(token: string | undefined, run: () => void): void {
  const previous = process.env.FACTORY_CONTROL_TOKEN;
  if (token === undefined) delete process.env.FACTORY_CONTROL_TOKEN;
  else process.env.FACTORY_CONTROL_TOKEN = token;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.FACTORY_CONTROL_TOKEN;
    else process.env.FACTORY_CONTROL_TOKEN = previous;
  }
}

test("isLoopback recognizes loopback addresses", () => {
  assert.equal(isLoopback(fakeReq("127.0.0.1")), true);
  assert.equal(isLoopback(fakeReq("::1")), true);
  assert.equal(isLoopback(fakeReq("::ffff:127.0.0.1")), true);
  assert.equal(isLoopback(fakeReq("10.0.0.5")), false);
});

test("localhost is always allowed regardless of token configuration", () => {
  withToken(undefined, () => {
    assert.ok(checkControlToken(fakeReq("127.0.0.1")).ok);
  });
  withToken("secret", () => {
    assert.ok(checkControlToken(fakeReq("127.0.0.1")).ok);
  });
});

test("remote without configured token is denied (503)", () => {
  withToken(undefined, () => {
    const result = checkControlToken(fakeReq("10.0.0.5"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
});

test("remote requires a matching token", () => {
  withToken("s3cret", () => {
    const bad = checkControlToken(fakeReq("10.0.0.5"));
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 401);

    const missing = checkControlToken(fakeReq("10.0.0.5", ""));
    assert.equal(missing.ok, false);

    const good = checkControlToken(fakeReq("10.0.0.5", "s3cret"));
    assert.ok(good.ok);
  });
});
