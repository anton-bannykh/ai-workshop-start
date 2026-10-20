// The organization decisions in spec/analysis.md, spec/cli.md and spec/web.md: a whole organization
// (or user) scanned at once, each repository's skills on their own. GitHub answers from recordings:
// the JetBrains organization in tests/helpers.ts, the others here.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { bold, run } from '../src/commands.ts';
import { openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { graphql, replay, type Recording } from '../src/core/replay.ts';
import { scanOrganization } from '../src/core/scan.ts';
import { createWebServer, listen } from '../src/web.ts';
import { atlas, EXAMPLE_COMMIT, open, repositoriesPage, SECRET_COMMIT, skillRoots, TOOLS_COMMIT, tree } from './helpers.ts';

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
      'JetBrains · 4 skills in 3 repositories',
      '',
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/${bold('.claude/skills/commits/SKILL.md')}`,
      '',
      'JetBrains/secret · 1 skill',
      'deploy — Deploy it.',
      `  https://github.com/JetBrains/secret/blob/${SECRET_COMMIT}/${bold('.agents/skills/deploy/SKILL.md')}`,
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

test('with a token, every repository is looked into through GraphQL: one without skills, or empty, is never opened, and gives no warning', () => {
  // JetBrains/docs and JetBrains/empty have no answers but GraphQL's: had they been opened, the scan would have failed.
  assert.doesNotMatch(organization.stdout, /JetBrains\/docs|JetBrains\/empty/);
  // A skill's other files, a file in a skill root, a symbolic link: none of them is a skill.
  assert.doesNotMatch(organization.stdout, /notes|linked|agent\/skills/);
  // Each warning names its repository.
  assert.equal(
    organization.stderr,
    'warning: JetBrains/hidden: GitHub\'s GraphQL API answered nothing for it (R6); skipped\n'
      + 'warning: JetBrains/tools: .github/skills/build/SKILL.md: malformed front matter: '
      + 'Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 23; using the directory name',
  );
});

test('a private repository: its SKILL.md is read with the token', () => {
  // Without the token, GitHub answers 404 for it, as for any private file.
  assert.match(organization.stdout, /JetBrains\/secret · 1 skill\ndeploy — Deploy it\./);
});

test('scan shows how far it is while it runs, and clears it before the result', async () => {
  const { progress } = organization;
  assert.equal(progress[0], 'Scanning https://github.com/JetBrains…');
  // GraphQL counts JetBrains' 6 repositories; one line as each is done, looked into or scanned.
  const counts = progress.slice(1, -1).map((line) => Number(/^Scanning JetBrains: (\d) of 6 repositories, \d skills? so far…$/.exec(line)?.[1]));
  assert.equal(counts[0], 0);
  assert.deepEqual(counts, [...counts].sort(), 'never going back');
  assert.equal(progress.at(-2), 'Scanning JetBrains: 6 of 6 repositories, 4 skills so far…');
  assert.equal(progress.at(-1), '');
  // A repository: the first line, then cleared.
  assert.deepEqual((await atlas(['scan', 'https://github.com/JetBrains/example'])).progress, ['Scanning https://github.com/JetBrains/example…', '']);
});

test('a scan that stops is cleared too, before its message', async () => {
  const lines: string[] = [];
  const fetch = replay({ ...OCTO, 'https://api.github.com/repos/octo/plain/commits/main': { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } } });
  const code = await run(['scan', 'https://github.com/octo'], {
    open: (url) => openGitHubOrganization(url, { fetch }),
    print: (text) => lines.push(`print: ${text}`),
    error: (text) => lines.push(`error: ${text}`),
    progress: (text) => lines.push(`progress: ${text}`),
  });
  assert.equal(code, 1);
  assert.deepEqual(lines.slice(-2), ['progress: ', 'error: GitHub rate limit reached; set GITHUB_TOKEN']);
});

/** A user, octo, without a token: its repositories are listed, and each one's skill roots. */
const OCTO_COMMIT = 'ffffffffffffffffffffffffffffffffffffffff';
const OCTO: Recording = {
  'https://api.github.com/users/octo': { status: 200, body: { login: 'octo', type: 'User' } },
  'https://api.github.com/users/octo/repos?per_page=100&page=1': {
    status: 200,
    body: [
      { full_name: 'octo/notes', default_branch: 'main', fork: false },
      // A fork is left out: it has no answers here.
      { full_name: 'octo/kotlin', default_branch: 'master', fork: true },
      { full_name: 'octo/empty', default_branch: 'main', fork: false },
      { full_name: 'octo/plain', default_branch: 'main', fork: false },
    ],
  },
  'https://api.github.com/repos/octo/notes/commits/main': { status: 200, body: { sha: OCTO_COMMIT } },
  [`https://api.github.com/repos/octo/notes/git/trees/${OCTO_COMMIT}`]: tree({ '.claude': 'n1', 'README.md': null }),
  'https://api.github.com/repos/octo/notes/git/trees/n1': tree({ skills: 'n2' }),
  'https://api.github.com/repos/octo/notes/git/trees/n2?recursive=1': tree({ notes: 'n3', 'notes/SKILL.md': null }),
  [`https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: {
    status: 200,
    body: '---\nname: notes\ndescription: Take notes.\n---\n',
  },
  // What GitHub answers for an empty repository.
  'https://api.github.com/repos/octo/empty/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  'https://api.github.com/repos/octo/plain/commits/main': { status: 200, body: { sha: OCTO_COMMIT } },
  [`https://api.github.com/repos/octo/plain/git/trees/${OCTO_COMMIT}`]: tree({ 'README.md': null }),
};

test('a user without a token: every repository but the forks, through its skill roots; an empty one has no skills, and no warning', async () => {
  const scanned = await scanWith(OCTO, 'https://github.com/octo');
  assert.deepEqual(scanned, {
    code: 0,
    stdout: [
      'octo · 1 skill in 1 repository',
      '',
      'octo/notes · 1 skill',
      'notes — Take notes.',
      `  https://github.com/octo/notes/blob/${OCTO_COMMIT}/${bold('.claude/skills/notes/SKILL.md')}`,
    ].join('\n'),
    stderr: '',
  });
});

test('a user with a token: GraphQL lists the repositories the user owns', async () => {
  const scanned = await scanWith(
    {
      ...OCTO,
      [graphql({ login: 'octo', after: null })]: repositoriesPage(2, [['octo/notes', 'N1'], ['octo/plain', 'N2']]),
      [graphql({ ids: ['N1', 'N2'] })]: {
        status: 200,
        body: { data: { nodes: [skillRoots('octo/notes', OCTO_COMMIT, { '.claude/skills': { notes: ['SKILL.md'] } }), skillRoots('octo/plain', OCTO_COMMIT)] } },
      },
    },
    'github.com/octo',
    'test',
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.match(scanned.stdout, /^octo · 1 skill in 1 repository\n\nocto\/notes · 1 skill\nnotes — Take notes\./);
  assert.equal(scanned.stderr, '');
});

test('more than 10 repositories: 10 a GraphQL query, and over 100, a page more', async () => {
  const names = Array.from({ length: 105 }, (_, index): [string, string] => [`many/r${index}`, `M${index}`]);
  const recording: Recording = {
    'https://api.github.com/users/many': { status: 200, body: { login: 'many', type: 'Organization' } },
    [graphql({ login: 'many', after: null })]: repositoriesPage(105, names.slice(0, 100), 'next'),
    [graphql({ login: 'many', after: 'next' })]: repositoriesPage(105, names.slice(100)),
  };
  for (let start = 0; start < names.length; start += 10) {
    const batch = names.slice(start, start + 10);
    recording[graphql({ ids: batch.map(([, id]) => id) })] = { status: 200, body: { data: { nodes: batch.map(([name]) => skillRoots(name, OCTO_COMMIT)) } } };
  }
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/many', { fetch: replay(recording), token: 'test' }));
  assert.deepEqual(result, { organization: { id: 'many', url: 'https://github.com/many' }, repositories: [], warnings: [] });
});

/** An organization of three repositories over GraphQL, with `answer` for the query into their skill roots. */
function threeRepositories(answer: Recording[string] | Recording[string][]): Fetch {
  const answers = Array.isArray(answer) ? [...answer] : [answer];
  const recorded = replay({
    'https://api.github.com/users/trio': { status: 200, body: { login: 'trio', type: 'Organization' } },
    [graphql({ login: 'trio', after: null })]: repositoriesPage(3, [['trio/a', 'T1'], ['trio/b', 'T2'], ['trio/c', 'T3']]),
  });
  return async (url, init) => {
    if (!init?.body?.includes('"ids"')) return recorded(url, init);
    const { status, body } = answers.length > 1 ? answers.shift()! : answers[0];
    return new Response(JSON.stringify(body), { status });
  };
}

test('a GraphQL query that times out is asked once more; one that fails again skips its repositories, each with a warning', async () => {
  const timeout = { status: 502, body: { message: 'Server Error' } };
  const nodes = { status: 200, body: { data: { nodes: [skillRoots('trio/a', null), skillRoots('trio/b', null), skillRoots('trio/c', null)] } } };
  assert.deepEqual((await scanOrganization(await openGitHubOrganization('https://github.com/trio', { fetch: threeRepositories([timeout, nodes]), token: 'test' }))).repositories, []);

  const result = await scanOrganization(await openGitHubOrganization('https://github.com/trio', { fetch: threeRepositories(timeout), token: 'test' }));
  assert.deepEqual(result.repositories.map(({ repository, skills, warnings }) => [repository.id, repository.url, skills, warnings]), ['a', 'b', 'c'].map((name) => [
    `trio/${name}`,
    `https://github.com/trio/${name}`,
    [],
    ['GitHub answered 502 for https://api.github.com/graphql: Server Error; skipped'],
  ]));
  assert.deepEqual(result.warnings, []);
});

test('GraphQL\'s rate limit stops the scan, with a clear message', async () => {
  const fetch = threeRepositories({ status: 200, body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } });
  const lines: string[] = [];
  const code = await run(['scan', 'https://github.com/trio'], {
    open: (url) => openGitHubOrganization(url, { fetch, token: 'test' }),
    print: (text) => lines.push(text),
    error: (text) => lines.push(text),
  });
  assert.deepEqual({ code, lines }, { code: 1, lines: ['GitHub rate limit reached; try again in a minute'] });
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

test('a repository that cannot be opened is skipped with a warning under its own name; the scan goes on', async () => {
  const result = await scanOrganization(
    await openGitHubOrganization('https://github.com/octo', {
      fetch: replay({ ...OCTO, 'https://api.github.com/repos/octo/plain/commits/main': { status: 500, body: { message: 'Server Error' } } }),
    }),
  );
  assert.deepEqual(result.repositories.map(({ repository, skills, warnings }) => [repository.id, skills.length, warnings]), [
    ['octo/notes', 1, []],
    ['octo/plain', 0, ['GitHub answered 500 for https://api.github.com/repos/octo/plain/commits/main: Server Error; skipped']],
  ]);
});

test('a SKILL.md that cannot be read is still listed, by its directory name, with a warning that says why', async () => {
  const result = await scanOrganization(
    await openGitHubOrganization('https://github.com/octo', {
      fetch: replay({ ...OCTO, [`https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: { status: 500, body: '' } }),
    }),
  );
  assert.deepEqual(result.repositories.map(({ repository, skills, warnings }) => [repository.id, skills.map(({ name, description, text }) => [name, description, text]), warnings]), [
    ['octo/notes', [['notes', '', '']], [
      `.claude/skills/notes/SKILL.md: cannot be read (GitHub answered 500 for https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md); `
        + 'listed by its directory name, without a description',
    ]],
  ]);
});

const server = createWebServer(open);
const address = await listen(server, 0);
after(() => server.close());

test('web: GET /api/scan for an organization → its repositories with skills, each skill as for a repository, each with its warnings', async () => {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}`, address));
  assert.equal(response.status, 200);
  const body = JSON.parse(await response.text());
  assert.deepEqual(body.organization, { id: 'JetBrains', url: 'https://github.com/JetBrains' });
  assert.deepEqual(
    body.repositories.map(({ repository, skills }: { repository: { id: string }; skills: { name: string }[] }) => [repository.id, skills.map((skill) => skill.name)]),
    [['JetBrains/example', ['commits']], ['JetBrains/hidden', []], ['JetBrains/secret', ['deploy']], ['JetBrains/tools', ['build', 'lint']]],
  );
  const lint = body.repositories[3].skills[1];
  assert.deepEqual(lint.link, { base: `https://github.com/JetBrains/tools/blob/${TOOLS_COMMIT}/`, path: '.agents/skills/lint/SKILL.md' });
  assert.match(lint.html, /^<table class="front-matter">/);
  // A repository's warnings are its own; the organization has none.
  assert.deepEqual(body.repositories.map(({ warnings }: { warnings: string[] }) => warnings.length), [0, 1, 0, 1]);
  assert.match(body.repositories[3].warnings[0], /^\.github\/skills\/build\/SKILL\.md: malformed front matter: /);
  assert.deepEqual(body.warnings, []);
});

test('web: GET /api/scan?repo=…&progress → a JSON line as each repository is done, then the result', async () => {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}&progress`, address));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/x-ndjson/);
  const lines = (await response.text()).trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0].progress, { done: 0, total: 6, skills: 0 });
  assert.deepEqual(lines.at(-2).progress, { done: 6, total: 6, skills: 4 });
  const plain = await (await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}`, address))).json();
  assert.deepEqual(lines.at(-1), { result: plain });

  // An error, after the answer has started: its line, with the status it would have had.
  const failed = await (await fetch(new URL(`/api/scan?repo=${encodeURIComponent('/no/such/directory')}&progress`, address))).text();
  assert.equal(failed, '{"status":400,"error":"Not a GitHub URL or a readable directory: /no/such/directory"}\n');
});

test('web: the page shows each repository as a collapsed group, with its heading; Expand all and Collapse all', async () => {
  const page = await (await fetch(address)).text();
  assert.match(page, /if \(body\.organization\) return renderOrganization\(body\);/);
  assert.match(page, /element\('details', \{\},\n\s*element\('summary', \{\}, warnings\.length \? '❗ ' : '', `\$\{repository\.id\} · `, element\('span', \{ className: 'count' \}\)\),/);
  assert.match(page, /<button id="toggle" type="button"><\/button>/);
  assert.match(page, /'Expand all' : 'Collapse all'/);
  // The heading stays in sight while its skills scroll by.
  assert.match(page, /#skills \.repository summary \{ position: sticky;/);
});
