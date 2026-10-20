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
