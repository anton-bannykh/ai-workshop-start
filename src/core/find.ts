/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills, in the order a skill's copies are ranked. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/**
 * Every `<root>/<name>/SKILL.md`, named after its directory; any other file is not a skill. The same
 * name in several roots is one skill: at the first root in SKILL_ROOTS, with the others as copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const byName = new Map<string, { root: number; path: string }[]>();
  for (const path of paths) {
    const found = skillPath(path);
    if (found) byName.set(found.name, [...(byName.get(found.name) ?? []), { root: found.root, path }]);
  }
  return [...byName].map(([name, files]) => {
    const [first, ...copies] = files.sort((a, b) => a.root - b.root);
    return { path: first.path, name, copies: copies.map((copy) => copy.path) };
  });
}

/** `<root>/<name>/SKILL.md` as its root's index and its name, or undefined if it is not that. */
function skillPath(path: string): { root: number; name: string } | undefined {
  const parts = path.split('/');
  if (parts.length !== 4 || parts[3] !== 'SKILL.md' || !parts[2]) return undefined;
  const root = SKILL_ROOTS.indexOf(`${parts[0]}/${parts[1]}`);
  return root < 0 ? undefined : { root, name: parts[2] };
}
