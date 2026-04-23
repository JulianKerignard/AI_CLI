// Singleton module qui expose la liste des slash commands à l'InputBox
// pour l'autocomplete. Populé une fois par repl.ts au démarrage depuis
// CommandRegistry. Les commandes ne changent pas à runtime (registry gelé
// après init), pas besoin d'EventEmitter.
let commands = [];
export function setSlashCommands(items) {
    commands = [...items].sort((a, b) => a.name.localeCompare(b.name));
}
export function getSlashCommands() {
    return commands;
}
