import path from 'node:path';
import os from 'node:os';
process.env.ANIMATION_DATA_DIR ??= path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'codex-animation-builder', '.animation-data');
await import('./server.js');
