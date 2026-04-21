import chalk from "chalk";

const ART = [
  " █████╗ ██╗     ██████╗██╗     ██╗",
  "██╔══██╗██║    ██╔════╝██║     ██║",
  "███████║██║    ██║     ██║     ██║",
  "██╔══██║██║    ██║     ██║     ██║",
  "██║  ██║██║    ╚██████╗███████╗██║",
  "╚═╝  ╚═╝╚═╝     ╚═════╝╚══════╝╚═╝",
];

const GRADIENT = [
  chalk.hex("#60a5fa"),
  chalk.hex("#818cf8"),
  chalk.hex("#a78bfa"),
  chalk.hex("#c084fc"),
  chalk.hex("#e879f9"),
  chalk.hex("#f472b6"),
];

export function renderBanner(subtitle: string): string {
  const lines = ART.map((line, i) => GRADIENT[i % GRADIENT.length](line));
  const pad = "  ";
  return [
    "",
    ...lines.map((l) => pad + l),
    "",
    pad + chalk.gray(subtitle),
    "",
  ].join("\n");
}
