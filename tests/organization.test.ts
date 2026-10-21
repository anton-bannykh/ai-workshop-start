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
import { atlas, EXAMPLE_COMMIT, lastModified, listedRepositories, open, repositoriesPage, SECRET_COMMIT, skillRoots, TOOLS_COMMIT, tree } from './helpers.ts';

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
      'JetBrains · 4 skills in 3 repositories · 6 scanned',
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
  // REST lists JetBrains' 6 repositories, and a fork, on one page; one line as each page is listed, and as
  // each repository is done, looked into or scanned. The total is of the repositories listed so far.
  const lines = progress.slice(1, -1).map((line) => /^Scanning JetBrains: (\d) of (\d) repositories, \d skills? so far…$/.exec(line)!.slice(1).map(Number));
  const counts = lines.map(([done]) => done);
  const totals = lines.map(([, total]) => total);
  assert.deepEqual(lines[0], [0, 6]);
  assert.deepEqual(counts, [...counts].sort(), 'never going back');
  assert.deepEqual(totals, [...totals].sort(), 'never going back');
  assert.ok(lines.every(([done, total]) => done <= total));
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
      'octo · 1 skill in 1 repository · 3 scanned',
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
      ...lastModified('octo/notes', OCTO_COMMIT, { '.claude/skills/notes': '2026-04-01T12:00:00Z' }),
    },
    'github.com/octo',
    'test',
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.match(scanned.stdout, /^octo · 1 skill in 1 repository · 2 scanned\n\nocto\/notes · 1 skill\nnotes — Take notes\./);
  assert.equal(scanned.stderr, '');
});

test('more than 10 repositories: 10 a GraphQL query; over 100, a page more, all the pages at once', async () => {
  const names = Array.from({ length: 305 }, (_, index): [string, string] => [`many/r${index}`, `M${index}`]);
  const recording: Recording = {
    'https://api.github.com/users/many': { status: 200, body: { login: 'many', type: 'Organization' } },
    ...listedRepositories('many', names),
  };
  for (let start = 0; start < names.length; start += 10) {
    const batch = names.slice(start, start + 10);
    recording[graphql({ ids: batch.map(([, id]) => id) })] = { status: 200, body: { data: { nodes: batch.map(([name]) => skillRoots(name, OCTO_COMMIT)) } } };
  }
  // The pages after the first are all asked for before any of them is answered.
  const replayed = replay(recording);
  const asked: string[] = [];
  let release!: () => void;
  const answered = new Promise<void>((resolve) => { release = resolve; });
  const fetch: Fetch = async (url, init) => {
    const page = /[?&]page=(\d+)$/.exec(url)?.[1];
    if (page && page !== '1') {
      asked.push(page);
      if (asked.length === 3) release();
      await answered;
    }
    return replayed(url, init);
  };
  const totals: number[] = [];
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/many', { fetch, token: 'test' }), ({ total }) => totals.push(total));
  assert.deepEqual(result, { organization: { id: 'many', url: 'https://github.com/many' }, repositories: [], scanned: 305, warnings: [] });
  assert.deepEqual(asked.sort(), ['2', '3', '4']);
  // The total grows as each page is listed.
  assert.equal(totals[0], 100);
  assert.equal(totals.at(-1), 305);
});

test('a page of an organization that cannot be listed → a warning, the organization\'s; the others are scanned', async () => {
  const names = Array.from({ length: 150 }, (_, index): [string, string] => [`gap/r${index}`, `G${index}`]);
  const recording: Recording = {
    'https://api.github.com/users/gap': { status: 200, body: { login: 'gap', type: 'Organization' } },
    ...listedRepositories('gap', names),
    'https://api.github.com/orgs/gap/repos?per_page=100&page=2': { status: 500, body: { message: 'Server Error' } },
  };
  for (let start = 0; start < 100; start += 10) {
    const batch = names.slice(start, start + 10);
    recording[graphql({ ids: batch.map(([, id]) => id) })] = { status: 200, body: { data: { nodes: batch.map(([name]) => skillRoots(name, OCTO_COMMIT)) } } };
  }
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/gap', { fetch: replay(recording), token: 'test' }));
  assert.equal(result.scanned, 100);
  assert.deepEqual(result.warnings, [
    'cannot list page 2 of its repositories, 101 to 200: GitHub answered 500 for https://api.github.com/orgs/gap/repos?per_page=100&page=2: Server Error; they were not scanned',
    'GitHub counts 150 repositories, but lists only 100 to this token; the other 50 cannot be read with it and were not scanned',
  ]);
});

test('the rate limit while an organization is listed stops the scan, with a clear message, whatever else failed', async () => {
  const names = Array.from({ length: 150 }, (_, index): [string, string] => [`limited/r${index}`, `L${index}`]);
  const limited = { status: 200, body: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } };
  const recording: Recording = {
    'https://api.github.com/users/limited': { status: 200, body: { login: 'limited', type: 'Organization' } },
    ...listedRepositories('limited', names),
    'https://api.github.com/orgs/limited/repos?per_page=100&page=2': { status: 403, body: { message: 'API rate limit exceeded for user ID 1.' } },
    // GraphQL's count fails too, after the page: nothing waits for it any more.
    [graphql({ login: 'limited' })]: limited,
  };
  for (let start = 0; start < 100; start += 10) recording[graphql({ ids: names.slice(start, start + 10).map(([, id]) => id) })] = limited;
  const replayed = replay(recording);
  const fetch: Fetch = async (url, init) => {
    if (init?.body?.includes('"login"')) await new Promise((resolve) => setTimeout(resolve, 20));
    return replayed(url, init);
  };
  await assert.rejects(
    scanOrganization(await openGitHubOrganization('https://github.com/limited', { fetch, token: 'test' })),
    { message: 'GitHub rate limit reached; try again in a minute' },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
});

test('an organization REST cannot list at all, e.g. behind single sign-on: GraphQL lists it, a page at a time', async () => {
  const recording: Recording = {
    'https://api.github.com/users/sso': { status: 200, body: { login: 'sso', type: 'Organization' } },
    'https://api.github.com/orgs/sso/repos?per_page=100&page=1': { status: 403, body: { message: 'Resource protected by organization SAML enforcement.' } },
    [graphql({ login: 'sso' })]: { status: 200, body: { data: { repositoryOwner: { repositories: { totalCount: 1 } } } } },
    [graphql({ login: 'sso', after: null })]: repositoriesPage(1, [['sso/a', 'S1']]),
    [graphql({ ids: ['S1'] })]: { status: 200, body: { data: { nodes: [skillRoots('sso/a', OCTO_COMMIT)] } } },
  };
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/sso', { fetch: replay(recording), token: 'test' }));
  assert.deepEqual({ scanned: result.scanned, warnings: result.warnings }, { scanned: 1, warnings: [] });
});

test('the repositories to scan are the ones GitHub lists to the token: more counted than listed → a warning with both numbers', async () => {
  const recording: Recording = {
    'https://api.github.com/users/big': { status: 200, body: { login: 'big', type: 'Organization' } },
    // GraphQL counts 2034; REST lists the 2 the token can read.
    ...listedRepositories('big', [['big/a', 'B1'], ['big/b', 'B2']], 2034),
    [graphql({ ids: ['B1', 'B2'] })]: {
      status: 200,
      body: { data: { nodes: [skillRoots('big/a', OCTO_COMMIT, { '.claude/skills': { notes: ['SKILL.md'] } }), skillRoots('big/b', OCTO_COMMIT)] } },
    },
    [`https://raw.githubusercontent.com/big/a/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: { status: 200, body: '---\nname: notes\ndescription: Take notes.\n---\n' },
    ...lastModified('big/a', OCTO_COMMIT, { '.claude/skills/notes': '2026-04-01T12:00:00Z' }),
  };
  const progress: { done: number; total: number }[] = [];
  const result = await scanOrganization(
    await openGitHubOrganization('https://github.com/big', { fetch: replay(recording), token: 'test' }),
    ({ done, total }) => progress.push({ done, total }),
  );
  assert.deepEqual(new Set(progress.map(({ total }) => total)), new Set([2]), 'of the 2 listed, not the 2034 counted');
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
  assert.deepEqual(result.repositories.map(({ repository }) => repository.id), ['big/a']);
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.warnings, ['GitHub counts 2034 repositories, but lists only 2 to this token; the other 2032 cannot be read with it and were not scanned']);

  const scanned = await scanWith(recording, 'https://github.com/big', 'test');
  assert.equal(scanned.code, 0);
  assert.match(scanned.stdout, /^big · 1 skill in 1 repository · 2 scanned\n/);
  assert.equal(scanned.stderr, 'warning: GitHub counts 2034 repositories, but lists only 2 to this token; the other 2032 cannot be read with it and were not scanned');
});

test('a user\'s repositories, as GraphQL lists them: one the token cannot read is left out, or null; a warning with both numbers', async () => {
  const page = repositoriesPage(5, [['solo/a', 'U1']]);
  page.body.data.repositoryOwner.repositories.nodes.push(null as never);
  const recording: Recording = {
    'https://api.github.com/users/solo': { status: 200, body: { login: 'solo', type: 'User' } },
    [graphql({ login: 'solo', after: null })]: page,
    [graphql({ ids: ['U1'] })]: { status: 200, body: { data: { nodes: [skillRoots('solo/a', OCTO_COMMIT)] } } },
  };
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/solo', { fetch: replay(recording), token: 'test' }));
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.warnings, ['GitHub counts 5 repositories, but lists only 1 to this token; the other 4 cannot be read with it and were not scanned']);
});

/** An organization of three repositories, with `answer` for the GraphQL query into their skill roots. */
function threeRepositories(answer: Recording[string] | Recording[string][]): Fetch {
  const answers = Array.isArray(answer) ? [...answer] : [answer];
  const recorded = replay({
    'https://api.github.com/users/trio': { status: 200, body: { login: 'trio', type: 'Organization' } },
    ...listedRepositories('trio', [['trio/a', 'T1'], ['trio/b', 'T2'], ['trio/c', 'T3']]),
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

test('an answer GitHub cuts short is asked for once more; cut short again, its repositories are skipped, each with a warning', async () => {
  const recorded = threeRepositories({ status: 200, body: { data: { nodes: [skillRoots('trio/a', null), skillRoots('trio/b', null), skillRoots('trio/c', null)] } } });
  const cutShort = (times: number): Fetch => {
    let left = times;
    return async (url, init) => (init?.body?.includes('"ids"') && left-- > 0 ? new Response('{"data":{"nodes":[', { status: 200 }) : recorded(url, init));
  };
  assert.deepEqual((await scanOrganization(await openGitHubOrganization('https://github.com/trio', { fetch: cutShort(1), token: 'test' }))).repositories, []);
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/trio', { fetch: cutShort(2), token: 'test' }));
  assert.deepEqual(result.repositories.map(({ repository, warnings }) => [repository.id, warnings]), ['a', 'b', 'c'].map((name) => [
    `trio/${name}`,
    ['GitHub sent an incomplete answer for https://api.github.com/graphql; skipped'],
  ]));
});

test('GitHub\'s secondary rate limit, too many at once, stops the scan too, with a clear message', async () => {
  const fetch = threeRepositories({ status: 200, body: { errors: [{ type: 'RATE_LIMIT', code: 'graphql_rate_limit', message: 'API rate limit already exceeded for user ID 1.' }] } });
  const lines: string[] = [];
  const code = await run(['scan', 'https://github.com/trio'], {
    open: (url) => openGitHubOrganization(url, { fetch, token: 'test' }),
    print: (text) => lines.push(text),
    error: (text) => lines.push(text),
  });
  assert.deepEqual({ code, lines }, { code: 1, lines: ['GitHub rate limit reached; try again in a minute'] });
});

test('no more than 48 requests to GitHub\'s API at a time, however many there are to make', async () => {
  // 100 repositories of 30 skills each: their dates alone, 6 queries each, are more than 48 at once.
  const names = Array.from({ length: 100 }, (_, index): [string, string] => [`wide/r${index}`, `W${index}`]);
  const skills = Array.from({ length: 30 }, (_, index) => `s${String(index).padStart(2, '0')}`);
  const commit = 'abababababababababababababababababababab';
  const recording: Recording = {
    'https://api.github.com/users/wide': { status: 200, body: { login: 'wide', type: 'Organization' } },
    ...listedRepositories('wide', names),
  };
  for (let start = 0; start < names.length; start += 10) {
    const batch = names.slice(start, start + 10);
    recording[graphql({ ids: batch.map(([, id]) => id) })] = {
      status: 200,
      body: { data: { nodes: batch.map(([name]) => skillRoots(name, commit, { '.agents/skills': Object.fromEntries(skills.map((skill) => [skill, ['SKILL.md']])) })) } },
    };
    for (const [name] of batch) {
      Object.assign(recording, lastModified(name, commit, Object.fromEntries(skills.map((skill) => [`.agents/skills/${skill}`, '2026-01-01T12:00:00Z']))));
      for (const skill of skills) {
        recording[`https://raw.githubusercontent.com/${name}/${commit}/.agents/skills/${skill}/SKILL.md`] = { status: 200, body: `---\nname: ${skill}\ndescription: It.\n---\n` };
      }
    }
  }
  const replayed = replay(recording);
  let running = 0;
  let most = 0;
  const fetch: Fetch = async (url, init) => {
    if (!url.startsWith('https://api.github.com/')) return replayed(url, init);
    most = Math.max(most, ++running);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await replayed(url, init);
    } finally {
      running--;
    }
  };
  const result = await scanOrganization(await openGitHubOrganization('https://github.com/wide', { fetch, token: 'test' }));
  assert.equal(result.repositories.length, 100);
  assert.ok(result.repositories.every((scanned) => scanned.skills.every((skill) => skill.modified !== '')));
  assert.equal(most, 48);
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
  assert.deepEqual(scanned, { code: 0, stdout: 'quiet · 0 skills in 0 repositories · 0 scanned', stderr: '' });
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

test('a SKILL.md that cannot be read is still listed, by its directory name, with its own warning that says why', async () => {
  const result = await scanOrganization(
    await openGitHubOrganization('https://github.com/octo', {
      fetch: replay({ ...OCTO, [`https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md`]: { status: 500, body: '' } }),
    }),
  );
  assert.deepEqual(result.repositories.map(({ repository, skills, warnings }) => [repository.id, skills.map(({ name, description, text, warnings }) => [name, description, text, warnings]), warnings]), [
    ['octo/notes', [['notes', '', '', [
      `cannot be read (GitHub answered 500 for https://raw.githubusercontent.com/octo/notes/${OCTO_COMMIT}/.claude/skills/notes/SKILL.md); `
        + 'listed by its directory name, without a description',
    ]]], []],
  ]);
});

const server = createWebServer(open);
const address = await listen(server, 0);
after(() => server.close());

test('web: GET /api/scan for an organization → its repositories with skills, each skill as for a repository; each repository and skill with its own warnings', async () => {
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
  // A repository's warnings are its own, a skill's are the skill's; the organization has none.
  assert.deepEqual(body.repositories.map(({ warnings }: { warnings: string[] }) => warnings.length), [0, 1, 0, 0]);
  const [build] = body.repositories[3].skills;
  assert.equal(build.warnings.length, 1);
  assert.match(build.warnings[0], /^malformed front matter: [^\n]*; using the directory name$/);
  assert.deepEqual(lint.warnings, []);
  assert.deepEqual(body.scanned, 6);
  assert.deepEqual(body.warnings, []);
});

test('web: GET /api/scan?repo=…&progress → a JSON line as each repository is done, then the result', async () => {
  const response = await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}&progress`, address));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/x-ndjson/);
  const lines = (await response.text()).trimEnd().split('\n').map((line) => JSON.parse(line));
  // The total, of the repositories listed so far: all 6 on the one page.
  assert.deepEqual(lines[0].progress, { done: 0, total: 6, skills: 0 });
  assert.deepEqual(lines.at(-2).progress, { done: 6, total: 6, skills: 4 });
  const plain = await (await fetch(new URL(`/api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}`, address))).json() as { repositories: unknown[] };
  assert.deepEqual(lines.at(-1), { result: plain });

  // Each repository with skills or warnings, in a line of its own as soon as it is scanned, before the
  // progress that counts it: as in the result.
  const repositories = lines.filter((line) => line.repository).map((line) => line.repository);
  assert.deepEqual([...repositories].sort((a, b) => (a.repository.id < b.repository.id ? -1 : 1)), plain.repositories);
  for (const [index, line] of lines.entries()) {
    if (!line.repository) continue;
    const before = lines.slice(0, index).findLast((other) => other.progress)?.progress.done ?? 0;
    assert.equal(lines.slice(index + 1).find((other) => other.progress).progress.done, before + 1, line.repository.repository.id);
  }

  // An error, after the answer has started: its line, with the status it would have had.
  const failed = await (await fetch(new URL(`/api/scan?repo=${encodeURIComponent('/no/such/directory')}&progress`, address))).text();
  assert.equal(failed, '{"status":400,"error":"Not a GitHub URL or a readable directory: /no/such/directory"}\n');
});

test('web: the page shows each repository as a collapsed group, with its heading; Expand all and Collapse all', async () => {
  const page = await (await fetch(address)).text();
  assert.match(page, /if \(body\.organization\) return renderOrganization\(body\);/);
  assert.match(page, /element\('details', \{\},\n\s*element\('summary', \{\}, warned\(warnings, skills\) \? '❗ ' : '', `\$\{repository\.id\} · `, element\('span', \{ className: 'count' \}\)\),/);
  assert.match(page, /<button id="toggle" type="button"><\/button>/);
  assert.match(page, /'Expand all' : 'Collapse all'/);
  // The heading stays in sight while its skills scroll by.
  assert.match(page, /#skills \.repository summary \{ position: sticky;/);
});
