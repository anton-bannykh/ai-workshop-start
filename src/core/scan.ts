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

/** An organization to scan: its repositories that may have skills. */
export type OrganizationSource = {
  organization: Organization;
  repositories: Source[];
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

/** Every repository scanned, at the same time; one that cannot be read is skipped with a warning. */
export async function scanOrganization(source: OrganizationSource): Promise<OrganizationScanResult> {
  const warnings = [...source.warnings];
  const results = await Promise.all(source.repositories.map((repository) => scan(repository).catch((error: unknown) => {
    if (!(error instanceof AtlasError) || error instanceof Unavailable) throw error;
    warnings.push(`${repository.repository.id}: ${error.message}; skipped`);
    return undefined;
  })));
  const scanned = results.filter((result) => result !== undefined);
  return {
    organization: source.organization,
    repositories: sortRepositories(scanned.filter((result) => result.skills.length > 0))
      .map(({ repository, skills }) => ({ repository, skills })),
    warnings: [...warnings, ...sortRepositories(scanned).flatMap(({ repository, warnings }) => warnings.map((warning) => `${repository.id}: ${warning}`))],
  };
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
