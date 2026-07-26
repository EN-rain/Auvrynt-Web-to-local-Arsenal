import type { ReactNode } from "react";

export type DiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

export interface ParsedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ParsedDiffFile {
  name: string;
  additions: number;
  removals: number;
  lines: ParsedDiffLine[];
}

export function parseUnifiedPatch(patch: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current = createFile("changes");
  let oldLine: number | undefined;
  let newLine: number | undefined;

  const flush = () => {
    if (current.lines.length > 0) files.push(current);
  };

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = createFile(parseGitDiffName(line));
      oldLine = undefined;
      newLine = undefined;
      current.lines.push({ kind: "meta", text: line });
      continue;
    }

    if (line.startsWith("+++ ")) {
      const candidate = normalizePatchPath(line.slice(4).trim());
      if (candidate && candidate !== "/dev/null") current.name = candidate;
      current.lines.push({ kind: "meta", text: line });
      continue;
    }

    if (line.startsWith("@@")) {
      const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = range ? Number(range[1]) : undefined;
      newLine = range ? Number(range[2]) : undefined;
      current.lines.push({ kind: "hunk", text: line });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: line, newLine });
      if (newLine !== undefined) newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removals += 1;
      current.lines.push({ kind: "remove", text: line, oldLine });
      if (oldLine !== undefined) oldLine += 1;
      continue;
    }

    const isMeta = line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ") || line.startsWith("similarity index ") || line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("\\ No newline at end of file");
    if (isMeta) {
      current.lines.push({ kind: "meta", text: line });
      continue;
    }

    current.lines.push({ kind: "context", text: line, oldLine, newLine });
    if (oldLine !== undefined) oldLine += 1;
    if (newLine !== undefined) newLine += 1;
  }

  flush();
  return files.length > 0 ? files : [current];
}

export function DiffBlock({ lines }: { lines: ParsedDiffLine[] }): ReactNode {
  return (
    <div className="light-diff" role="table" aria-label="Unified diff">
      {lines.map((line, index) => (
        <div className={`light-diff-line ${line.kind}`} role="row" key={`${index}-${line.text}`}>
          <span className="light-diff-number old" aria-hidden="true">{line.oldLine ?? ""}</span>
          <span className="light-diff-number new" aria-hidden="true">{line.newLine ?? ""}</span>
          <code className="light-diff-code">{line.text || " "}</code>
        </div>
      ))}
    </div>
  );
}

export function FileTextBlock({ text, startLine = 1 }: { text: string; startLine?: number }): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="light-file" role="table" aria-label="File contents">
      {lines.map((line, index) => (
        <div className="light-file-line" role="row" key={index}>
          <span className="light-file-number" aria-hidden="true">{startLine + index}</span>
          <code className="light-file-code">{line || " "}</code>
        </div>
      ))}
    </div>
  );
}

function createFile(name: string): ParsedDiffFile {
  return { name, additions: 0, removals: 0, lines: [] };
}

function parseGitDiffName(line: string): string {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match ? match[2] : "changes";
}

function normalizePatchPath(value: string): string {
  if (value.startsWith("b/")) return value.slice(2);
  if (value.startsWith("a/")) return value.slice(2);
  return value;
}
