/** Response styles selectable with /output-style. Client-safe (no Node imports). */
export type OutputStyle = 'default' | 'explanatory' | 'learning' | 'concise';

export const OUTPUT_STYLES: OutputStyle[] = ['default', 'explanatory', 'learning', 'concise'];

export function isOutputStyle(value: unknown): value is OutputStyle {
  return typeof value === 'string' && (OUTPUT_STYLES as string[]).includes(value);
}
