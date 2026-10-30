import path from 'path';

/** Folder holding the platform's runtime data (.platform/, workspaces/).
 *  Defaults to the app's working directory; tests point OPEN_CODE_DATA_ROOT
 *  at a temp folder so they never touch the real database or settings. */
export function dataRoot(): string {
  return process.env.OPEN_CODE_DATA_ROOT || process.cwd();
}

export function platformDir(...parts: string[]): string {
  return path.join(/* turbopackIgnore: true */ dataRoot(), '.platform', ...parts);
}
