import { findSkills, type SkillFile } from './find.ts';
import { AtlasError, Unavailable } from './errors.ts';
import { sortRepositories, sortSkills, type Organization, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** A repository of an organization, opened only when its turn comes. */
export type RepositorySource = { id: string; open(): Promise<Source> };

/** An organization to scan: its repositories that may have skills. */
export type OrganizationSource = {
  organization: Organization;
  repositories: RepositorySource[];
  /** What listing the repositories had to leave out. */
  warnings: string[];
};

/** Only the repositories with skills, by id; every warning names its repository. */
export type OrganizationScanResult = {
  organization: Organization;
  repositories: { repository: Repository; skills: Skill[] }[];
  warnings: string[];
};

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : []))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

/** How far an organization's scan is: repositories scanned of all, and the skills found so far. */
export type Progress = { done: number; total: number; skills: number };

/**
 * Every repository opened and scanned, 8 at a time; one that cannot be read is skipped with a warning.
 * `progress` hears of each repository done.
 */
export async function scanOrganization(source: OrganizationSource, progress?: (progress: Progress) => void): Promise<OrganizationScanResult> {
  const total = source.repositories.length;
  let done = 0;
  let skills = 0;
  let stopped = false;
  progress?.({ done, total, skills });
  const results = await mapLimited(source.repositories, 8, async ({ id, open }) => {
    try {
      const result = await scan(await open());
      skills += result.skills.length;
      return { id, result, warnings: result.warnings };
    } catch (error) {
      // GitHub not answering at all stops the scan; anything else only skips this repository.
      if (!(error instanceof AtlasError) || error instanceof Unavailable) {
        stopped = true;
        throw error;
      }
      return { id, result: undefined, warnings: [`${error.message}; skipped`] };
    } finally {
      if (!stopped) progress?.({ done: ++done, total, skills });
    }
  });
  const byId = [...results].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scanned = results.flatMap(({ result }) => (result ? [result] : []));
  return {
    organization: source.organization,
    repositories: sortRepositories(scanned.filter((result) => result.skills.length > 0))
      .map(({ repository, skills }) => ({ repository, skills })),
    warnings: [...source.warnings, ...byId.flatMap(({ id, warnings }) => warnings.map((warning) => `${id}: ${warning}`))],
  };
}

/** `map` over the items, at most `limit` at a time, the results in the items' order; the first failure stops it. */
async function mapLimited<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      const index = next++;
      try {
        results[index] = await map(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warning?: string }> {
  const bytes = await source.read(file.path);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const text = new TextDecoder().decode(bytes);
  const parsed = parseSkill(text);
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: file.copies,
    text,
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}
