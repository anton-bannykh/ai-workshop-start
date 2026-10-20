// End to end: the real CLI against live GitHub, for real JetBrains repositories. Their skills change,
// so the checks are the decisions in spec/, not today's list. Needs GITHUB_TOKEN; `npm run test:e2e`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { SKILL_ROOTS } from '../../src/core/find.ts';
import { openGitHub } from '../../src/core/github.ts';
import { scan as scanSource } from '../../src/core/scan.ts';
import { CLI } from '../helpers.ts';

const token = process.env.GITHUB_TOKEN;
const skip = token ? false : 'set GITHUB_TOKEN: without it, live GitHub soon answers with its rate limit';

type Entry = { name: string; description: string; commit: string; path: string; copies: string[] };

/** `skill-atlas scan https://github.com/<id>`, as a user runs it, and how long it took. */
function scan(id: string): Promise<{ code: number | null; stdout: string; stderr: string; seconds: number }> {
  const started = performance.now();
  const child = spawn(process.execPath, [CLI, 'scan', `https://github.com/${id}`], { env: { ...process.env, GITHUB_TOKEN: token } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, seconds: (performance.now() - started) / 1000 }));
  });
}

const ROOT = SKILL_ROOTS.map((root) => root.replace('.', '\\.')).join('|');
const HEADER = /^(\S+) · (\d+) skills?$/;
const LINK = new RegExp(`^  https://github\\.com/([^/]+/[^/]+)/blob/([0-9a-f]{40})/\\x1b\\[1m((?:${ROOT})/([^/]+)/SKILL\\.md)\\x1b\\[22m$`);
const COPIES = new RegExp(`^  also in ((?:${ROOT})/[^/]+/SKILL\\.md(?:, (?:${ROOT})/[^/]+/SKILL\\.md)*)$`);

/** The scan's output, checked line by line against spec/cli.md, as entries. */
function parse(id: string, stdout: string): Entry[] {
  const [header, ...lines] = stdout.trimEnd().split('\n');
  const count = HEADER.exec(header);
  assert.ok(count, `header: ${header}`);
  assert.equal(count[1], id);
  const entries: Entry[] = [];
  for (const line of lines) {
    const link = LINK.exec(line);
    const copies = COPIES.exec(line);
    if (link) {
      const entry = entries.at(-1);
      assert.ok(entry && !entry.path, `a link without its skill: ${line}`);
      assert.equal(link[1], id);
      Object.assign(entry, { commit: link[2], path: link[3] });
    } else if (copies) {
      const entry = entries.at(-1);
      assert.ok(entry?.path && entry.copies.length === 0, `copies without their skill: ${line}`);
      entry.copies = copies[1].split(', ');
    } else {
      assert.ok(!line.startsWith(' '), `unexpected line: ${line}`);
      // A description can have dashes of its own: the name ends at the first.
      const dash = line.indexOf(' — ');
      const [name, description] = dash < 0 ? [line, ''] : [line.slice(0, dash), line.slice(dash + 3)];
      entries.push({ name, description, commit: '', path: '', copies: [] });
    }
  }
  assert.equal(entries.length, Number(count[2]), 'the header counts every skill');
  return entries;
}

/** A scan; once more after a minute if GitHub's rate limit stopped it. */
async function scanOnce(id: string) {
  const result = await scan(id);
  if (!/rate limit/.test(result.stderr)) return result;
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  return scan(id);
}

/** What every scan must show, whatever the repository's skills are today. */
async function check(id: string) {
  const result = await scanOnce(id);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '', 'no warnings');
  const entries = parse(id, result.stdout);
  assert.ok(entries.length > 0, 'the repository has skills');
  for (const entry of entries) assert.ok(entry.path, `${entry.name} has a link`);

  const names = entries.map((entry) => entry.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'sorted by name');
  assert.equal(new Set(entries.map((entry) => entry.commit)).size, 1, 'every link pins the one scanned commit');
  for (const { name, description } of entries) {
    // The first sentence only: whatever ends a sentence is the last thing printed.
    assert.doesNotMatch(description, /[.!?]\s+\S/, `${name}: more than the first sentence`);
  }
  for (const entry of entries) {
    // The same <name> in several roots is one skill.
    const directory = (path: string) => path.split('/')[2];
    for (const copy of entry.copies) assert.equal(directory(copy), directory(entry.path), `${entry.name}: ${copy}`);
  }
  const directories = entries.map((entry) => entry.path.split('/')[2]);
  assert.equal(new Set(directories).size, directories.length, 'one entry per skill directory name');
  return { entries, seconds: result.seconds };
}

/** The pinned file is there on GitHub, a SKILL.md with front matter. */
async function assertLinkWorks(id: string, entry: Entry) {
  const response = await fetch(`https://raw.githubusercontent.com/${id}/${entry.commit}/${entry.path}`);
  assert.equal(response.status, 200, `${entry.path} at ${entry.commit}`);
  assert.match(await response.text(), /^---\r?\n/);
}

test('JetBrains/kotlin: its skills, sorted, first sentences, links pinned to the scanned commit', { skip, timeout: 120_000 }, async () => {
  const { entries } = await check('JetBrains/kotlin');
  const skill = entries.find((entry) => entry.name === 'build-tools-bump-gradle-api');
  assert.ok(skill, 'the skill in README.md');
  assert.equal(skill.path, '.claude/skills/build-tools-bump-gradle-api/SKILL.md');
  assert.match(skill.description, /^Bumps the Gradle API version /);
  await assertLinkWorks('JetBrains/kotlin', skill);
});

test('JetBrains/MPS: the same skill in .agents/skills and .claude/skills is one, with a copy', { skip, timeout: 120_000 }, async () => {
  const { entries } = await check('JetBrains/MPS');
  const skill = entries.find((entry) => entry.name === 'commits');
  assert.ok(skill, 'the commits skill');
  assert.equal(skill.path, '.agents/skills/commits/SKILL.md');
  assert.deepEqual(skill.copies, ['.claude/skills/commits/SKILL.md']);
  await assertLinkWorks('JetBrains/MPS', skill);
});

test('JetBrains/kotlin: when each skill was last modified, a commit\'s date, not after the scanned commit', { skip, timeout: 120_000 }, async () => {
  const source = await openGitHub('https://github.com/JetBrains/kotlin', { fetch, token });
  const result = await scanSource(source);
  assert.ok(result.skills.length > 0);
  assert.deepEqual(result.warnings, []);
  const scanned = await fetch(`https://api.github.com/repos/JetBrains/kotlin/commits/${source.repository.commit}`, { headers: { Authorization: `Bearer ${token}` } });
  const committed = Date.parse(((await scanned.json()) as { commit: { committer: { date: string } } }).commit.committer.date);
  for (const skill of result.skills) {
    assert.match(skill.modified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, skill.name);
    assert.ok(Date.parse(skill.modified) <= committed, `${skill.name}: ${skill.modified}`);
  }
});

test('JetBrains/intellij-community: under 5 s', { skip, timeout: 120_000 }, async () => {
  // Timed on a fresh scan: one that waited for the rate limit times only its retry.
  const { seconds } = await check('JetBrains/intellij-community');
  assert.ok(seconds < 5, `${seconds.toFixed(1)} s`);
});

test('JetBrains, the organization: every repository with skills, each as when it is scanned on its own', { skip, timeout: 300_000 }, async () => {
  const result = await scanOnce('JetBrains');
  assert.equal(result.code, 0, result.stderr);
  // Only a SKILL.md of the repositories' own may warn: none about how GitHub was asked.
  for (const line of result.stderr.split('\n').filter(Boolean)) {
    assert.match(line, /^warning: JetBrains\/[\w.-]+: (?:\.agents|\.claude|\.github|agent)\/skills\/[^/]+\/SKILL\.md: /, line);
  }
  const [header, ...groups] = result.stdout.trimEnd().split('\n\n');
  const summary = /^JetBrains · (\d+) skills in (\d+) repositories · (\d+) scanned$/.exec(header);
  assert.ok(summary, header);
  assert.equal(groups.length, Number(summary[2]));
  assert.ok(Number(summary[3]) >= groups.length, header);
  const ids = groups.map((group) => group.split('\n')[0].split(' · ')[0]);
  assert.deepEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'sorted by id');
  // Each repository's skills are the ones its own scan finds.
  const kotlin = groups.find((group) => group.startsWith('JetBrains/kotlin · '));
  assert.ok(kotlin, 'JetBrains/kotlin is listed');
  const own = await scanOnce('JetBrains/kotlin');
  assert.deepEqual(parse('JetBrains/kotlin', kotlin).map((entry) => entry.path), parse('JetBrains/kotlin', own.stdout).map((entry) => entry.path));
});
