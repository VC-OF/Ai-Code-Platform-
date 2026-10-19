export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const COLOR_MAP: Record<number, string> = {
  30: '#6b7280', // black/gray
  31: '#ef4444', // red
  32: '#10b981', // green
  33: '#f59e0b', // yellow
  34: '#3b82f6', // blue
  35: '#a855f7', // magenta
  36: '#06b6d4', // cyan
  37: '#f3f4f6', // white
  90: '#9ca3af', // bright black / gray
  91: '#f87171', // bright red
  92: '#34d399', // bright green
  93: '#fbbf24', // bright yellow
  94: '#60a5fa', // bright blue
  95: '#c084fc', // bright magenta
  96: '#22d3ee', // bright cyan
  97: '#ffffff', // bright white
};

/**
 * Parses a string containing ANSI escape codes into an array of styled spans.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  if (!input) return [];

  // Match ANSI escape codes: \u001b[...m or \x1b[...m
  const ansiRegex = /(?:\u001b|[\u001b\x1b])\[([0-9;]*)m/g;
  const spans: AnsiSpan[] = [];

  let lastIndex = 0;
  let currentColor: string | undefined = undefined;
  let isBold = false;
  let isDim = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(input)) !== null) {
    const textChunk = input.slice(lastIndex, match.index);
    if (textChunk) {
      spans.push({
        text: textChunk,
        color: currentColor,
        bold: isBold,
        dim: isDim,
      });
    }

    const codeStr = match[1] || '0';
    const codes = codeStr.split(';').map((c) => parseInt(c, 10) || 0);

    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined;
        isBold = false;
        isDim = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (code === 22) {
        isBold = false;
        isDim = false;
      } else if (code === 39) {
        currentColor = undefined;
      } else if (COLOR_MAP[code]) {
        currentColor = COLOR_MAP[code];
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Remainder text
  const remainder = input.slice(lastIndex);
  if (remainder) {
    spans.push({
      text: remainder,
      color: currentColor,
      bold: isBold,
      dim: isDim,
    });
  }

  return spans;
}
