import chalk from "chalk";

export const log = {
  info: (msg: string) => console.log(chalk.cyan("ℹ ") + msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠ ") + msg),
  error: (msg: string) => console.log(chalk.red("✖ ") + msg),
  dim: (msg: string) => console.log(chalk.gray(msg)),
  user: (msg: string) => console.log(chalk.bold.blue("» ") + msg),
  assistant: (msg: string) =>
    console.log(chalk.bold.green("● ") + msg.replace(/\n/g, "\n  ")),
  tool: (name: string, detail: string) =>
    console.log(chalk.magenta(`⚙ ${name}`) + chalk.gray(` ${detail}`)),
  toolResult: (text: string) => {
    const trimmed = text.length > 400 ? text.slice(0, 400) + "…" : text;
    console.log(chalk.gray("  " + trimmed.replace(/\n/g, "\n  ")));
  },
  banner: (title: string) => {
    console.log();
    console.log(chalk.bold.cyan("┌─ " + title));
  },
};

export { chalk };
