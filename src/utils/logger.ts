import chalk from "chalk";
import boxen from "boxen";

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
    const trimmed = text.length > 800 ? text.slice(0, 800) + "\n…" : text;
    const box = boxen(chalk.gray(trimmed), {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 0, left: 2, right: 0 },
      borderStyle: "round",
      borderColor: "gray",
      dimBorder: true,
    });
    console.log(box);
  },
  banner: (title: string) => {
    console.log();
    console.log(chalk.bold.cyan("┌─ " + title));
  },
};

export { chalk };
