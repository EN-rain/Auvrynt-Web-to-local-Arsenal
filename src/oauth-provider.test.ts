import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryOAuthClientsStore, SingleUserOAuthProvider } from "./oauth-provider.js";

function client(redirectUri: string) {
  return {
    redirect_uris: [redirectUri],
    client_name: "Test client",
    token_endpoint_auth_method: "none" as const,
    grant_types: ["authorization_code", "refresh_token"] as const,
    response_types: ["code"] as const,
  };
}

const store = new InMemoryOAuthClientsStore(["example.com"]);

assert.throws(
  () => store.registerClient(client("http://example.com/callback") as any),
  /redirect_uri is not allowed/i,
);
assert.doesNotThrow(
  () => store.registerClient(client("https://example.com/callback") as any),
);
assert.doesNotThrow(
  () => store.registerClient(client("http://127.0.0.1:9911/callback") as any),
);
assert.doesNotThrow(
  () => store.registerClient(client("http://localhost:9911/callback") as any),
);
assert.throws(
  () => store.registerClient(client("javascript:alert(1)") as any),
  /redirect_uri is not allowed/i,
);

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-oauth-"));
try {
  const stateFile = join(stateDir, "oauth-state.json");
  const resource = new URL("https://stable.example.com/mcp");
  const config = {
    ownerToken: "test-owner-token",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 3600,
    scopes: ["auvrynt:read"],
    allowedRedirectHosts: ["localhost"],
  };
  const first = new SingleUserOAuthProvider(config, resource, stateFile);
  const registered = (first.clientsStore as InMemoryOAuthClientsStore).registerClient(
    client("http://localhost:43119/callback") as any,
  );
  let redirect = "";
  await first.authorize(registered, {
    redirectUri: "http://localhost:43119/callback",
    codeChallenge: "test-challenge",
    scopes: ["auvrynt:read"],
    state: "test-state",
    resource,
  }, {
    req: { method: "POST", body: { owner_token: config.ownerToken } },
    redirect: (_status: number, location: string) => {
      redirect = location;
    },
  } as any);
  const code = new URL(redirect).searchParams.get("code");
  assert.ok(code);
  const tokens = await first.exchangeAuthorizationCode(registered, code);

  const restarted = new SingleUserOAuthProvider(config, resource, stateFile);
  const restoredClient = restarted.clientsStore.getClient(registered.client_id);
  assert.ok(restoredClient);
  const authInfo = await restarted.verifyAccessToken(tokens.access_token);
  assert.equal(authInfo.clientId, registered.client_id);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
