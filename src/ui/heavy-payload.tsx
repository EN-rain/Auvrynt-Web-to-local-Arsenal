import { createRoot, type Root } from "react-dom/client";
import {
  isEditTool,
  isReadTool,
  isWriteTool,
  payloadText,
  summaryNumber,
  type HostContext,
  type ToolResultCard,
} from "./card-types.js";
import { DiffBlock, FileTextBlock, parseUnifiedPatch } from "./lightweight-diff.js";

interface PayloadRendererOptions {
  card: ToolResultCard;
  hostContext?: HostContext;
  errorMessage?: string | null;
}

interface MountedPayload {
  update(options: PayloadRendererOptions): void;
  unmount(): void;
}

export function mountHeavyPayload(
  container: HTMLElement,
  options: PayloadRendererOptions,
): MountedPayload {
  const root = createRoot(container);
  render(root, options);

  return {
    update(nextOptions) {
      render(root, nextOptions);
    },
    unmount() {
      root.unmount();
    },
  };
}

export type { MountedPayload, PayloadRendererOptions };

function render(root: Root, options: PayloadRendererOptions): void {
  root.render(<HeavyPayload {...options} />);
}

function HeavyPayload({
  card,
  errorMessage = null,
}: PayloadRendererOptions) {
  if (errorMessage) {
    return <StatusLine message={errorMessage} tone="error" />;
  }

  if (isEditTool(card.tool) || isWriteTool(card.tool)) {
    const patch = card.payload?.patch || card.payload?.diff;
    if (!patch) return <StatusLine message="Diff payload is not available." />;
    const files = parseUnifiedPatch(patch);
    return (
      <div className="light-diff-stack">
        {files.map((file, index) => (
          <section className="light-diff-file" key={`${file.name}-${index}`}>
            <div className="light-diff-file-title">
              <span>{file.name}</span>
              <span className="review-diff-file-stats">
                <span className="add">+{file.additions}</span>
                <span className="remove">-{file.removals}</span>
              </span>
            </div>
            <DiffBlock lines={file.lines} />
          </section>
        ))}
      </div>
    );
  }

  const text = payloadText(card.payload);
  if (!text) return <StatusLine message="No details available." />;

  if (isReadTool(card.tool)) {
    return (
      <FileTextBlock
        text={text}
        startLine={summaryNumber(card.summary, "offset") ?? 1}
      />
    );
  }

  return <pre className={`text-payload ${card.tool}`}>{text}</pre>;
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
