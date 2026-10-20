// The organization decisions in spec/analysis.md, spec/cli.md and spec/web.md: a whole organization
// (or user) scanned at once, each repository's skills on their own. GitHub answers from recordings:
// the JetBrains organization in tests/helpers.ts, the others here.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { bold, run } from '../src/commands.ts';
import { openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanOrganization } from '../src/core/scan.ts';
import { createWebServer, listen } from '../src/web.ts';
import { atlas, EXAMPLE_COMMIT, open, TOOLS_COMMIT } from './helpers.ts';

const organization = await atlas(['scan', 'https://github.com/JetBrains']);

/** `skill-atlas scan <input>`, with GitHub answering from the recording, with or without a token. */
async function scanWith(recording: Recording, input: string, token?: string) {
  const fetch = replay(recording);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', input], {
    open: (url) => openGitHubOrganization(url, { fetch, token }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

test('an organization link: https://github.com/<owner>, with or without the scheme, a trailing slash or /orgs/', () => {
  for (const input of ['https://github.com/JetBrains', 'github.com/JetBrains/', 'http://www.github.com/JetBrains', 'https://github.com/orgs/JetBrains']) {
    assert.deepEqual(parseGitHubOwnerUrl(input), { owner: 'JetBrains' }, input);
  }
  assert.equal(parseGitHubOwnerUrl('https://github.com/JetBrains/kotlin'), undefined);
  assert.equal(parseGitHubOwnerUrl('/some/directory'), undefined);
  // An organization is not taken for a repository.
  assert.equal(parseGitHubUrl('https://github.com/JetBrains'), undefined);
});

test('scan prints the organization, then each repository with skills under its own heading, after a blank line', () => {
  assert.equal(organization.code, 0, organization.stderr);
  assert.equal(
    organization.stdout,
    [
      'JetBrains · 3 skills in 2 repositories',
      '',
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/${bold('.claude/skills/commits/SKILL.md')}`,
      '',
      'JetBrains/tools · 2 skills',
      'build',
      `  https://github.com/JetBrains/tools/blob/${TOOLS_COMMIT}/${bold('.github/skills/build/SKILL.md')}`,
      'lint — Run the linters.',
      `  https://github.com/JetBrains/tools/blob/${TOOLS_COMMIT}/${bold('.agents/skills/lint/SKILL.md')}`,
      '  also in .claude/skills/lint/SKILL.md',
    ].join('\n'),
  );
});

test('a repository without skills is left out and never opened; one that cannot be opened is skipped with a warning', () => {
  // JetBrains/docs has only docs/SKILL.md: had it been opened, the unrecorded request would fail the scan.
  assert.doesNotMatch(organization.stdout, /JetBrains\/docs|JetBrains\/gone/);
  assert.equal(
    organization.stderr,
    [
      'warning: JetBrains/gone: Not found on GitHub: https://api.github.com/repos/JetBrains/gone; skipped',
      // Each warning names its repository.
      'warning: JetBrains/tools: .github/skills/build/SKILL.md: malformed front matter: '
        + 'Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 23; using the directory name',
    ].join('\n'),
  );
});

/** A user, octo, without a token: its repositories are listed, and each one's tree. */
const OCTO_COMMIT = 'ffffffffffffffffffffffffffffffffffffffff';
const OCTO: Recording = {
  'https://api.github.com/users/octo': { status: 200, body: { login: 'octo', type: 'User' } },
  'https://api.github.com/users/octo/repos?per_page=100&page=1': {
    status: 200,
    body: [
      { full_name: 'octo/notes', default_branch: 'main', fork: false },
      // A fork is left out, as code search leaves it out: it has no answers here.
      { full_name: 'octo/kotlin', default_branch: 'master', fork: true },
      { full_name: 'octo/empty', default_branch: 'main', fork: false },
      { full_name: 'octo/plain', default_branch: 'main', fork: false },
    ],
  },
  'https://api.github.com/repos/octo/notes/commits/main': { status: 200, body: { sha: OCTO_COMMIT } },
  [`https://api.github.com/repos/octo/notes/git/trees/${OCTO_COMMIT}?recursive=1`]: {
    status: 200,
    body: {
      truncated: false,
      tree: [
        { path: '.claude/skills/notes/SKILL.md', mode: '100644', type: 'blob', sha: '1' },
        { path: 'README.md', mode: '100644', type: 'blob', sha: '2' },
      ],
    },
  },
  [`https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: {
    status: 200,
    body: '---\nname: notes\ndescription: Take notes.\n---\n',
  },
  // What GitHub answers for an empty repository.
  'https://api.github.com/repos/octo/empty/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  'https://api.github.com/repos/octo/plain/commits/main': { status: 200, body: { sha: OCTO_COMMIT } },
  [`https://api.github.com/repos/octo/plain/git/trees/${OCTO_COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: '3' }] },
  },
};

test('a user without a token: every repository but the forks, through its tree', async () => {
  const scanned = await scanWith(OCTO, 'https://github.com/octo');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'octo · 1 skill in 1 repository',
      '',
      'octo/notes · 1 skill',
      'notes — Take notes.',
      `  https://github.com/octo/notes/blob/${OCTO_COMMIT}/${bold('.claude/skills/notes/SKILL.md')}`,
    ].join('\n'),
  );
  assert.equal(
    scanned.stderr,
    'warning: octo/empty: GitHub answered 409 for https://api.github.com/repos/octo/empty/commits/main: Git Repository is empty.; skipped',
  );
});

test('a user with a token: code search for user:<login>', async () => {
  const scanned = await scanWith(
    {
      ...OCTO,
      'https://api.github.com/search/code?q=filename:SKILL.md+user:octo&per_page=100&page=1': {
        status: 200,
        body: { total_count: 1, items: [{ path: '.claude/skills/notes/SKILL.md', repository: { full_name: 'octo/notes' } }] },
      },
      'https://api.github.com/repos/octo/notes': { status: 200, body: { full_name: 'octo/notes', default_branch: 'main' } },
    },
    'github.com/octo',
    'test',
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.match(scanned.stdout, /^octo · 1 skill in 1 repository\n\nocto\/notes · 1 skill\nnotes — Take notes\./);
  assert.equal(scanned.stderr, '');
});

test('an organization without skills: the heading, and nothing else', async () => {
  const scanned = await scanWith(
    {
      'https://api.github.com/users/quiet': { status: 200, body: { login: 'quiet', type: 'Organization' } },
      'https://api.github.com/orgs/quiet/repos?per_page=100&page=1': { status: 200, body: [] },
    },
    'https://github.com/quiet',
  );
  assert.deepEqual(scanned, { code: 0, stdout: 'quiet · 0 skills in 0 repositories', stderr: '' });
});

test('more than 1000 SKILL.md files → a warning: GitHub search returns only the first 1000', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ path: `docs/${index}/SKILL.md`, repository: { full_name: 'big/docs' } }));
  const scanned = await scanWith(
    {
      'https://api.github.com/users/big': { status: 200, body: { login: 'big', type: 'Organization' } },
      'https://api.github.com/search/code?q=filename:SKILL.md+org:big&per_page=100&page=1': { status: 200, body: { total_count: 1500, items } },
      'https://api.github.com/search/code?q=filename:SKILL.md+org:big&per_page=100&page=2': { status: 200, body: { total_count: 1500, items: [] } },
    },
    'https://github.com/big',
    'test',
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stderr, 'warning: GitHub search found 1500 SKILL.md files and returns only the first 1000');
});

test('unknown organization → a clear message, exit code 1', async () => {
  const scanned = await scanWith({ 'https://api.github.com/users/no-such-owner': { status: 404, body: { message: 'Not Found' } } }, 'https://github.com/no-such-owner');
  assert.deepEqual(scanned, { code: 1, stdout: '', stderr: 'Organization or user not found: https://github.com/no-such-owner' });
});

test('the rate limit in the middle of an organization stops the scan, with a message that asks for GITHUB_TOKEN', async () => {
  const scanned = await scanWith(
    { ...OCTO, 'https://api.github.com/repos/octo/plain/commits/main': { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } } },
    'https://github.com/octo',
  );
  assert.deepEqual(scanned, { code: 1, stdout: '', stderr: 'GitHub rate limit reached; set GITHUB_TOKEN' });
});

test('a SKILL.md that cannot be read skips its repository, with a warning; the scan goes on', async () => {
  const result = await scanOrganization(
    await openGitHubOrganization('https://github.com/octo', {
      fetch: replay({ ...OCTO, [`https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: { status: 500, body: '' } }),
    }),
  );
  assert.deepEqual(result.repositories, []);
  assert.deepEqual(result.warnings, [
    'octo/empty: GitHub answered 409 for https://api.github.com/repos/octo/empty/commits/main: Git Repository is empty.; skipped',
    `octo/notes: GitHub answered 500 for https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md; skipped`,
  ]);
});

const server = createWebServer(open);
const address = await listen(server, 0);
after(() => server.close());

test('web: GET /api/scan for an organization → its repositories with skills, each skill as for a repository', async () => {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}`, address));
  assert.equal(response.status, 200);
  const body = JSON.parse(await response.text());
  assert.deepEqual(body.organization, { id: 'JetBrains', url: 'https://github.com/JetBrains' });
  assert.deepEqual(
    body.repositories.map(({ repository, skills }: { repository: { id: string }; skills: { name: string }[] }) => [repository.id, skills.map((skill) => skill.name)]),
    [['JetBrains/example', ['commits']], ['JetBrains/tools', ['build', 'lint']]],
  );
  const lint = body.repositories[1].skills[1];
  assert.deepEqual(lint.link, { base: `https://github.com/JetBrains/tools/blob/${TOOLS_COMMIT}/`, path: '.agents/skills/lint/SKILL.md' });
  assert.match(lint.html, /^<table class="front-matter">/);
  assert.equal(body.warnings.length, 2);
  assert.match(body.warnings[0], /^JetBrains\/gone: /);
});

test('web: the page shows each repository as a collapsed group, with its heading; Expand all and Collapse all', async () => {
  const page = await (await fetch(address)).text();
  assert.match(page, /if \(body\.organization\) return renderOrganization\(body\);/);
  assert.match(page, /element\('details', \{\},\n\s*element\('summary', \{\}, `\$\{repository\.id\} · \$\{count\(skills\.length, 'skill', 'skills'\)\}`\),/);
  assert.match(page, /<button id="toggle" type="button"><\/button>/);
  assert.match(page, /'Expand all' : 'Collapse all'/);
  // The heading stays in sight while its skills scroll by.
  assert.match(page, /#skills \.repository summary \{ position: sticky;/);
});
