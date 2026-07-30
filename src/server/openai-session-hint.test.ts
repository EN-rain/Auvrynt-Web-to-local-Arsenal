import assert from "node:assert/strict";
import { openAiLogicalSessionId } from "./openai-session-hint.js";

assert.equal(openAiLogicalSessionId([]), undefined);
assert.equal(openAiLogicalSessionId([{ method: "tools/call", params: {} }]), undefined);
assert.equal(
  openAiLogicalSessionId([
    {
      method: "tools/call",
      params: { _meta: { "openai/session": "  chat-session-1  " } },
    },
  ]),
  "chat-session-1",
);
assert.equal(
  openAiLogicalSessionId([{ _meta: { "openai/session": "legacy-session" } }]),
  "legacy-session",
);
assert.equal(
  openAiLogicalSessionId([
    { params: { _meta: { "openai/session": "" } } },
    { params: { _meta: { "openai/session": "chat-session-2" } } },
  ]),
  "chat-session-2",
);
assert.equal(
  openAiLogicalSessionId([
    { params: { _meta: { "openai/session": "x".repeat(257) } } },
  ]),
  undefined,
);

console.log("OpenAI logical-session hint tests passed!");
