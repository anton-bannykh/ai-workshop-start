// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE and ORGANIZATION below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill and a SKILL.md that is not one. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    // docs/SKILL.md is not a skill: it is never read, so it has no answer here.
    body: { total_count: 2, items: [{ path: '.claude/skills/commits/SKILL.md' }, { path: 'docs/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

/** The commit GitHub answers for JetBrains/tools. */
export const TOOLS_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * What GitHub answers for the JetBrains organization: code search finds SKILL.md files in four
 * repositories. JetBrains/example and JetBrains/tools have skills; JetBrains/docs has none, so it is
 * never opened and has no answers here; JetBrains/gone is no longer there.
 */
const ORGANIZATION: Recording = {
  'https://api.github.com/users/JetBrains': { status: 200, body: { login: 'JetBrains', type: 'Organization' } },
  'https://api.github.com/search/code?q=filename:SKILL.md+org:JetBrains&per_page=100&page=1': {
    status: 200,
    body: {
      total_count: 6,
      items: [
        { path: '.claude/skills/lint/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: '.claude/skills/commits/SKILL.md', repository: { full_name: 'JetBrains/example' } },
        { path: 'docs/SKILL.md', repository: { full_name: 'JetBrains/docs' } },
        { path: '.agents/skills/lint/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: '.github/skills/build/SKILL.md', repository: { full_name: 'JetBrains/tools' } },
        { path: '.claude/skills/old/SKILL.md', repository: { full_name: 'JetBrains/gone' } },
      ],
    },
  },
  'https://api.github.com/repos/JetBrains/tools': { status: 200, body: { full_name: 'JetBrains/tools', default_branch: 'master' } },
  'https://api.github.com/repos/JetBrains/tools/commits/master': { status: 200, body: { sha: TOOLS_COMMIT } },
  [`https://raw.githubusercontent.com/JetBrains/tools/${TOOLS_COMMIT}/.agents/skills/lint/SKILL.md`]: {
    status: 200,
    body: '---\nname: lint\ndescription: Run the linters. Then fix what they find.\n---\n',
  },
  [`https://raw.githubusercontent.com/JetBrains/tools/${TOOLS_COMMIT}/.github/skills/build/SKILL.md`]: {
    status: 200,
    body: '---\nname: build\ndescription: [unclosed\n---\n',
  },
  'https://api.github.com/repos/JetBrains/gone': { status: 404, body: { message: 'Not Found' } },
};

const github = replay({ ...EXAMPLE, ...ORGANIZATION });

/** What the CLI opens, with GitHub answering from EXAMPLE and ORGANIZATION, through code search as with a token. */
export function open(input: string) {
  if (parseGitHubOwnerUrl(input)) return openGitHubOrganization(input, { fetch: github, token: 'test' });
  return parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input);
}

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE and ORGANIZATION. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
