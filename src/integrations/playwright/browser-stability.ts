export interface BrowserProcessLike {
  pid?: number;
  kill(signal?: string): boolean;
}

export interface ClosableBrowserLike {
  close(): Promise<void>;
  process?(): BrowserProcessLike | null;
}

export interface BrowserCloseResult {
  closed: boolean;
  forceKilled: boolean;
}

export async function settleWithin(
  action: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action().then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeBrowserWithDeadline(
  browser: ClosableBrowserLike | undefined,
  timeoutMs: number,
): Promise<BrowserCloseResult> {
  if (!browser) return { closed: true, forceKilled: false };

  const closed = await settleWithin(() => browser.close(), timeoutMs);
  if (closed) return { closed: true, forceKilled: false };

  let forceKilled = false;
  try {
    forceKilled = browser.process?.()?.kill("SIGKILL") ?? false;
  } catch {
    forceKilled = false;
  }
  return { closed: false, forceKilled };
}

export function shouldEmbedScreenshot(
  bytes: number,
  alreadyEmbeddedBytes: number,
  perImageLimitBytes: number,
  totalLimitBytes: number,
): boolean {
  return Number.isFinite(bytes)
    && bytes >= 0
    && bytes <= perImageLimitBytes
    && alreadyEmbeddedBytes + bytes <= totalLimitBytes;
}
