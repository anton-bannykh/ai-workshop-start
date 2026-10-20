/** A scanned organization, or a user: the owner of repositories on GitHub. */
export type Organization = {
  /** The login, for example `JetBrains`. */
  id: string;
  /** `https://github.com/<owner>`. */
  url: string;
};

/** A scanned repository. The hierarchy is organization → repository → skill. */
export type Repository = {
  /** `owner/name`, for example `JetBrains/kotlin`; a local directory's name. */
  id: string;
  organization: string;
  name: string;
  /** `https://github.com/<owner>/<repo>`, or a local directory's file:// URL. */
  url: string;
  /** The scanned commit; empty for a local directory. */
  commit: string;
};

/** One skill. Its link is derived, by `skillLink`. */
export type Skill = {
  /** `repo:path`, for example `JetBrains/kotlin:.claude/skills/x/SKILL.md`. */
  id: string;
  repository: string;
  path: string;
  name: string;
  description: string;
  /** The scanned commit, the one the link pins; empty for a local directory. */
  commit: string;
  /** The same skill in other agents' folders. */
  copies: string[];
  /** The SKILL.md itself, as it is in the file. */
  text: string;
  /** What went wrong reading this skill: its own, not its repository's. */
  warnings: string[];
};

/**
 * The SKILL.md file, from where its repository is: on GitHub at the scanned commit,
 * `https://github.com/<owner>/<repo>/blob/<commit>/<path>`; in a local directory, the file itself.
 */
export function skillLink(repository: Repository, skill: Skill): string {
  const { base, path } = skillLinkParts(repository, skill);
  return base + path;
}

/** `skillLink` in two parts: everything up to the skill's path, then the path itself. */
export function skillLinkParts(repository: Repository, skill: Skill): { base: string; path: string } {
  const path = skill.path.split('/').map(encodeURIComponent).join('/');
  return { base: skill.commit ? `${repository.url}/blob/${skill.commit}/` : `${repository.url}/`, path };
}

/** By id, in the same order everywhere, whatever the locale. */
export function sortRepositories<T extends { repository: Repository }>(repositories: T[]): T[] {
  return [...repositories].sort((a, b) => compare(a.repository.id, b.repository.id));
}

/** By name, then by path: the same order everywhere, whatever the locale. */
export function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => compare(a.name, b.name) || compare(a.path, b.path));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
