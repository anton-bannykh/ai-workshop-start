// The decisions in spec/web.md, checked on the web view's server for ./fixture and for the small
// GitHub repository answered in tests/helpers.ts, and on `skill-atlas serve` as a user runs it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openDirectory } from '../src/local.ts';
import { renderSkill } from '../src/markdown.ts';
import { createWebServer, listen } from '../src/web.ts';
import { CLI, EXAMPLE_COMMIT, EXAMPLE_MODIFIED, FIXTURE, open } from './helpers.ts';

const server = createWebServer(open);
const address = await listen(server, 0);
after(() => server.close());

/** `GET <path>` on the web view. */
async function get(path: string) {
  const response = await fetch(new URL(path, address));
  return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
}

async function scanned(repo: string) {
  const response = await get(`/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: JSON.parse(response.text) };
}

test('serve listens on 127.0.0.1 and prints the address', () => {
  assert.match(address, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const port = server.address();
  assert.ok(port && typeof port === 'object');
  assert.equal(port.address, '127.0.0.1');
});

test('the page: a field for a repository link, the list of skills and a place for the SKILL.md', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.match(page.text, /<input id="repo"[^>]*type="text"/);
  assert.match(page.text, /aria-label="Repository or organization link"/);
  assert.match(page.text, /<ul id="skills">/);
  assert.match(page.text, /<section id="skill">/);
  // The page asks the API, and links with ?repo= scan at once.
  assert.match(page.text, /fetch\(`\/api\/scan\?repo=\$\{encodeURIComponent\(repo\)\}&progress`\)/);
  assert.equal((await get('/?repo=github.com/JetBrains/example')).text, page.text);
});

test('Tab in the field completes the sample link while the field is empty or its start; otherwise Tab moves on', async () => {
  const page = (await get('/')).text;
  const sample = /<input id="repo"[^>]*placeholder="([^"]*)"/.exec(page)?.[1];
  assert.equal(sample, 'https://github.com/JetBrains/kotlin');
  const source = /const completion = (\([^)]*\) => .*);\n/.exec(page)?.[1];
  assert.ok(source, 'completion() is on the page');
  const completion = new Function(`return ${source}`)() as (value: string, sample: string) => string | null;
  assert.equal(completion('', sample), sample);
  assert.equal(completion('https://gi', sample), sample);
  assert.equal(completion(sample, sample), null);
  assert.equal(completion('https://github.com/JetBrains/MPS', sample), null);
  assert.equal(completion('/some/directory', sample), null);
  // Only a plain Tab completes, and only when there is something to complete; the field keeps the cursor at the end.
  assert.match(page, /\$\('repo'\)\.addEventListener\('keydown'/);
  assert.match(page, /event\.key !== 'Tab' \|\| event\.shiftKey/);
  assert.match(page, /if \(completed === null\) return;/);
  assert.match(page, /event\.preventDefault\(\);\n\s*\$\('repo'\)\.value = completed;/);
});

/** An element of the page, as far as its script uses one. */
class FakeElement {
  children: (FakeElement | string)[] = [];
  tagName = '';
  className = '';
  dataset: Record<string, string> = {};
  hidden = false;
  open = false;
  disabled = false;
  value = '';
  textContent = '';
  title = '';
  listeners: Record<string, ((event: object) => void)[]> = {};
  append(...nodes: (FakeElement | string)[]) { this.children.push(...nodes.filter((node) => node !== '')); }
  replaceChildren(...nodes: (FakeElement | string)[]) { this.children = []; this.append(...nodes); }
  addEventListener(type: string, listener: (event: object) => void) { (this.listeners[type] ??= []).push(listener); }
  setAttribute() {}
  setSelectionRange() {}
  get firstElementChild() { return this.children[0]; }
  /** The descendants with a tag, or with a class as `.<class>` selects them. */
  querySelectorAll(selector: string): FakeElement[] {
    const elements = this.children.filter((child): child is FakeElement => typeof child !== 'string');
    return elements.flatMap((child) => [
      ...((selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector.toUpperCase()) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  dispatch(type: string) { for (const listener of this.listeners[type] ?? []) listener({ preventDefault() {} }); }
}

/** Runs the page's script on a fake document, with `/?repo=<repo>` and the API answered by the web view at `at`. */
async function openPage(repo: string, at = address) {
  const page = (await get('/')).text;
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
  const elements = new Map<string, FakeElement>();
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) {
        const node = new FakeElement();
        node.hidden = new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(page);
        elements.set(id, node);
      }
      return elements.get(id)!;
    },
    createElement: (tag: string) => Object.assign(new FakeElement(), { tagName: tag.toUpperCase() }),
  };
  let scanned: Promise<unknown> = Promise.resolve();
  let scans = 0;
  const context = {
    document,
    history: { replaceState() {} },
    location: { search: `?repo=${encodeURIComponent(repo)}` },
    URLSearchParams,
    TextDecoderStream,
    fetch: (path: string) => {
      scans++;
      return (scanned = fetch(new URL(path, at)));
    },
  };
  runInNewContext(`'use strict';\n${script}`, context);
  const $ = document.getElementById;
  const done = async () => {
    await scanned;
    while ($('scan').disabled || $('summary').textContent === 'Scanning…') await new Promise(setImmediate);
  };
  await done();
  /** The names of the skills listed, and the names shown by the filter. */
  const listed = () => {
    const items = $('skills').children as FakeElement[];
    return { all: items.map((item) => item.dataset.name), shown: items.filter((item) => !item.hidden).map((item) => item.dataset.name) };
  };
  const type = (text: string) => { $('filter').value = text; $('filter').dispatch('input'); };
  const rescan = async () => { $('form').dispatch('submit'); await done(); };
  return { page, $, listed, type, rescan, scans: () => scans, chosen: () => ($('skill').children[0] as FakeElement).children[0] };
}

test('a filter on the top right: as you type, only the skills whose name contains it, ignoring case; no new scan', async () => {
  const { page, $, listed, type, rescan, scans, chosen } = await openPage(FIXTURE);
  // On the top right: the header's last field, pushed to the right of the repository field.
  const header = /<header>([\s\S]*?)<\/header>/.exec(page)?.[1] ?? '';
  assert.match(header, /<\/form>\s*<\/div>\s*<input id="filter" type="search"[^>]*aria-label="Filter skills by name"[^>]*>\s*$/);
  assert.match(page, /#filter \{[^}]*margin-left: auto;/);
  assert.match(page, /header \{ display: flex;/);

  const all = ['code-style', 'commits', 'release-checklist'];
  assert.deepEqual(listed(), { all, shown: all });
  assert.equal($('no-match').hidden, true);
  assert.equal(scans(), 1);

  type('co');
  assert.deepEqual(listed().shown, ['code-style', 'commits']);
  assert.equal($('summary').textContent, 'fixture · 2 of 3 skills');
  type('COMMITS');
  assert.deepEqual(listed().shown, ['commits']);
  type('  check ');
  assert.deepEqual(listed().shown, ['release-checklist']);
  // By name only: "Write" is in a description, not in a name.
  type('write');
  assert.deepEqual(listed().shown, []);
  assert.equal($('no-match').hidden, false);
  type('');
  assert.deepEqual(listed().shown, all);
  assert.equal($('no-match').hidden, true);
  // In the page: filtering asks nothing of the API; the summary counts every skill once the filter is empty.
  assert.equal($('summary').textContent, `fixture · 3 skills`);
  assert.equal(scans(), 1);

  // A filter typed before a scan applies to the new list, and the skill shown first is one it keeps.
  type('release');
  await rescan();
  assert.deepEqual(listed(), { all, shown: ['release-checklist'] });
  assert.equal(chosen(), 'release-checklist');
});

test('the filter on an organization: only the skills it keeps, only the repositories with one of them, and their counts', async () => {
  const { $, type } = await openPage('https://github.com/JetBrains');
  const groups = $('skills').children as FakeElement[];
  /** Each repository shown, with the names of its skills shown; groups stay as they were opened. */
  const shown = () => groups.filter((group) => !group.hidden).map((group) =>
    group.querySelectorAll('.skill').filter((item) => !item.hidden).map((item) => item.dataset.name));
  /** Each repository's count, in its heading. */
  const counts = () => groups.map((group) => group.querySelectorAll('.count')[0].textContent);
  // JetBrains/hidden has only its warning: shown, with no skills, until a filter is typed.
  assert.deepEqual(shown(), [['commits'], [], ['deploy'], ['build', 'lint']]);
  assert.deepEqual(counts(), ['1 skill', '0 skills', '1 skill', '2 skills']);
  assert.equal($('no-match').hidden, true);

  type('LI');
  assert.deepEqual(shown(), [['lint']]);
  assert.deepEqual(groups.map((group) => group.querySelectorAll('details')[0]?.open), [false, false, false, false]);
  // The counts are of the skills the filter keeps.
  assert.equal(counts()[3], '1 of 2 skills');
  assert.equal($('summary').textContent, 'JetBrains · 1 of 4 skills in 1 of 3 repositories · 6 scanned');
  type('i');
  assert.deepEqual(shown(), [['commits'], ['build', 'lint']]);
  assert.deepEqual(counts(), ['1 of 1 skill', '0 of 0 skills', '0 of 1 skill', '2 of 2 skills']);
  type('nothing');
  assert.deepEqual(shown(), []);
  assert.equal($('no-match').hidden, false);
  assert.equal($('summary').textContent, 'JetBrains · 0 of 4 skills in 0 of 3 repositories · 6 scanned');
  type('');
  assert.deepEqual(shown(), [['commits'], [], ['deploy'], ['build', 'lint']]);
  assert.deepEqual(counts(), ['1 skill', '0 skills', '1 skill', '2 skills']);
  assert.equal($('summary').textContent, 'JetBrains · 4 skills in 3 repositories · 6 scanned');
});

/** The text in an element and all it holds. */
const text = (node: FakeElement | string): string => (typeof node === 'string' ? node : node.textContent + node.children.map(text).join(''));

/** Chooses a skill in the list, as Enter on it does; the SKILL.md pane, after. */
const choose = ($: (id: string) => FakeElement, item: FakeElement) => {
  for (const listener of item.listeners.keydown) listener({ key: 'Enter' });
  return $('skill').children as FakeElement[];
};

test('a repository\'s own warnings are under its own heading, which has ❗, as has one with a skill that has a warning; none are listed at the top', async () => {
  const { $ } = await openPage('https://github.com/JetBrains');
  const groups = $('skills').children as FakeElement[];
  const headings = groups.map((group) => text(group.querySelectorAll('summary')[0]));
  assert.deepEqual(headings, ['JetBrains/example · 1 skill', '❗ JetBrains/hidden · 0 skills', 'JetBrains/secret · 1 skill', '❗ JetBrains/tools · 2 skills']);
  // In the group, only the repository's own: JetBrains/tools's warning is its skill's.
  const warnings = groups.map((group) => group.querySelectorAll('.warning').map(text));
  assert.deepEqual(warnings, [[], ['GitHub\'s GraphQL API answered nothing for it (R6); skipped'], [], []]);
  // Inside the group: collapsed with it, above its skills.
  const details = groups.map((group) => group.querySelectorAll('details')[0].children.map((child) => (child as FakeElement).tagName));
  assert.deepEqual(details[1], ['SUMMARY', 'P', 'UL']);
  assert.deepEqual(details[3], ['SUMMARY', 'UL']);
  assert.deepEqual($('messages').children, []);
});

test('a skill\'s warning is the skill\'s: in the list only ❗ by its name; choosing it shows the warning, above its SKILL.md', async () => {
  for (const [repo, name, warning] of [
    [FIXTURE, 'release-checklist', /^malformed front matter: [^\n]*; using the directory name$/],
    ['https://github.com/JetBrains', 'build', /^malformed front matter: Flow sequence [^\n]*; using the directory name$/],
  ] as const) {
    const { $ } = await openPage(repo);
    const items = $('skills').querySelectorAll('.skill');
    // Only the name and ❗ by it: no warning's text in the list.
    assert.deepEqual(items.filter((item) => item.querySelectorAll('.flag').length > 0).map((item) => item.dataset.name), [name]);
    const item = items.find((entry) => entry.dataset.name === name)!;
    assert.equal(text(item.querySelectorAll('.name')[0].children[0]), `❗ ${name}`);
    assert.deepEqual($('skills').querySelectorAll('.warning').map(text), repo === FIXTURE ? [] : ['GitHub\'s GraphQL API answered nothing for it (R6); skipped']);
    assert.deepEqual($('messages').children, []);
    // Chosen: its name, its link, when it was last modified, its warning, then the tabs; in either tab.
    const pane = choose($, item);
    assert.deepEqual(pane.map((child) => (child as FakeElement).className || (child as FakeElement).tagName), ['H2', 'link', 'DIV', 'warning', 'tabs', 'markdown', 'PRE']);
    assert.match(text(pane[3]), warning);
    // A skill without a warning: none above its SKILL.md.
    const other = items.find((entry) => entry.dataset.name !== name)!;
    assert.equal(choose($, other).filter((child) => (child as FakeElement).className === 'warning').length, 0);
  }
});

// The same as the web view, with a warning from listing the repository: one of its own, not a skill's.
const listing = createWebServer(async (input) => {
  const source = await open(input);
  return 'organization' in source ? source : { ...source, warnings: ['listing left a file out'] };
});
const listingAddress = await listen(listing, 0);
after(() => listing.close());

test('a repository\'s own warnings, out of the way: in a collapsed group, ❗ and how many', async () => {
  const { $ } = await openPage(FIXTURE, listingAddress);
  const [group] = $('messages').children as FakeElement[];
  assert.equal(group.tagName, 'DETAILS');
  assert.equal(group.open, false);
  assert.equal(text(group.children[0]), '❗ 1 warning');
  assert.deepEqual(group.children.slice(1).map(text), ['listing left a file out']);
});

test('while an organization is scanned, the page shows how far it is', async () => {
  const { $, rescan } = await openPage('https://github.com/JetBrains');
  const summaries: string[] = [];
  let text = '';
  Object.defineProperty($('summary'), 'textContent', { get: () => text, set: (value: string) => { text = value; summaries.push(value); } });
  await rescan();
  assert.equal(summaries[0], 'Scanning…');
  assert.match(summaries[1], /^Scanning… 0 of 3 repositories, 0 skills so far$/);
  assert.deepEqual(summaries.slice(-2), ['Scanning… 6 of 6 repositories, 4 skills so far', 'JetBrains · 4 skills in 3 repositories · 6 scanned']);
});

test('a GitHub repository: its skills with name, description, pinned link and their SKILL.md', async () => {
  const { status, body } = await scanned('https://github.com/JetBrains/example');
  assert.equal(status, 200);
  assert.deepEqual(body.repository, {
    id: 'JetBrains/example',
    organization: 'JetBrains',
    name: 'example',
    url: 'https://github.com/JetBrains/example',
    commit: EXAMPLE_COMMIT,
  });
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.skills, [
    {
      id: 'JetBrains/example:.claude/skills/commits/SKILL.md',
      repository: 'JetBrains/example',
      path: '.claude/skills/commits/SKILL.md',
      name: 'commits',
      description: 'Write commit messages the way this repository does. Use for every commit.',
      commit: EXAMPLE_COMMIT,
      copies: [],
      text: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
      modified: EXAMPLE_MODIFIED,
      warnings: [],
      link: { base: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/`, path: '.claude/skills/commits/SKILL.md' },
      html:
        '<table class="front-matter"><tbody><tr><th>name</th><td>commits</td></tr>'
        + '<tr><th>description</th><td>Write commit messages the way this repository does. Use for every commit.</td></tr>'
        + '</tbody></table><h1>Commits</h1>\n',
    },
  ]);
});

test('a directory: every skill sorted by name, its copies, its SKILL.md as in the file, and the skill\'s warning', async () => {
  const { status, body } = await scanned(FIXTURE);
  assert.equal(status, 200);
  assert.equal(body.repository.id, 'fixture');
  assert.deepEqual(
    body.skills.map((skill: { name: string; copies: string[] }) => [skill.name, skill.copies]),
    [['code-style', []], ['commits', ['agent/skills/commits/SKILL.md']], ['release-checklist', []]],
  );
  for (const skill of body.skills) {
    assert.equal(skill.text, readFileSync(join(FIXTURE, skill.path), 'utf8'));
    assert.equal(skill.link.base, `${pathToFileURL(FIXTURE).href}/`);
  }
  // The warning is the malformed skill's own, not the repository's.
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.skills.map((skill: { warnings: string[] }) => skill.warnings.length), [0, 0, 1]);
  assert.match(body.skills[2].warnings[0], /^malformed front matter: /);
});

test('the page shows the SKILL.md formatted, with a Raw tab for the file as it is', async () => {
  const page = (await get('/')).text;
  assert.match(page, /element\('div', \{ id: 'formatted', className: 'markdown', innerHTML: skill\.html \}\)/);
  assert.match(page, /element\('pre', \{ id: 'text' \}, skill\.text\)/);
  assert.match(page, /tab\('formatted', 'Formatted'\), tab\('raw', 'Raw'\)/);
  // The list of skills is styled on its own: a SKILL.md's lists keep their bullets.
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '';
  assert.doesNotMatch(style, /^\s*(?:ul|ol|li)\b/m);
});

test('the list of repositories and skills and the SKILL.md scroll independently, the page itself does not', async () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec((await get('/')).text)?.[1] ?? '';
  /** The declarations of a rule, by its selector; the last one wins, as in CSS. */
  const rule = (selector: string) => {
    const declarations: Record<string, string> = {};
    for (const [, selectors, body] of style.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!selectors.split(',').map((s) => s.trim()).includes(selector)) continue;
      for (const declaration of body.split(';')) {
        const [property, ...value] = declaration.split(':');
        if (value.length) declarations[property.trim()] = value.join(':').trim();
      }
    }
    return declarations;
  };
  // The page is as tall as the window, and never scrolls as a whole...
  const body = rule('body');
  assert.match(body.height ?? '', /^100d?vh$/);
  assert.equal(body.overflow, 'hidden');
  assert.equal(body.display, 'flex');
  assert.equal(body['flex-direction'], 'column');
  // ...the two panes take the rest of it, however tall the header is, and no taller...
  const main = rule('main');
  assert.equal(main.flex, '1');
  assert.equal(main['min-height'], '0');
  assert.equal(main['grid-template-rows'], 'minmax(0, 1fr)');
  // ...and each scrolls on its own.
  for (const pane of ['#list', '#skill']) {
    assert.equal(rule(pane).overflow, 'auto', pane);
    assert.equal(rule(pane)['min-height'], '0', pane);
  }
});

const FILE = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;

test('formatting: the front matter as a table, the Markdown rendered', () => {
  const html = renderSkill(
    '---\nname: commits\ndescription: Writes commits.\nallowed-tools: [Read, Grep]\nmetadata: { level: 2 }\n---\n'
      + '# Commits\n\nUse **bold** and `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sh\nnpm test\n```\n\n> quoted\n',
    FILE,
  );
  assert.equal(
    html,
    [
      '<table class="front-matter"><tbody><tr><th>name</th><td>commits</td></tr><tr><th>description</th><td>Writes commits.</td></tr>'
        + '<tr><th>allowed-tools</th><td>Read, Grep</td></tr><tr><th>metadata</th><td><code>{&#34;level&#34;:2}</code></td></tr></tbody></table>'
        + '<h1>Commits</h1>',
      '<p>Use <strong>bold</strong> and <code>code</code>.</p>',
      '<ul>\n<li>one</li>\n<li>two</li>\n</ul>',
      '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>',
      '<pre><code class="language-sh">npm test\n</code></pre>',
      '<blockquote>\n<p>quoted</p>\n</blockquote>',
      '',
    ].join('\n'),
  );
});

test('formatting: nothing in the file runs; raw HTML is text (a block as code), unsafe links and images are dropped', () => {
  const html = renderSkill(
    '<script>alert(1)</script>\n\nInline <img src=x onerror=alert(1)> here.\n\n'
      + '[js](javascript:alert(1)) [data](data:text/html,x) ![svg](data:image/svg+xml,x) [mail](mailto:a@example.com) [web](https://example.com "T\'s")\n',
    FILE,
  );
  assert.doesNotMatch(html, /<script|<img src="?x|javascript:|data:/);
  assert.equal(
    html,
    '<pre><code>&#60;script&#62;alert(1)&#60;/script&#62;</code></pre>\n'
      + '<p>Inline &#60;img src=x onerror=alert(1)&#62; here.</p>\n'
      + '<p>js data svg <a href="mailto:a@example.com" target="_blank" rel="noopener noreferrer">mail</a> '
      + '<a href="https://example.com/" title="T&#39;s" target="_blank" rel="noopener noreferrer">web</a></p>\n',
  );
});

test('formatting: relative links point into the repository at the scanned commit; GitHub images to the raw file', () => {
  const base = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/`;
  const html = renderSkill('[ref](references/style.md) [up](../other/SKILL.md) [here](#usage) ![diagram](img/flow.png)\n', FILE);
  assert.equal(
    html,
    `<p><a href="${base}references/style.md" target="_blank" rel="noopener noreferrer">ref</a> `
      + `<a href="https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/other/SKILL.md" target="_blank" rel="noopener noreferrer">up</a> `
      + '<a href="#usage">here</a> '
      + `<img src="${base}img/flow.png?raw=true" alt="diagram"></p>\n`,
  );
  const local = pathToFileURL(join(FIXTURE, '.claude/skills/commits/SKILL.md')).href;
  assert.match(renderSkill('![x](x.png)\n', local), new RegExp(`<img src="${pathToFileURL(FIXTURE).href}/\\.claude/skills/commits/x\\.png"`));
});

test('formatting: malformed front matter is shown as it is; its warning is the skill\'s, shown above it', async () => {
  const { body } = await scanned(FIXTURE);
  const skill = body.skills.find((entry: { name: string }) => entry.name === 'release-checklist');
  const text = readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8');
  const raw = text.split('\n').slice(1, text.split('\n').indexOf('---', 1)).join('\n');
  assert.ok(skill.html.startsWith(
    '<div class="front-matter">'
      + `<pre>${raw.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}</pre></div>`,
  ), skill.html);
  assert.deepEqual(skill.warnings, ['malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name']);
  // No front matter at all: only the Markdown.
  assert.equal(renderSkill('# Title\n', FILE), '<h1>Title</h1>\n');
});

test('a clear message → 400 with the error', async () => {
  assert.deepEqual(await scanned(''), { status: 400, body: { error: 'Enter a GitHub repository or organization URL, or a directory' } });
  const missing = await scanned(join(FIXTURE, 'no-such-directory'));
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /^Not a GitHub URL or a readable directory: .*no-such-directory$/);
  const offline = await scanned('https://github.com/JetBrains/not-answered');
  assert.equal(offline.status, 400);
  assert.match(offline.body.error, /^Cannot reach GitHub: not recorded: /);
});

test('unknown paths → 404; other methods → 405', async () => {
  const unknown = await get('/nothing-here');
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.text), { error: 'Not found: /nothing-here' });
  const posted = await fetch(new URL('/api/scan?repo=x', address), { method: 'POST' });
  assert.equal(posted.status, 405);
});

test('another Host than the local address → 403', async () => {
  const { port } = new URL(address);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const asked = request({ host: '127.0.0.1', port, path: '/', headers: { Host: 'evil.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    asked.on('error', reject);
    asked.end();
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
});

test('serve: a bad port or a port in use → a clear message, exit code 1', async () => {
  const errors: string[] = [];
  const context = { open, print: () => {}, error: (text: string) => errors.push(text) };
  assert.equal(await run(['serve', 'abc'], { ...context, serve: async () => '' }), 1);
  assert.equal(await run(['serve'], context), 1);
  const { port } = new URL(address);
  assert.equal(await run(['serve', port], { ...context, serve: (p) => listen(createWebServer(open), p) }), 1);
  assert.deepEqual(errors, [
    'Usage: skill-atlas serve [port]',
    'serve runs only from the command line',
    `Port ${port} is in use; try another: skill-atlas serve <port>`,
  ]);
});

test('./skill-atlas serve: prints the address, serves the page and stores nothing', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  const child = spawn(process.execPath, [CLI, 'serve', '0'], { cwd });
  t.after(() => {
    child.kill();
    rmSync(cwd, { recursive: true, force: true });
  });
  const line = await new Promise<string>((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('\n')) resolve(stdout);
    });
    child.on('error', reject);
    child.on('close', (code) => reject(new Error(`exited with ${code}`)));
  });
  const served = /^Skill Atlas at (http:\/\/127\.0\.0\.1:\d+\/)\n$/.exec(line);
  assert.ok(served, line);
  assert.match(await (await fetch(served[1])).text(), /<title>Skill Atlas<\/title>/);
  const scan = (await (await fetch(`${served[1]}api/scan?repo=${encodeURIComponent(FIXTURE)}`)).json()) as { skills: unknown[] };
  assert.equal(scan.skills.length, 3);
  assert.deepEqual(readdirSync(cwd), []);
});

test('when a skill was last modified: in grey, DD-MM-YY, by its name in the list and under its link when chosen', async () => {
  const { page, $ } = await openPage('https://github.com/JetBrains/example');
  // Not in the way: smaller, and in the muted grey of the description.
  assert.match(page, /\.modified \{ color: var\(--muted\); font-size: 12px; font-weight: normal; \}/);
  assert.match(page, /#skills \.name \.modified \{ margin-left: auto; \}/);
  const [item] = $('skills').querySelectorAll('.skill');
  const [date] = item.querySelectorAll('.modified');
  assert.equal(text(date), '14-03-26');
  assert.equal(date.title, `Last modified ${EXAMPLE_MODIFIED}`);
  assert.ok(item.querySelectorAll('.name')[0].children.includes(date), 'on the name\'s line');
  const pane = choose($, item);
  assert.deepEqual(pane.flatMap((child) => typeof child === 'string' ? [] : child.querySelectorAll('.modified')).map(text), ['Last modified 14-03-26']);
});

test('a skill without a date: nothing in its place', async () => {
  const undated = createWebServer(async (input) => ({ ...(await openDirectory(input)), modified: undefined }));
  const at = await listen(undated, 0);
  after(() => undated.close());
  const { $ } = await openPage(FIXTURE, at);
  const items = $('skills').querySelectorAll('.skill');
  assert.equal(items.length, 3);
  assert.deepEqual($('skills').querySelectorAll('.modified'), []);
  const pane = choose($, items[0]);
  assert.deepEqual(pane.map((child) => (child as FakeElement).className || (child as FakeElement).tagName), ['H2', 'link', 'tabs', 'markdown', 'PRE']);
});

// Issue #22: the full link, with its commit, took more room in the list than the name and the description.
test('the list: each skill\'s path, not its whole link; the description at most two lines; the whole of both on hover', async () => {
  const { page, $ } = await openPage('https://github.com/JetBrains/example');
  const [item] = $('skills').querySelectorAll('.skill');
  const full = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;
  // The path, a link to the SKILL.md: its directory in grey, SKILL.md in bold; the whole link on hover.
  assert.deepEqual(item.querySelectorAll('.link'), []);
  const [path] = item.querySelectorAll('.path') as (FakeElement & { href: string })[];
  assert.equal(path.tagName, 'A');
  assert.equal(path.href, full);
  assert.equal(path.title, full);
  assert.equal(text(path), '.claude/skills/commits/SKILL.md');
  assert.deepEqual(path.children.map((child) => (child as FakeElement).tagName), ['SPAN', 'B']);
  assert.equal(text(path.children[1]), 'SKILL.md');
  assert.match(page, /\.path \{[^}]*color: var\(--muted\);/);
  // The description: cut after two lines; the whole of it on hover.
  const [description] = item.querySelectorAll('.description');
  assert.equal(description.title, 'Write commit messages the way this repository does. Use for every commit.');
  assert.match(page, /#skills \.description \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
  // Chosen: the whole link, its path in bold, as before.
  const pane = choose($, item);
  const link = pane.find((child) => (child as FakeElement).className === 'link') as FakeElement & { href: string };
  assert.equal(link.href, full);
  assert.equal(text(link), full);
});
