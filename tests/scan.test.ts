// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. The edge cases of
// where skills live are yours to add.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { findSkills } from '../src/core/find.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { bold } from '../src/commands.ts';
import { openDirectory } from '../src/local.ts';
import { atlas, CLI, EXAMPLE_COMMIT, EXAMPLE_MODIFIED, FIXTURE, github, lastModified, tree } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  // docs/SKILL.md, also found, is not a skill: it is not read, so nothing is missing.
  assert.equal(example.stderr, '');
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/${bold('.claude/skills/commits/SKILL.md')}`,
    ].join('\n'),
  );
});

test('the path part of the link is bold', () => {
  const links = example.stdout.split('\n').filter((line) => line.startsWith('  '));
  assert.deepEqual(links, [
    `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/\x1b[1m.claude/skills/commits/SKILL.md\x1b[22m`,
  ]);
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 3 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/${bold('.github/skills/code-style/SKILL.md')}`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/${bold('.claude/skills/commits/SKILL.md')}`,
      '  also in agent/skills/commits/SKILL.md',
      'release-checklist',
      `  ${root}/${bold('.agents/skills/release-checklist/SKILL.md')}`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('a project skill: <root>/<name>/SKILL.md; the same name in two roots is one skill', () => {
  assert.deepEqual(
    findSkills([
      'SKILL.md',
      'docs/skills/notes/SKILL.md',
      'skills/notes/SKILL.md',
      '.claude/skills/SKILL.md',
      '.claude/skills/nested/deeper/SKILL.md',
      '.claude/skills/lowercase/skill.md',
      '.claude/skills/commits/README.md',
      'agent/skills/commits/SKILL.md',
      '.github/skills/commits/SKILL.md',
      '.claude/skills/commits/SKILL.md',
      '.agents/skills/release-checklist/SKILL.md',
      'src/.claude/skills/commits/SKILL.md',
    ]),
    [
      {
        path: '.claude/skills/commits/SKILL.md',
        name: 'commits',
        copies: ['.github/skills/commits/SKILL.md', 'agent/skills/commits/SKILL.md'],
      },
      { path: '.agents/skills/release-checklist/SKILL.md', name: 'release-checklist', copies: [] },
    ],
  );
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

test('when a skill was last modified: on GitHub, with a token, the last commit that changed its directory, up to the scanned commit', async () => {
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch: github, token: 'test' }));
  assert.deepEqual(result.skills.map((skill) => [skill.name, skill.modified]), [['commits', EXAMPLE_MODIFIED]]);
  assert.deepEqual(result.warnings, []);
});

/** JetBrains/many: twelve skills in .agents/skills, s00 to s11, read with a token; `dates` answers when each was last modified. */
function many(dates: Recording) {
  const commit = '1111111111111111111111111111111111111111';
  const names = Array.from({ length: 12 }, (_, index) => `s${String(index).padStart(2, '0')}`);
  const recording: Recording = {
    'https://api.github.com/repos/JetBrains/many': { status: 200, body: { full_name: 'JetBrains/many', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/many/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/many/git/trees/${commit}`]: tree({ '.agents': 'm1' }),
    'https://api.github.com/repos/JetBrains/many/git/trees/m1': tree({ skills: 'm2' }),
    'https://api.github.com/repos/JetBrains/many/git/trees/m2?recursive=1': tree(Object.fromEntries(names.flatMap((name) => [[name, `t${name}`], [`${name}/SKILL.md`, null]]))),
    ...Object.fromEntries(names.map((name) => [
      `https://raw.githubusercontent.com/JetBrains/many/${commit}/.agents/skills/${name}/SKILL.md`,
      { status: 200, body: `---\nname: ${name}\ndescription: Skill ${name}.\n---\n` },
    ])),
    ...dates,
  };
  return { commit, names, open: () => openGitHub('https://github.com/JetBrains/many', { fetch: replay(recording), token: 'test' }) };
}

test('more than 10 skills: their dates 10 a GraphQL query; a directory no commit changed has none', async () => {
  const commit = '1111111111111111111111111111111111111111';
  const dates = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `.agents/skills/s${String(index).padStart(2, '0')}`,
    index === 11 ? null : `2026-01-${String(index + 10).padStart(2, '0')}T12:00:00Z`,
  ]));
  const recording = lastModified('JetBrains/many', commit, dates);
  assert.equal(Object.keys(recording).length, 2, 'two queries: 10 paths, then 2');
  const result = await scan(await many(recording).open());
  assert.deepEqual(result.skills.map((skill) => skill.modified), [...Object.values(dates).slice(0, 11), '']);
  assert.deepEqual(result.warnings, []);
});

test('the dates cannot be asked for → the skills without them, and a warning, the repository\'s own; the scan goes on', async () => {
  const { commit, names, open: openMany } = many({});
  const failing: Recording = {};
  for (const [key] of Object.entries(lastModified('JetBrains/many', commit, Object.fromEntries(names.map((name) => [`.agents/skills/${name}`, null]))))) {
    failing[key] = { status: 200, body: { data: null, errors: [{ message: 'Something went wrong' }] } };
  }
  const result = await scan(await many(failing).open());
  assert.equal(result.skills.length, 12);
  assert.ok(result.skills.every((skill) => skill.modified === ''));
  assert.deepEqual(result.warnings, ['cannot tell when its skills were last modified: GitHub GraphQL answered: Something went wrong']);
  // GitHub not answering at all still stops the scan.
  await assert.rejects(scan(await openMany()), /^Error: Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/graphql /);
});

test('without a token, no date: a GraphQL query each would spend the 60 requests an hour', async () => {
  const recording: Recording = {
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
    [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: tree({ '.claude/skills/commits/SKILL.md': null }),
    [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: { status: 200, body: '---\nname: commits\n---\n' },
  };
  // Any other request, GraphQL too, is not recorded: it would fail the scan.
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch: replay(recording) }));
  assert.deepEqual(result.skills.map((skill) => [skill.name, skill.modified]), [['commits', '']]);
});

test('a local directory: a skill was last modified when its newest file was', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, time: string) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), '---\nname: x\n---\n');
    utimesSync(join(root, path), new Date(time), new Date(time));
  };
  write('.claude/skills/notes/SKILL.md', '2026-02-01T10:00:00Z');
  write('.claude/skills/notes/scripts/run.sh', '2026-03-05T10:00:00Z');
  write('.claude/skills/old/SKILL.md', '2025-11-20T10:00:00Z');
  // Another skill's file, whose name starts the same, is not this one's.
  write('.claude/skills/old-two/SKILL.md', '2026-04-01T10:00:00Z');
  const result = await scan(await openDirectory(root));
  assert.deepEqual(result.skills.map((skill) => [skill.path, skill.modified]), [
    ['.claude/skills/notes/SKILL.md', '2026-03-05T10:00:00.000Z'],
    ['.claude/skills/old-two/SKILL.md', '2026-04-01T10:00:00.000Z'],
    ['.claude/skills/old/SKILL.md', '2025-11-20T10:00:00.000Z'],
  ]);
});
