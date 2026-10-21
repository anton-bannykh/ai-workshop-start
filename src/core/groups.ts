// Similar skills, side by side: the skills grouped by the words their names share, and in each group
// what is the same in their SKILL.md files and what is not. A heuristic, but one easy to follow.
import type { Skill } from './model.ts';

/** Words that say nothing of what a skill is about. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'skill', 'skills', 'the', 'to', 'with']);

/**
 * A line of a skill's SKILL.md, and where else it is in its group: in `all` of the skills, in `some`
 * of the others, or only in this one, its `own`. Lines are compared trimmed; a blank line is in `all`.
 */
export type GroupLine = { text: string; kind: 'all' | 'some' | 'own' };

/** A skill of a group, with its SKILL.md line by line. */
export type GroupedSkill = { skill: Skill; lines: GroupLine[] };

/** Skills whose names share `words`, two at least; the skills by name, then repository, then path. */
export type SkillGroup = { words: string[]; skills: GroupedSkill[] };

/** A name's words: split on anything not a letter or a digit, and between camelCase words; lower case, no stop words. */
export function nameWords(name: string): string[] {
  const words = name.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

/**
 * The groups of skills that share a word of their names: one for each such word; words shared by the
 * very same skills make one group. A skill is in a group for each word it shares. The biggest groups
 * first, then by their words.
 */
export function groupSkills(skills: Skill[]): SkillGroup[] {
  const sorted = [...skills].sort((a, b) => compare(a.name, b.name) || compare(a.repository, b.repository) || compare(a.path, b.path));
  const byWord = new Map<string, Skill[]>();
  for (const skill of sorted) {
    for (const word of nameWords(skill.name)) byWord.set(word, [...(byWord.get(word) ?? []), skill]);
  }
  const byMembers = new Map<string, { words: string[]; skills: Skill[] }>();
  for (const [word, members] of byWord) {
    if (members.length < 2) continue;
    const key = members.map((skill) => skill.id).join('\n');
    const group = byMembers.get(key);
    if (group) group.words.push(word);
    else byMembers.set(key, { words: [word], skills: members });
  }
  return [...byMembers.values()]
    .map(({ words, skills }) => {
      // In the order they come in the first skill's name: `build · tools`, as in build-tools-…
      const order = nameWords(skills[0].name);
      return { words: words.sort((a, b) => order.indexOf(a) - order.indexOf(b)), skills: compareLines(skills) };
    })
    .sort((a, b) => b.skills.length - a.skills.length || compare(a.words.join(' '), b.words.join(' ')));
}

/** Each skill's SKILL.md, each line marked: in all of the skills, in some of the others, or its own. */
export function compareLines(skills: Skill[]): GroupedSkill[] {
  const lines = skills.map((skill) => skill.text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));
  const sets = lines.map((text) => new Set(text.map((line) => line.trim())));
  return skills.map((skill, index) => ({
    skill,
    lines: lines[index].map((text) => {
      const line = text.trim();
      const others = sets.filter((set, other) => other !== index && set.has(line)).length;
      const kind = line === '' || others === skills.length - 1 ? 'all' : others > 0 ? 'some' : 'own';
      return { text, kind };
    }),
  }));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
