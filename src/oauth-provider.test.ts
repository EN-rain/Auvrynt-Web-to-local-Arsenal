import assert from "node:assert/strict";
import { InMemoryOAuthClientsStore } from "./oauth-provider.js";

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
