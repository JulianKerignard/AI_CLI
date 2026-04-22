export function extractToolCalls(response) {
    return response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}
export function extractText(content) {
    return content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
}
