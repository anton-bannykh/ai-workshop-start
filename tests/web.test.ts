// The decisions in spec/web.md, checked on the web view's server for ./fixture and for the small
// GitHub repository answered in tests/helpers.ts, and on `skill-atlas serve` as a user runs it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { AtlasError } from '../src/core/errors.ts';
import type { OrganizationSource, Source } from '../src/core/scan.ts';
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
  placeholder = '';
  textContent = '';
  title = '';
  href = '';
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

/**
 * Runs the page's script on a fake document, with `/?repo=<repo><query>` and the API answered by the
 * web view at `at`; once its scan is done, unless `wait` is false: then `done` waits for it.
 */
async function openPage(repo: string, at = address, query = '', wait = true) {
  const page = (await get('/')).text;
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
  const elements = new Map<string, FakeElement>();
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) {
        const node = new FakeElement();
        node.hidden = new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(page);
        node.placeholder = new RegExp(`id="${id}"[^>]*\\splaceholder="([^"]*)"`).exec(page)?.[1] ?? '';
        elements.set(id, node);
      }
      return elements.get(id)!;
    },
    createElement: (tag: string) => Object.assign(new FakeElement(), { tagName: tag.toUpperCase() }),
  };
  let scanned: Promise<unknown> = Promise.resolve();
  let scans = 0;
  let shownAt = '';
  const context = {
    document,
    history: { replaceState(_state: unknown, _title: string, url: string) { shownAt = url; } },
    location: { search: `?repo=${encodeURIComponent(repo)}${query}` },
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
  if (wait) await done();
  /** The names of the skills listed, and the names shown by the filter. */
  const listed = () => {
    const items = $('skills').children as FakeElement[];
    return { all: items.map((item) => item.dataset.name), shown: items.filter((item) => !item.hidden).map((item) => item.dataset.name) };
  };
  const type = (text: string) => { $('filter').value = text; $('filter').dispatch('input'); };
  const rescan = async () => { $('form').dispatch('submit'); await done(); };
  /** What the address says is shown. */
  const url = () => shownAt;
  return { page, $, listed, type, rescan, done, scans: () => scans, url, chosen: () => ($('skill').children[0] as FakeElement).children[0] };
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
    // Chosen: its name, its link, when it was last modified, the link to similar skills, its warning, then the tabs; in either tab.
    const pane = choose($, item);
    assert.deepEqual(pane.map((child) => (child as FakeElement).className || (child as FakeElement).tagName), ['H2', 'link', 'DIV', 'similar', 'warning', 'tabs', 'markdown', 'PRE']);
    assert.match(text(pane[4]), warning);
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
  assert.match(summaries[1], /^Scanning… 0 of 6 repositories, 0 skills so far$/);
  assert.deepEqual(summaries.slice(-2), ['Scanning… 6 of 6 repositories, 4 skills so far', 'JetBrains · 4 skills in 3 repositories · 6 scanned']);
});

// The web view's page, and its scan held back halfway: its lines up to the second repository, the rest once let go.
let letGo = () => {};
const halfway = createServer(async (request, response) => {
  const answer = await fetch(new URL(request.url ?? '/', address));
  if (!request.url?.startsWith('/api/scan')) return response.end(await answer.text());
  const lines = (await answer.text()).trimEnd().split('\n');
  const second = lines.findIndex((line, index) => line.startsWith('{"repository"') && lines.slice(0, index).some((other) => other.startsWith('{"repository"')));
  response.write(lines.slice(0, second + 1).map((line) => `${line}\n`).join(''));
  await new Promise<void>((resolve) => { letGo = resolve; });
  response.end(lines.slice(second + 1).map((line) => `${line}\n`).join(''));
});
const halfwayAddress = await listen(halfway, 0);
after(() => halfway.close());

test('while an organization is scanned, each repository is listed as soon as it is: open it, choose a skill, filter; the result leaves them so', async () => {
  const { $, done, chosen, type } = await openPage('https://github.com/JetBrains', halfwayAddress, '', false);
  while ($('skills').querySelectorAll('.repository').length < 2) await new Promise(setImmediate);
  assert.match($('summary').textContent, /^Scanning… \d of 6 repositories, \d skills? so far$/);
  // In their places by id, collapsed, Expand all above them.
  const heading = (item: FakeElement) => text(item.querySelectorAll('summary')[0]);
  const listed = () => ($('skills').children as FakeElement[]).map(heading);
  assert.deepEqual(listed(), [...listed()].sort());
  assert.equal(listed().length, 2);
  assert.equal($('toggle').textContent, 'Expand all');
  assert.equal(text($('skill')), 'Open a repository, then choose a skill to see its SKILL.md.');

  const [first] = $('skills').children as FakeElement[];
  const group = first.querySelectorAll('details')[0];
  group.open = true;
  const [skill] = first.querySelectorAll('.skill');
  choose($, skill);
  const name = skill.dataset.name;
  assert.equal(text(chosen()), name);

  // The filter, typed while scanning, keeps only what it matches of what comes after too.
  type('deploy');
  letGo();
  await done();
  const shown = () => ($('skills').children as FakeElement[]).filter((item) => !item.hidden).map(heading);
  assert.deepEqual(shown(), ['JetBrains/secret · 1 of 1 skill']);
  assert.equal($('summary').textContent, 'JetBrains · 1 of 4 skills in 1 of 3 repositories · 6 scanned');
  type('');
  assert.equal($('summary').textContent, 'JetBrains · 4 skills in 3 repositories · 6 scanned');
  assert.deepEqual(listed(), ['JetBrains/example · 1 skill', '❗ JetBrains/hidden · 0 skills', 'JetBrains/secret · 1 skill', '❗ JetBrains/tools · 2 skills']);
  // The same group, still open; the same skill, still shown.
  assert.equal(($('skills').children as FakeElement[]).find((item) => item === first)?.querySelectorAll('details')[0].open, true);
  assert.equal(text(chosen()), name);
});

// The same scan, stopped after its second repository, as by GitHub's rate limit.
const stopping = createServer(async (request, response) => {
  const answer = await fetch(new URL(request.url ?? '/', address));
  if (!request.url?.startsWith('/api/scan')) return response.end(await answer.text());
  const lines = (await answer.text()).trimEnd().split('\n');
  const second = lines.findIndex((line, index) => line.startsWith('{"repository"') && lines.slice(0, index).some((other) => other.startsWith('{"repository"')));
  response.end([...lines.slice(0, second + 1), '{"status":400,"error":"GitHub rate limit reached; try again in a minute"}'].map((line) => `${line}\n`).join(''));
});
const stoppingAddress = await listen(stopping, 0);
after(() => stopping.close());

test('a scan that stops halfway: the repositories it listed stay, the error above them', async () => {
  const { $ } = await openPage('https://github.com/JetBrains', stoppingAddress);
  assert.equal($('skills').querySelectorAll('.repository').length, 2);
  assert.deepEqual($('messages').children.map(text), ['GitHub rate limit reached; try again in a minute']);
  assert.equal($('summary').textContent, '');
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
  assert.deepEqual(pane.map((child) => (child as FakeElement).className || (child as FakeElement).tagName), ['H2', 'link', 'similar', 'tabs', 'markdown', 'PRE']);
});

/** A repository in memory, on GitHub at commit `c0ffee`: its skills' SKILL.md files, by directory, in .agents/skills. */
function inMemory(id: string, files: Record<string, string>, warnings: string[] = []): Source {
  const [organization, name] = id.split('/');
  return {
    repository: { id, organization, name, url: `https://github.com/${id}`, commit: 'c0ffee' },
    paths: Object.keys(files).map((directory) => `.agents/skills/${directory}/SKILL.md`),
    warnings,
    read: async (path) => new TextEncoder().encode(files[path.split('/')[2]]),
  };
}

const REVIEW = '---\nname: code-review\ndescription: Review a change.\n---\nRead the whole diff.\nCheck the tests.\nBe kind.\n';
const SECURITY = '---\nname: security-review\ndescription: Review it for security.\n---\nRead the whole diff.\nLook for secrets.\nBe kind.\n';
const RELEASE = '---\nname: release\n---\nCheck main is green.\nTag it.\n';
const NOTES = '---\nname: release-notes\n---\nCheck main is green.\nList the changes.\n';

/** Team/app and Team/web, and Team itself, an organization of three repositories, one without skills. */
const TEAM: Record<string, Source> = {
  'https://github.com/Team/app': inMemory('Team/app', { 'code-review': REVIEW, release: RELEASE, deploy: '---\nname: deploy\n---\n', broken: '---\nname: [x\n---\n' }, ['listing left a file out']),
  'https://github.com/Team/web': inMemory('Team/web', { 'security-review': SECURITY, 'release-notes': NOTES }),
};
const team: OrganizationSource = {
  organization: { id: 'Team', url: 'https://github.com/Team' },
  warnings: ['GitHub counts 4 repositories; 3 listed'],
  async list(listing) {
    listing.total(3);
    listing.checked(1);
    for (const source of Object.values(TEAM)) listing.repository({ id: source.repository.id, open: async () => source });
  },
};
const teamServer = createWebServer(async (input) => {
  if (input === 'https://github.com/Team') return team;
  if (TEAM[input]) return TEAM[input];
  throw new AtlasError(`Repository not found: ${input}`);
});
const teamAddress = await listen(teamServer, 0);
after(() => teamServer.close());

async function scanOf(repo: string) {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent(repo)}`, teamAddress));
  return { status: response.status, body: JSON.parse(await response.text()) };
}

test('/api/scan: the groups of skills whose names share a word; none when no two do', async () => {
  const { status, body } = await scanOf('https://github.com/Team/app');
  assert.equal(status, 200);
  assert.equal(body.repository.id, 'Team/app');
  assert.equal(body.skills.length, 4);
  // No two of its skills share a word of their names.
  assert.deepEqual(body.groups, []);
});

test('/api/scan for an organization: the groups across all its repositories, each skill by its id, a kind for each of its lines', async () => {
  const { status, body } = await scanOf('https://github.com/Team');
  assert.equal(status, 200);
  assert.deepEqual(body.groups.map(({ words, skills }: { words: string[]; skills: { id: string }[] }) => [words, skills.map(({ id }) => id)]), [
    [['release'], ['Team/app:.agents/skills/release/SKILL.md', 'Team/web:.agents/skills/release-notes/SKILL.md']],
    [['review'], ['Team/app:.agents/skills/code-review/SKILL.md', 'Team/web:.agents/skills/security-review/SKILL.md']],
  ]);
  // ---, name, description, ---, Read the whole diff., Look for secrets., Be kind.
  assert.deepEqual(body.groups[1].skills[1], {
    id: 'Team/web:.agents/skills/security-review/SKILL.md',
    kinds: ['all', 'own', 'own', 'all', 'all', 'own', 'all'],
  });
  // The skills themselves are the repositories', once.
  assert.equal(body.repositories.flatMap(({ skills }: { skills: unknown[] }) => skills).length, 6);
});

test('/api/scan&progress: the groups in the result; the page of groups is no page of its own', async () => {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/Team')}&progress`, teamAddress));
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.at(-2), { progress: { done: 3, total: 3, skills: 6 } });
  assert.equal(lines.at(-1).result.groups.length, 2);
  for (const path of ['/groups', '/api/groups']) assert.equal((await fetch(new URL(path, teamAddress))).status, 404);
});

/** The first element under `node`, itself included, with that id. */
const byId = (node: FakeElement | string, id: string): FakeElement | undefined => {
  if (typeof node === 'string') return undefined;
  if ((node as FakeElement & { id?: string }).id === id) return node;
  for (const child of node.children) {
    const found = byId(child, id);
    if (found) return found;
  }
  return undefined;
};

const click = (node: FakeElement, event: object = {}) => { for (const listener of node.listeners.click ?? []) listener({ preventDefault() {}, ...event }); };

/** The page, opened for `repo` with `query`, and what its groups show. */
async function openGroups(repo: string, query = '&view=groups') {
  const opened = await openPage(repo, teamAddress, query);
  const { $ } = opened;
  const items = () => $('groups').children as FakeElement[];
  return {
    ...opened,
    /** Each group listed, `<words> · <members>`, the shown ones. */
    groups: () => items().filter((item) => !item.hidden).map((item) => `${text(item.querySelectorAll('.words')[0])} / ${text(item.querySelectorAll('.members')[0])}`),
    items,
    /** The chosen group's heading, and each column: its skill's name and each line's kind. */
    chosen: () => ({
      heading: text(byId($('group'), 'group') ?? ($('group').children[0] as FakeElement)),
      columns: byId($('group'), 'columns')?.children.map((column) => {
        const node = column as FakeElement;
        return { className: node.className, name: text(node.querySelectorAll('.name')[0]), kinds: node.querySelectorAll('.lines')[0].children.map((line) => (line as FakeElement).className).join(' ') };
      }),
    }),
    pane: (id: string) => byId($('group'), id)!,
  };
}

test('the groups: each group, its words and its skills; the first chosen, its skills side by side, each line marked', async () => {
  const { $, groups, chosen, pane } = await openGroups('https://github.com/Team');
  assert.equal($('skills-view').hidden, true);
  assert.equal($('groups-view').hidden, false);
  assert.equal($('groups-summary').textContent, 'Team · 2 groups · 6 skills · 3 scanned');
  assert.deepEqual(groups(), ['release2 skills / release, release-notes', 'review2 skills / code-review, security-review']);
  // The words the group shares are marked in each name.
  const members = $('groups').children[1] as FakeElement;
  assert.deepEqual(members.querySelectorAll('mark').map(text), ['review', 'review']);
  assert.equal(text(($('group').children as FakeElement[])[0]), 'release');
  assert.equal(text(($('group').children as FakeElement[])[1]), '2 skills · 1 line in all of them');
  assert.deepEqual(chosen().columns, [
    { className: 'column', name: 'release', kinds: 'all own all all own' },
    { className: 'column', name: 'release-notes', kinds: 'all own all all own' },
  ]);
  // Side by side first; the other tab hidden.
  assert.equal(pane('side-by-side').hidden, false);
  assert.equal(pane('two').hidden, true);
  // The warnings, all of them, out of the way; each naming its repository, and its SKILL.md.
  const warnings = $('groups-messages').children[0] as FakeElement;
  assert.equal(text(warnings.children[0]), '❗ 3 warnings');
  assert.deepEqual(warnings.children.slice(1, 3).map(text), ['GitHub counts 4 repositories; 3 listed', 'Team/app: listing left a file out']);
  assert.match(text(warnings.children[3]), /^Team\/app: \.agents\/skills\/broken\/SKILL\.md: malformed front matter: /);
});

test('the groups: Compare two, the first two at first, any two chosen; the lines the same, and each one\'s own', async () => {
  const { $, items, pane } = await openGroups('https://github.com/Team');
  for (const listener of items()[1].listeners.keydown) listener({ key: 'Enter' });
  click(pane('tab-two'));
  assert.equal(pane('side-by-side').hidden, true);
  assert.equal(pane('two').hidden, false);
  const rows = () => (pane('diff').children[0] as FakeElement).children.map((row) => `${(row as FakeElement).className} ${text(row)}`);
  assert.deepEqual(rows(), [
    'same ---',
    'removed name: code-review',
    'removed description: Review a change.',
    'added name: security-review',
    'added description: Review it for security.',
    'same ---',
    'same Read the whole diff.',
    'removed Check the tests.',
    'added Look for secrets.',
    'same Be kind.',
  ]);
  // The front matter's --- says nothing: not counted.
  assert.equal(text(pane('pair').querySelectorAll('.stats')[0]), '2 lines the same · 3 only in the first · 3 only in the second');
  // The other way around.
  pane('left').value = '1';
  pane('right').value = '0';
  pane('left').dispatch('change');
  assert.equal(rows()[1], 'removed name: security-review');
  assert.equal($('groups-summary').textContent, 'Team · 2 groups · 6 skills · 3 scanned');
});

test('the groups: the same filter keeps the groups with a skill whose name contains it, ignoring case; no new scan', async () => {
  const { $, groups, type, scans } = await openGroups('https://github.com/Team');
  type(' SECUR ');
  assert.deepEqual(groups(), ['review2 skills / code-review, security-review']);
  assert.equal($('groups-summary').textContent, 'Team · 1 of 2 groups · 6 skills · 3 scanned');
  assert.equal($('groups-no-match').hidden, true);
  // The skills are filtered by it too, for when they are back.
  assert.match($('summary').textContent, /^Team · 1 of 6 skills/);
  type('deploy');
  assert.deepEqual(groups(), []);
  assert.equal($('groups-no-match').hidden, false);
  type('');
  assert.equal(groups().length, 2);
  assert.equal(scans(), 1);
});

test('the groups opened for a skill: the first of its groups chosen, the skill marked there and compared first', async () => {
  const id = 'Team/web:.agents/skills/security-review/SKILL.md';
  const { $, chosen, pane } = await openGroups('https://github.com/Team', `&view=groups&skill=${encodeURIComponent(id)}`);
  assert.equal(text(($('group').children as FakeElement[])[0]), 'review');
  assert.deepEqual(chosen().columns!.map(({ className }) => className), ['column', 'column wanted']);
  const [release, review] = $('groups').children as FakeElement[];
  assert.deepEqual(review.querySelectorAll('.wanted').map(text), ['security-review']);
  assert.deepEqual(release.querySelectorAll('.wanted'), []);
  assert.equal(pane('left').value, '1');
  assert.equal(pane('right').value, '0');
});

test('the groups for a skill in no group, or for a repository with none: they say so', async () => {
  const deploy = await openGroups('https://github.com/Team', `&view=groups&skill=${encodeURIComponent('Team/app:.agents/skills/deploy/SKILL.md')}`);
  assert.equal(text(deploy.$('group').children[0]), 'No other skill here shares a word of its name with .agents/skills/deploy/SKILL.md.');
  const app = await openGroups('https://github.com/Team/app');
  assert.equal(app.$('groups-summary').textContent, 'Team/app · 0 groups · 4 skills');
  assert.equal(text(app.$('group').children[0]), 'No two skills here share a word of their names.');
  const missing = await openGroups('https://github.com/Team/none');
  assert.equal(text(missing.$('groups-messages').children[0]), 'Repository not found: https://github.com/Team/none');
});

// Review of #25: the groups were a page of their own, which scanned again and lost the page's state.
test('Skills / Groups: two views of the one scan; switching keeps the field, the filter, and each view as it was left', async () => {
  const { page, $, type, scans, url, items } = await openGroups('https://github.com/Team', '');
  assert.match(page, /<nav><button id="to-skills" type="button" aria-current="page">Skills<\/button><button id="to-groups" type="button">Groups<\/button><\/nav>/);
  // One field, one Tab, one filter: in the header, above both views.
  assert.equal(page.match(/<input id="repo"/g)?.length, 1);
  assert.equal(page.match(/<input id="filter"/g)?.length, 1);
  assert.match(page, /<\/header>\s*<main id="skills-view">[\s\S]*<\/main>\s*<main id="groups-view" hidden>/);
  assert.match(page, /main\[hidden\] \{ display: none; \}/);
  assert.equal($('skills-view').hidden, false);
  assert.equal($('groups-view').hidden, true);
  assert.equal(url(), `?repo=${encodeURIComponent('https://github.com/Team')}`);
  // Some state on each side: a repository open and a skill chosen; another group chosen, compared.
  type('review');
  const [, web] = $('skills').querySelectorAll('details');
  web.open = true;
  const security = $('skills').querySelectorAll('.skill').find((item) => item.dataset.name === 'security-review')!;
  const pane = choose($, security);
  click($('to-groups'));
  assert.equal($('skills-view').hidden, true);
  assert.equal($('groups-view').hidden, false);
  assert.equal(url(), `?repo=${encodeURIComponent('https://github.com/Team')}&view=groups`);
  for (const listener of items()[1].listeners.keydown) listener({ key: 'Enter' });
  click(byId($('group'), 'tab-two')!);
  const group = $('group').children;
  click($('to-skills'));
  assert.equal($('skills-view').hidden, false);
  assert.equal(url(), `?repo=${encodeURIComponent('https://github.com/Team')}`);
  // Back: as it was left.
  assert.equal($('filter').value, 'review');
  assert.equal($('repo').value, 'https://github.com/Team');
  assert.equal(web.open, true);
  assert.equal($('skill').children, pane);
  click($('to-groups'));
  assert.equal($('group').children, group);
  assert.equal(byId($('group'), 'two')!.hidden, false);
  assert.equal(scans(), 1);
});

test('Similar skills →: the groups, in the page, that skill\'s first group chosen and it marked; no new scan', async () => {
  const { $, scans, url, chosen } = await openGroups('https://github.com/Team', '');
  const items = $('skills').querySelectorAll('.skill');
  const security = items.find((item) => item.dataset.name === 'security-review')!;
  const similar = choose($, security).find((child) => (child as FakeElement).className === 'similar') as FakeElement;
  assert.equal(text(similar), 'Similar skills →');
  // A link too, to open in a new tab: the page with the groups for that skill.
  const id = 'Team/web:.agents/skills/security-review/SKILL.md';
  const address = `?repo=${encodeURIComponent('https://github.com/Team')}&view=groups&skill=${encodeURIComponent(id)}`;
  assert.equal(similar.href, address);
  // Ctrl+click: the browser opens the link; nothing changes here.
  let prevented = false;
  click(similar, { ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal($('groups-view').hidden, true);
  click(similar);
  assert.equal($('groups-view').hidden, false);
  assert.equal(url(), address);
  assert.equal(chosen().heading, 'review');
  assert.deepEqual(chosen().columns!.map(({ className }) => className), ['column', 'column wanted']);
  // Another skill's: its group, it marked instead.
  click($('to-skills'));
  const release = items.find((item) => item.dataset.name === 'release')!;
  click(choose($, release).find((child) => (child as FakeElement).className === 'similar') as FakeElement);
  assert.equal(chosen().heading, 'release');
  assert.deepEqual(chosen().columns!.map(({ className }) => className), ['column wanted', 'column']);
  assert.equal(scans(), 1);
});

test('the groups: a new scan, from the field, leaves out the skill and stays on the groups', async () => {
  const id = 'Team/web:.agents/skills/security-review/SKILL.md';
  const { $, rescan, url, scans, chosen } = await openGroups('https://github.com/Team', `&view=groups&skill=${encodeURIComponent(id)}`);
  await rescan();
  assert.equal(scans(), 2);
  assert.equal($('groups-view').hidden, false);
  assert.equal(url(), `?repo=${encodeURIComponent('https://github.com/Team')}&view=groups`);
  assert.equal(chosen().heading, 'release');
  assert.deepEqual(chosen().columns!.map(({ className }) => className), ['column', 'column']);
});

test('Tab in the field completes the sample link on the groups too: the one field, above both views', async () => {
  const { $ } = await openGroups('', '&view=groups');
  assert.equal($('groups-view').hidden, false);
  let prevented = false;
  for (const listener of $('repo').listeners.keydown) listener({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal($('repo').value, 'https://github.com/JetBrains/kotlin');
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
