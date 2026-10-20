// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLinkParts, type Repository, type Skill } from './core/model.ts';
import { scan, scanOrganization, type OrganizationScanResult, type OrganizationSource, type ScanResult, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan: a repository, or an organization's repositories. */
  open(input: string): Promise<Source | OrganizationSource>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** How far a scan is, in place of the last such line; '' clears it. Only a terminal has it. */
  progress?(text: string): void;
  /** Starts the web view on the port and returns its address; only the Node CLI has it. */
  serve?(port: number): Promise<string>;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository, or in an organization's
                                  repositories (https://github.com/<owner>), and print it
  serve [port]                    open the web view on 127.0.0.1 (port 4173 by default)
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'serve') await serveCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const progress = context.progress ?? (() => {});
  progress(`Scanning ${args[0]}…`);
  let result;
  try {
    const source = await context.open(args[0]);
    result = 'organization' in source
      ? await scanOrganization(source, ({ done, total, skills }) =>
        progress(`Scanning ${source.organization.id}: ${done} of ${total} ${total === 1 ? 'repository' : 'repositories'}, ${count(skills)} so far…`))
      : await scan(source);
  } finally {
    progress('');
  }
  if ('organization' in result) printOrganization(result, context);
  else printRepository(result.repository, result.skills, context);
  for (const warning of warnings(result)) context.error(`warning: ${warning}`);
}

async function serveCommand(args: string[], context: Context) {
  if (args.length > 1 || !/^\d*$/.test(args[0] ?? '') || Number(args[0]) > 65535) {
    throw new AtlasError('Usage: skill-atlas serve [port]');
  }
  if (!context.serve) throw new AtlasError('serve runs only from the command line');
  const address = await context.serve(args[0] ? Number(args[0]) : 4173);
  context.print(`Skill Atlas at ${address}`);
}

/** `<owner> · N skills in M repositories · S scanned`, then each repository with skills, after a blank line. */
function printOrganization(result: OrganizationScanResult, context: Context) {
  const withSkills = result.repositories.filter(({ skills }) => skills.length > 0);
  const total = withSkills.reduce((sum, { skills }) => sum + skills.length, 0);
  context.print(`${result.organization.id} · ${count(total)} in ${withSkills.length} ${withSkills.length === 1 ? 'repository' : 'repositories'} · ${result.scanned} scanned`);
  for (const { repository, skills } of withSkills) {
    context.print('');
    printRepository(repository, skills, context);
  }
}

/**
 * The organization's own warnings, then each repository's, by repository, each naming its repository.
 * A repository's: its own, then its skills', each naming its SKILL.md.
 */
function warnings(result: OrganizationScanResult | ScanResult): string[] {
  if (!('organization' in result)) return repositoryWarnings(result);
  return [...result.warnings, ...result.repositories.flatMap((scanned) => repositoryWarnings(scanned).map((warning) => `${scanned.repository.id}: ${warning}`))];
}

function repositoryWarnings({ skills, warnings }: ScanResult): string[] {
  return [...warnings, ...skills.flatMap(({ path, warnings }) => warnings.map((warning) => `${path}: ${warning}`))];
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${count(skills.length)}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    const link = skillLinkParts(repository, skill);
    print(`  ${link.base}${bold(link.path)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

/** `1 skill`, `2 skills`. */
function count(skills: number): string {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'}`;
}

/** ANSI bold, then back to normal intensity. */
export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}
