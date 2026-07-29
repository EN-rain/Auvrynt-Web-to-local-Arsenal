import { AUVRYNT_COMMANDS } from "../../infrastructure/command-reference.js";

export function printHelp(): void {
  const commandWidth = AUVRYNT_COMMANDS.reduce(
    (width, item) => Math.max(width, item.command.length),
    0,
  );
  console.log([
    "Auvrynt",
    "",
    "Usage:",
    ...AUVRYNT_COMMANDS.map(
      (item) => `  ${item.command.padEnd(commandWidth)}  ${item.description}`,
    ),
  ].join("\n"));
}
