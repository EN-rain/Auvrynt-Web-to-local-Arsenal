import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostContext, ToolResultCard } from "./card-types.js";
import { DiffBlock, parseUnifiedPatch } from "./lightweight-diff.js";

interface PayloadRendererOptions {
  card: ToolResultCard;
  hostContext?: HostContext;
  errorMessage?: string | null;
  visibleFileCount?: number;
}

interface MountedPayload {
  update(options: PayloadRendererOptions): void;
  unmount(): void;
}

export function mountReviewPayload(
  container: HTMLElement,
  options: PayloadRendererOptions,
): MountedPayload {
  const root = createRoot(container);
  root.render(<ReviewPayload {...options} />);

  return {
    update(nextOptions) {
      root.render(<ReviewPayload {...nextOptions} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

function ReviewPayload({
  card,
  errorMessage = null,
  visibleFileCount,
}: PayloadRendererOptions) {
  const patch = card.payload?.patch;
  const files = useMemo(() => patch ? parseUnifiedPatch(patch) : [], [patch]);
  const visibleFiles = typeof visibleFileCount === "number"
    ? files.slice(0, visibleFileCount)
    : files;
  const [openFiles, setOpenFiles] = useState(() => new Set<string>());

  if (errorMessage) return <StatusLine message={errorMessage} tone="error" />;
  if (!patch) return <StatusLine message="Diff payload is not available." />;
  if (files.length === 0) return <StatusLine message="No diff hunks to review." />;

  return (
    <div className="review-diff">
      <div className="review-diff-files">
        {visibleFiles.map((fileDiff, index) => {
          const key = `${fileDiff.name}-${index}`;
          const isOpen = openFiles.has(key);

          return (
            <div className="review-diff-file" key={key}>
              <button
                type="button"
                className="review-diff-file-header"
                aria-expanded={isOpen}
                onClick={() => {
                  const next = new Set(openFiles);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  setOpenFiles(next);
                }}
              >
                <span className="review-diff-file-name">{fileDiff.name}</span>
                <span className="review-diff-file-stats">
                  <span className="add">+{fileDiff.additions}</span>
                  <span className="remove">-{fileDiff.removals}</span>
                </span>
              </button>
              {isOpen ? <DiffBlock lines={fileDiff.lines} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusLine({
  message,
  tone = "muted",
}: {
  message: string;
  tone?: "muted" | "error";
}) {
  return <div className={`status ${tone}`}>{message}</div>;
}
