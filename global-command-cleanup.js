'use strict';

// Tavern commands are intentionally global in multi-guild mode so a newly
// invited server always has /setup available. Older builds deleted global
// commands on every startup; keep this preload as a harmless compatibility shim.
console.log('[command-registry] Global slash commands retained for multi-guild installs.');
