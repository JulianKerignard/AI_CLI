import { log, chalk } from "../utils/logger.js";
import { categorize } from "./policy.js";
import { permissionController } from "../ui/permission-controller.js";
export async function askPermission(toolName, input) {
    const category = categorize(toolName);
    return permissionController.ask(toolName, category, input);
}
// Notifie l'user qu'un tool a été refusé (pour plan mode / deny pattern).
export function logDenied(toolName, reason) {
    log.warn(chalk.hex("#c76a5f")("✗ ") +
        chalk.hex("#f6f1e8").bold(toolName) +
        chalk.hex("#8a8270")(" refusé — ") +
        chalk.hex("#bdb3a1")(reason));
}
