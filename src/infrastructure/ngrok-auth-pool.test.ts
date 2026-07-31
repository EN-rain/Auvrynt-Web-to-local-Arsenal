import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateNgrokAuthtoken,
  addNgrokAuthtoken,
  markActiveNgrokAuthtokenQuotaExceeded,
  ngrokAuthtokenFingerprint,
  removeNgrokAuthtoken,
  resolveNgrokAuthtoken,
  summarizeNgrokAuthtokens,
} from "./ngrok-auth-pool.js";
import { loadAuvryntFiles, writeAuvryntConfig } from "./user-config.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-ngrok-pool-"));
const env: NodeJS.ProcessEnv = { ...process.env, AUVRYNT_CONFIG_DIR: root };
delete env.AUVRYNT_NGROK_AUTHTOKEN;

const tokenA = "2abc_first_ngrok_token_1234567890";
const tokenB = "2abc_second_ngrok_token_0987654321";
const tokenC = "2abc_environment_override_1122334455";
const tokenD = "2abc_fresh_recovery_token_6677889900";

try {
  writeAuvryntConfig({ ngrokAuthtoken: tokenA }, env);
  assert.equal(resolveNgrokAuthtoken(loadAuvryntFiles(env), env), tokenA);

  const added = addNgrokAuthtoken(tokenB, env);
  assert.equal(added.summary.tokens.length, 2);
  assert.equal(added.summary.activeIndex, 0);
  assert.equal(added.summary.tokens[0]?.active, true);
  assert.equal(JSON.stringify(added.summary).includes(tokenA), false);
  assert.equal(JSON.stringify(added.summary).includes(tokenB), false);
  assert.equal(loadAuvryntFiles(env).config.ngrokAuthtoken, undefined, "legacy config token should migrate to private auth storage");

  const firstRotation = markActiveNgrokAuthtokenQuotaExceeded("2026-07-31T05:00:00.000Z", env);
  assert.equal(firstRotation.current?.fingerprint, ngrokAuthtokenFingerprint(tokenA));
  assert.equal(firstRotation.next?.fingerprint, ngrokAuthtokenFingerprint(tokenB));
  assert.equal(firstRotation.summary.activeIndex, 1);
  assert.equal(resolveNgrokAuthtoken(loadAuvryntFiles(env), env), tokenB);

  const secondRotation = markActiveNgrokAuthtokenQuotaExceeded("2026-07-31T05:01:00.000Z", env);
  assert.equal(secondRotation.next, undefined);
  assert.equal(secondRotation.summary.tokens.every((token) => Boolean(token.quotaExhaustedAt)), true);

  const recovered = addNgrokAuthtoken(tokenD, env);
  assert.equal(recovered.activeChanged, true, "adding a fresh token must replace an exhausted active token");
  assert.equal(recovered.summary.activeIndex, 2);
  assert.equal(recovered.summary.tokens[2]?.active, true);
  assert.equal(recovered.summary.tokens[2]?.quotaExhaustedAt, undefined);

  const thirdRotation = markActiveNgrokAuthtokenQuotaExceeded("2026-07-31T05:01:30.000Z", env);
  assert.equal(thirdRotation.next, undefined);
  const sameTokenRetry = activateNgrokAuthtoken(2, env);
  assert.equal(sameTokenRetry.activeChanged, true, "retrying the exhausted active token must restart the tunnel");
  assert.equal(sameTokenRetry.summary.tokens[2]?.quotaExhaustedAt, undefined);

  const retried = activateNgrokAuthtoken(0, env);
  assert.equal(retried.summary.activeIndex, 0);
  assert.equal(retried.summary.tokens[0]?.quotaExhaustedAt, undefined);
  assert.equal(retried.activeChanged, true);

  const removed = removeNgrokAuthtoken(1, env);
  assert.equal(removed.summary.tokens.length, 2);
  assert.equal(removed.summary.tokens[0]?.fingerprint, ngrokAuthtokenFingerprint(tokenA));

  const overrideEnv = { ...env, AUVRYNT_NGROK_AUTHTOKEN: tokenC };
  const overrideSummary = summarizeNgrokAuthtokens(loadAuvryntFiles(overrideEnv), overrideEnv);
  assert.equal(overrideSummary.environmentOverride, true);
  assert.equal(overrideSummary.activeIndex, null);
  assert.equal(resolveNgrokAuthtoken(loadAuvryntFiles(overrideEnv), overrideEnv), tokenC);
  assert.throws(() => activateNgrokAuthtoken(0, overrideEnv), /overriding the saved token pool/i);
  const blockedRotation = markActiveNgrokAuthtokenQuotaExceeded("2026-07-31T05:02:00.000Z", overrideEnv);
  assert.equal(blockedRotation.environmentOverride, true);
  assert.equal(blockedRotation.next, undefined);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("ngrok auth pool tests passed!");
