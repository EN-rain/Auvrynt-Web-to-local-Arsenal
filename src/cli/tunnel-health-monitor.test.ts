import assert from "node:assert/strict";
import { isNgrokQuotaExceededResponse } from "./tunnel-health-monitor.js";

assert.equal(isNgrokQuotaExceededResponse(403, "ERR_NGROK_727", ""), true);
assert.equal(isNgrokQuotaExceededResponse(403, undefined, "ERR_NGROK_727"), true);
assert.equal(
  isNgrokQuotaExceededResponse(403, undefined, "This account has reached its HTTP requests limit for the month."),
  true,
);
assert.equal(isNgrokQuotaExceededResponse(403, "ERR_NGROK_3200", "Forbidden"), false);
assert.equal(isNgrokQuotaExceededResponse(429, "ERR_NGROK_727", ""), false);
assert.equal(isNgrokQuotaExceededResponse(200, undefined, "HTTP requests limit for the month"), false);

console.log("Tunnel health monitor detection tests passed!");
