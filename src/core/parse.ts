import { parseDocument, visit } from 'yaml';

/** What a SKILL.md says about itself. */
export type ParsedSkill = {
  /** Missing when the front matter has no name. */
  name?: string;
  description: string;
  /** The other front matter keys; a value YAML reads as other than a string is {@link Written}. */
  properties: Record<string, unknown>;
  /** The Markdown after the front matter. */
  body: string;
  warning?: string;
};

/**
 * Reads the YAML front matter between the leading `---` lines and the body
 * after it. Malformed front matter is not fatal: the skill keeps its directory
 * name and gets a warning.
 */
export function parseSkill(text: string): ParsedSkill {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return fallback('no front matter', text);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return fallback('front matter without a closing ---', text);
  const body = lines.slice(end + 1).join('\n');
  // The leading newline keeps YAML's line numbers equal to the file's.
  const document = parseDocument(`\n${lines.slice(1, end).join('\n')}`);
  const [error] = document.errors;
  if (error) return fallback(`malformed front matter: ${error.message.split('\n')[0].replace(/:$/, '')}`, body);
  // A number, a boolean, a null: as the file writes it, so 1.10 stays 1.10, not 1.1. A key, as its text.
  visit(document, {
    Scalar(key, node) {
      if (typeof node.value === 'string' || !node.source) return;
      node.value = key === 'key' ? node.source : new Written(node.source, node.value);
    },
  });
  const data: unknown = document.toJS();
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fallback('front matter is not a mapping', body);
  }
  const { name, description, ...properties } = data as Record<string, unknown>;
  return { name: asText(name) || undefined, description: asText(description), properties, body: trim(body) };
}

/** A front matter value YAML reads as other than a string: the text the file has, and what YAML reads. */
export class Written {
  readonly source: string;
  readonly value: unknown;
  constructor(source: string, value: unknown) {
    this.source = source;
    this.value = value;
  }
}

function fallback(reason: string, body: string): ParsedSkill {
  return { description: '', properties: {}, body: trim(body), warning: `${reason}; using the directory name` };
}

/** A string, or a number as the file writes it. */
function asText(value: unknown): string {
  if (value instanceof Written) return typeof value.value === 'number' || typeof value.value === 'bigint' ? value.source.trim() : '';
  return typeof value === 'string' ? value.trim() : '';
}

/** Without the blank lines around it; the first line keeps its indentation. */
function trim(body: string): string {
  return body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}
