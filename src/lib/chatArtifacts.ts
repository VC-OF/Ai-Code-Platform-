import { ExtractedArtifact } from './db';

/**
 * Extracts Claude-style <antArtifact> tags and standalone renderable code blocks
 * (html, svg, mermaid, tsx, jsx) into structured ExtractedArtifact items.
 */
export function extractArtifacts(text: string): {
  cleanText: string;
  artifacts: ExtractedArtifact[];
} {
  const artifacts: ExtractedArtifact[] = [];
  let workingText = text;

  // 1. Check for <antArtifact ...> ... </antArtifact>
  const antArtifactRegex = /<antArtifact\s+([^>]*?)>([\s\S]*?)<\/antArtifact>/gi;
  workingText = workingText.replace(antArtifactRegex, (match, attrsStr: string, content: string) => {
    const idMatch = attrsStr.match(/identifier=["']([^"']+)["']/i);
    const titleMatch = attrsStr.match(/title=["']([^"']+)["']/i);
    const typeMatch = attrsStr.match(/type=["']([^"']+)["']/i);
    const langMatch = attrsStr.match(/language=["']([^"']+)["']/i);

    const rawType = (typeMatch ? typeMatch[1] : '').toLowerCase();
    const rawLang = (langMatch ? langMatch[1] : '').toLowerCase();
    const title = titleMatch ? titleMatch[1] : 'Artifact';
    const id = idMatch ? idMatch[1] : `art-${Date.now()}-${artifacts.length + 1}`;

    let type: ExtractedArtifact['type'] = 'code';
    if (rawType.includes('html') || rawLang === 'html') type = 'html';
    else if (rawType.includes('svg') || rawLang === 'svg') type = 'svg';
    else if (rawType.includes('mermaid') || rawLang === 'mermaid') type = 'mermaid';
    else if (rawType.includes('react') || rawLang === 'jsx' || rawLang === 'tsx') type = 'react';
    else if (rawType.includes('markdown') || rawLang === 'markdown' || rawLang === 'md') type = 'markdown';

    const cleanContent = content.trim();
    const artifact: ExtractedArtifact = {
      id,
      title,
      type,
      language: rawLang || (type === 'html' ? 'html' : type === 'svg' ? 'xml' : type === 'mermaid' ? 'mermaid' : 'typescript'),
      content: cleanContent,
    };
    artifacts.push(artifact);

    return `\n\n:::artifact{id="${artifact.id}" title="${artifact.title}" type="${artifact.type}"}\n:::\n\n`;
  });

  // 2. Also detect standalone prominent code blocks that represent interactive artifacts
  // (e.g., HTML pages, SVG graphics, Mermaid diagrams, or large React components)
  const codeBlockRegex = /```(html|svg|mermaid|jsx|tsx)\s*\n([\s\S]*?)```/gi;
  let codeMatch: RegExpExecArray | null;

  // We only turn markdown code blocks into artifacts if there were no <antArtifact> tags found,
  // or if they represent substantial interactive artifacts (> 10 lines or > 200 chars).
  if (artifacts.length === 0) {
    let replacedText = '';
    let lastIndex = 0;
    let blockIndex = 1;

    while ((codeMatch = codeBlockRegex.exec(workingText)) !== null) {
      const fullMatch = codeMatch[0];
      const lang = codeMatch[1].toLowerCase();
      const code = codeMatch[2].trim();
      const matchIndex = codeMatch.index;

      // Check if it qualifies as an artifact (meaningful interactive visual or component)
      const lines = code.split('\n').length;
      const isSubstantial = (lang === 'html' && (code.includes('<!DOCTYPE') || code.includes('<html') || code.includes('<div') || lines >= 8)) ||
                            (lang === 'svg' && code.includes('<svg')) ||
                            (lang === 'mermaid' && (code.startsWith('graph') || code.startsWith('flowchart') || code.startsWith('sequenceDiagram') || code.startsWith('stateDiagram') || code.startsWith('erDiagram') || code.startsWith('classDiagram'))) ||
                            ((lang === 'jsx' || lang === 'tsx') && (code.includes('export default') || code.includes('return (') || lines >= 10));

      if (isSubstantial) {
        let type: ExtractedArtifact['type'] = 'code';
        let defaultTitle = 'Code';
        if (lang === 'html') {
          type = 'html';
          defaultTitle = 'Interactive Application';
        } else if (lang === 'svg') {
          type = 'svg';
          defaultTitle = 'Vector Illustration';
        } else if (lang === 'mermaid') {
          type = 'mermaid';
          defaultTitle = 'Architecture Diagram';
        } else if (lang === 'jsx' || lang === 'tsx') {
          type = 'react';
          defaultTitle = 'React Component';
        }

        // Try to extract a title from comments or first heading
        const titleMatch = code.match(/<!--\s*([^\n]+?)\s*-->/) ||
                           code.match(/\/\/\s*([^\n]+)/) ||
                           code.match(/<title>([^<]+)<\/title>/);
        const title = titleMatch ? titleMatch[1].replace(/[#/*]/g, '').trim() : `${defaultTitle} #${blockIndex}`;
        const id = `art-${Date.now()}-${blockIndex}`;

        const artifact: ExtractedArtifact = {
          id,
          title,
          type,
          language: lang,
          content: code,
        };
        artifacts.push(artifact);

        replacedText += workingText.slice(lastIndex, matchIndex);
        replacedText += `\n\n:::artifact{id="${artifact.id}" title="${artifact.title}" type="${artifact.type}"}\n:::\n\n`;
        lastIndex = matchIndex + fullMatch.length;
        blockIndex++;
      }
    }

    if (artifacts.length > 0) {
      replacedText += workingText.slice(lastIndex);
      workingText = replacedText;
    }
  }

  return {
    cleanText: workingText.trim(),
    artifacts,
  };
}

/**
 * Extracts <think>...</think> reasoning blocks from text
 */
export function extractThinking(text: string): {
  thinking: string | null;
  cleanText: string;
} {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
  const match = text.match(thinkRegex);
  if (!match) {
    return { thinking: null, cleanText: text };
  }
  const thinking = match[1].trim();
  const cleanText = text.replace(thinkRegex, '').trim();
  return { thinking: thinking || null, cleanText };
}
