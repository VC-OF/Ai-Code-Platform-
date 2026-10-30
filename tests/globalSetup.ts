import fs from 'fs';
import os from 'os';
import path from 'path';

// Remove the temp data folder vitest.config.ts created for this run
export default function setup() {
  return () => {
    const root = process.env.OPEN_CODE_DATA_ROOT;
    if (root && path.basename(root).startsWith('open-code-test-') && root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true });
  };
}
