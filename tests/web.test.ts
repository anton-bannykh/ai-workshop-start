// The decisions in spec/web.md, checked on the web view's server for ./fixture and for the small
// GitHub repository answered in tests/helpers.ts, and on `skill-atlas serve` as a user runs it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { renderSkill } from '../src/markdown.ts';
import { createWebServer, listen } from '../src/web.ts';
import { CLI, EXAMPLE_COMMIT, FIXTURE, open } from './helpers.ts';

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
  assert.match(page.text, /aria-label="Repository link"/);
  assert.match(page.text, /<ul id="skills">/);
  assert.match(page.text, /<section id="skill">/);
  // The page asks the API, and links with ?repo= scan at once.
  assert.match(page.text, /fetch\(`\/api\/scan\?repo=\$\{encodeURIComponent\(repo\)\}`\)/);
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
      link: { base: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/`, path: '.claude/skills/commits/SKILL.md' },
      html:
        '<table class="front-matter"><tbody><tr><th>name</th><td>commits</td></tr>'
        + '<tr><th>description</th><td>Write commit messages the way this repository does. Use for every commit.</td></tr>'
        + '</tbody></table><h1>Commits</h1>\n',
    },
  ]);
});

test('a directory: every skill sorted by name, its copies, its SKILL.md as in the file, and the warning', async () => {
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
  assert.equal(body.warnings.length, 1);
  assert.match(body.warnings[0], /^\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
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

test('formatting: malformed front matter is shown as it is, with the warning', async () => {
  const { body } = await scanned(FIXTURE);
  const skill = body.skills.find((entry: { name: string }) => entry.name === 'release-checklist');
  const text = readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8');
  const raw = text.split('\n').slice(1, text.split('\n').indexOf('---', 1)).join('\n');
  assert.ok(skill.html.startsWith(
    '<div class="front-matter"><p class="warning">malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14</p>'
      + `<pre>${raw.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}</pre></div>`,
  ), skill.html);
  // No front matter at all: only the Markdown.
  assert.equal(renderSkill('# Title\n', FILE), '<h1>Title</h1>\n');
});

test('a clear message → 400 with the error', async () => {
  assert.deepEqual(await scanned(''), { status: 400, body: { error: 'Enter a GitHub repository URL or a directory' } });
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
