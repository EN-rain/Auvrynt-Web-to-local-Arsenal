import { retryControlRequest } from "../control-retry.js";
import {
  INTEGRATION_KEYS,
  type InstanceLockRecord,
  type IntegrationKey,
} from "../background-lifecycle.js";
import { httpUrl, localProbeHost } from "./runtime-support.js";

export function integrationsForProfiles(profiles: IntegrationKey[]): Record<IntegrationKey, boolean> {
  const enabled = new Set(profiles);
  return Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, enabled.has(key)])) as Record<IntegrationKey, boolean>;
}

export async function postInstanceControl(
  active: { record: InstanceLockRecord },
  path: string,
  body?: unknown,
): Promise<Response> {
  if (!active.record.controlToken) {
    throw new Error("The running Auvrynt instance predates live management. Run `auvrynt stop`, then start it again.");
  }
  return retryControlRequest(() => fetch(httpUrl(localProbeHost(active.record.host), active.record.port, path), {
    method: "POST",
    headers: {
      authorization: `Bearer ${active.record.controlToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }), { maxAttempts: 20, maxDelayMs: 2_000 });
}
