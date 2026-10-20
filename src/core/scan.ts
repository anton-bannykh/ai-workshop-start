import { findSkills, type SkillFile } from './find.ts';
import { AtlasError, Unavailable } from './errors.ts';
import { sortRepositories, sortSkills, type Organization, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';
import { pool } from './pool.ts';

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

/** What listing an organization's repositories tells, as it goes. */
export type Listing = {
  /** The owner has that many more repositories: how many there are to scan in all. */
  total(count: number): void;
  /** That many of them have no skill: scanned, without being opened. */
  checked(count: number): void;
  /** One that may have skills, to open and scan. */
  repository(repository: RepositorySource): void;
};

/** An organization to scan: its repositories, as they are listed. */
export type OrganizationSource = {
  organization: Organization;
  /** Lists the repositories; done once each one is told of. */
  list(listing: Listing): Promise<void>;
  /** What listing the repositories had to leave out. */
  warnings: string[];
};

/** A repository of an organization, with its own warnings. */
export type RepositoryResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/**
 * The repositories with skills, or with warnings, by id: one that could not be scanned has its
 * warnings and no skills. `warnings` are the organization's own.
 */
export type OrganizationScanResult = {
  organization: Organization;
  repositories: RepositoryResult[];
  warnings: string[];
};

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(results.map((result) => result.skill)),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

/** How far an organization's scan is: repositories scanned of all, and the skills found so far. */
export type Progress = { done: number; total: number; skills: number };

/**
 * Every repository listed is scanned, 8 at a time, as soon as it is; one that cannot be read is
 * skipped with a warning. `progress` hears of each repository done.
 */
export async function scanOrganization(source: OrganizationSource, progress?: (progress: Progress) => void): Promise<OrganizationScanResult> {
  let total = 0;
  let done = 0;
  let skills = 0;
  // GitHub not answering at all stops the scan; anything else only skips its repository.
  let stopped: { error: unknown } | undefined;
  const report = () => { if (!stopped) progress?.({ done, total, skills }); };
  const scans = pool(8);
  const results: RepositoryResult[] = [];
  await source.list({
    total(count) { total += count; report(); },
    checked(count) { done += count; report(); },
    repository({ id, open }) {
      if (stopped) throw stopped.error; // and so the listing stops too
      void scans.run(async () => {
        try {
          const result = await scan(await open());
          skills += result.skills.length;
          results.push(result);
        } catch (error) {
          if (!(error instanceof AtlasError) || error instanceof Unavailable) {
            stopped ??= { error };
            throw error;
          }
          const [organization, name] = id.split('/');
          const repository = { id, organization, name, url: `${source.organization.url}/${name}`, commit: '' };
          results.push({ repository, skills: [], warnings: [`${error.message}; skipped`] });
        }
        done++;
        report();
      });
    },
  });
  await scans.done();
  return {
    organization: source.organization,
    repositories: sortRepositories(results.filter((result) => result.skills.length > 0 || result.warnings.length > 0)),
    warnings: source.warnings,
  };
}

/**
 * The skill in the file. One that cannot be read is still a skill, there at the commit: it is listed
 * by its directory, without a description, and with a warning that says why.
 */
async function readSkill(source: Source, file: SkillFile): Promise<{ skill: Skill; warning?: string }> {
  let bytes: Uint8Array | undefined;
  let failure = 'not found at the scanned commit';
  try {
    bytes = await source.read(file.path);
  } catch (error) {
    if (!(error instanceof AtlasError) || error instanceof Unavailable) throw error;
    failure = error.message;
  }
  const text = bytes ? new TextDecoder().decode(bytes) : '';
  const parsed = bytes ? parseSkill(text) : { name: undefined, description: '', warning: `cannot be read (${failure}); listed by its directory name, without a description` };
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
