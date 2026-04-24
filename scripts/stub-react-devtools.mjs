// Stub vide pour react-devtools-core.
// Ink l'importe de façon statique mais ne l'utilise qu'en mode devtools
// (var env), jamais en prod CLI. On shim pour éviter de bundler ~1 MB
// de code DevTools inutile.
export const connectToDevTools = () => {};
export default { connectToDevTools };
