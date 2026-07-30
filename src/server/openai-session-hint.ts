export function openAiLogicalSessionId(messages: unknown[]): string | undefined {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const rpc = message as {
      _meta?: Record<string, unknown>;
      params?: { _meta?: Record<string, unknown> };
    };
    const value = rpc.params?._meta?.["openai/session"] ?? rpc._meta?.["openai/session"];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized && normalized.length <= 256) return normalized;
  }
  return undefined;
}
