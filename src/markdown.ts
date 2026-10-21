// A SKILL.md as HTML, for the web view. The file comes from any repository, so nothing in it runs:
// raw HTML is shown as text, and links and images keep only safe schemes.
import { Marked, type Tokens } from 'marked';
import { parseSkill, Written } from './core/parse.ts';

const LINKS = new Set(['http:', 'https:', 'mailto:', 'file:']);
const IMAGES = new Set(['http:', 'https:', 'file:']);

/** The front matter as a table, then the body as Markdown; `fileUrl` is where relative links point from. */
export function renderSkill(text: string, fileUrl: string): string {
  const parsed = parseSkill(text);
  return frontMatter(text, parsed) + renderMarkdown(parsed.body, fileUrl);
}

/** Markdown as HTML, with raw HTML escaped and links resolved against `fileUrl`. */
export function renderMarkdown(markdown: string, fileUrl: string): string {
  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    walkTokens(token) {
      if (token.type === 'link') token.href = resolve(token.href, fileUrl, LINKS) ?? '';
      if (token.type === 'image') token.href = image(resolve(token.href, fileUrl, IMAGES));
    },
    renderer: {
      // A block of HTML as code; inline HTML as the text it is.
      html: (token: Tokens.HTML | Tokens.Tag) =>
        'block' in token && token.block ? `<pre><code>${escape(token.text.trimEnd())}</code></pre>\n` : escape(token.text),
      link(token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        if (!token.href) return inner;
        const title = token.title ? ` title="${escape(token.title)}"` : '';
        const target = token.href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${escape(token.href)}"${title}${target}>${inner}</a>`;
      },
      image(token: Tokens.Image) {
        if (!token.href) return escape(token.text);
        return `<img src="${escape(token.href)}" alt="${escape(token.text)}"${token.title ? ` title="${escape(token.title)}"` : ''}>`;
      },
    },
  });
  return marked.parse(markdown) as string;
}

/** A table of the front matter's keys; malformed front matter as it is (its warning is the skill's, shown above it). */
function frontMatter(text: string, parsed: ReturnType<typeof parseSkill>): string {
  if (parsed.warning) {
    const lines = text.split(/\r?\n/);
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (lines[0].trim() !== '---' || end < 0) return '';
    return `<div class="front-matter"><pre>${escape(lines.slice(1, end).join('\n'))}</pre></div>`;
  }
  const entries: [string, unknown][] = [
    ...(parsed.name ? [['name', parsed.name] as [string, unknown]] : []),
    ...(parsed.description ? [['description', parsed.description] as [string, unknown]] : []),
    ...Object.entries(parsed.properties),
  ];
  if (entries.length === 0) return '';
  const rows = entries.map(([key, value]) => `<tr><th>${escape(key)}</th><td>${property(value)}</td></tr>`);
  return `<table class="front-matter"><tbody>${rows.join('')}</tbody></table>`;
}

function property(value: unknown): string {
  if (typeof value === 'string') return escape(value);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return escape(value.join(', '));
  return `<code>${escape(compact(value))}</code>`;
}

/** As JSON, but a number or a boolean as the file writes it. */
function compact(value: unknown): string {
  if (value instanceof Written) return value.source;
  if (Array.isArray(value)) return `[${value.map(compact).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${compact(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

/** The link against the file, if its scheme is allowed; `#anchors` stay on the page. */
function resolve(href: string, fileUrl: string, allowed: Set<string>): string | undefined {
  if (href.startsWith('#')) return allowed === LINKS ? href : undefined;
  try {
    const url = new URL(href, fileUrl);
    return allowed.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** An image in a GitHub repository is its raw file, not its page. */
function image(href: string | undefined): string {
  if (!href) return '';
  const url = new URL(href);
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) url.searchParams.set('raw', 'true');
  return url.href;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
