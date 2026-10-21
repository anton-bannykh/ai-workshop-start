// The groups of spec/web.md: skills whose names share a word, and what is the same and what is not in
// their SKILL.md files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareLines, groupSkills, nameWords } from '../src/core/groups.ts';
import type { Skill } from '../src/core/model.ts';

/** A skill named `name`, in `repository`, its SKILL.md `text`. */
function skill(name: string, text = `---\nname: ${name}\n---\n`, repository = 'JetBrains/kotlin'): Skill {
  const path = `.agents/skills/${name}/SKILL.md`;
  return { id: `${repository}:${path}`, repository, path, name, description: '', commit: 'c0ffee', copies: [], text, modified: '', warnings: [] };
}

const summary = (skills: Skill[]) => groupSkills(skills).map(({ words, skills }) => [words.join(' '), skills.map(({ skill }) => skill.id)]);

test('a name\'s words: split on anything not a letter or a digit, and between camelCase words; lower case, each once', () => {
  assert.deepEqual(nameWords('build-tools-bump-gradle-api'), ['build', 'tools', 'bump', 'gradle', 'api']);
  assert.deepEqual(nameWords('reviewPullRequest'), ['review', 'pull', 'request']);
  assert.deepEqual(nameWords('Fix_K2 issue.v2'), ['fix', 'k2', 'issue', 'v2']);
  assert.deepEqual(nameWords('test-the-tests-test'), ['test', 'tests']);
});

test('a name\'s words leave out single letters and the words that say nothing: skill, and, for, of, the…', () => {
  assert.deepEqual(nameWords('a-skill-for-the-review-of-x'), ['review']);
  assert.deepEqual(nameWords('skills'), []);
});

test('groups: one for each word two skills or more share; a skill is in a group for each word it shares', () => {
  const skills = ['code-review', 'security-review', 'release', 'release-notes', 'review-release', 'deploy'].map((name) => skill(name));
  assert.deepEqual(groupSkills(skills).map(({ words, skills }) => [words, skills.map(({ skill }) => skill.name)]), [
    [['release'], ['release', 'release-notes', 'review-release']],
    [['review'], ['code-review', 'review-release', 'security-review']],
  ]);
});

test('groups: words shared by the very same skills make one group, in the order of the first one\'s name', () => {
  const skills = ['build-tools-bump-gradle-api', 'build-tools-update', 'gradle-update'].map((name) => skill(name));
  assert.deepEqual(groupSkills(skills).map(({ words, skills }) => [words, skills.map(({ skill }) => skill.name)]), [
    [['build', 'tools'], ['build-tools-bump-gradle-api', 'build-tools-update']],
    [['gradle'], ['build-tools-bump-gradle-api', 'gradle-update']],
    [['update'], ['build-tools-update', 'gradle-update']],
  ]);
});

test('groups: the biggest first, then by their words; none when no two skills share a word', () => {
  const skills = ['beta-common', 'beta-rare', 'alpha-common', 'alpha-rare', 'gamma-common'].map((name) => skill(name));
  assert.deepEqual(groupSkills(skills).map(({ words, skills }) => `${words.join(' ')}: ${skills.length}`), ['common: 3', 'alpha: 2', 'beta: 2', 'rare: 2']);
  assert.deepEqual(groupSkills([skill('commits'), skill('lint'), skill('deploy')]), []);
  assert.deepEqual(groupSkills([]), []);
});

test('groups: across repositories, the skills by name, then repository, then path', () => {
  const skills = [skill('review', undefined, 'JetBrains/mps'), skill('code-review'), skill('review', undefined, 'JetBrains/kotlin')];
  assert.deepEqual(summary(skills), [
    ['review', ['JetBrains/kotlin:.agents/skills/code-review/SKILL.md', 'JetBrains/kotlin:.agents/skills/review/SKILL.md', 'JetBrains/mps:.agents/skills/review/SKILL.md']],
  ]);
});

test('lines: in all of the skills, in some of the others, or only in this one; compared trimmed, a blank line in all', () => {
  const [a, b, c] = compareLines([
    skill('a', 'shared\n\n  two of them\nonly a\n'),
    skill('b', 'shared  \ntwo of them\r\nonly b'),
    skill('c', 'only c\nshared\n'),
  ]);
  assert.deepEqual(a.lines, [
    { text: 'shared', kind: 'all' },
    { text: '', kind: 'all' },
    { text: '  two of them', kind: 'some' },
    { text: 'only a', kind: 'own' },
  ]);
  assert.deepEqual(b.lines, [{ text: 'shared  ', kind: 'all' }, { text: 'two of them', kind: 'some' }, { text: 'only b', kind: 'own' }]);
  assert.deepEqual(c.lines, [{ text: 'only c', kind: 'own' }, { text: 'shared', kind: 'all' }]);
});
