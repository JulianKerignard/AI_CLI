import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    unregister(name) {
        this.tools.delete(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return [...this.tools.values()];
    }
    async run(name, input, ctx) {
        const tool = this.tools.get(name);
        if (!tool)
            throw new Error(`Outil inconnu: ${name}`);
        return await tool.run(input, ctx);
    }
}
export function createBaseRegistry() {
    const registry = new ToolRegistry();
    registry.register(readTool);
    registry.register(writeTool);
    registry.register(editTool);
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(lsTool);
    registry.register(bashTool);
    return registry;
}
