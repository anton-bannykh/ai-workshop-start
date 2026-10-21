// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE and ORGANIZATION below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { SKILL_ROOTS } from '../src/core/find.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { graphql, replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/**
 * When a repository's skill directories were last modified, as GraphQL answers it at the commit: the
 * directories sorted, 5 a query. A date of null: no commit changed it, as for a path not there.
 */
export function lastModified(id: string, commit: string, dates: Record<string, string | null>): Recording {
  const [owner, name] = id.split('/');
  const directories = Object.keys(dates).sort();
  const recording: Recording = {};
  for (let start = 0; start < directories.length; start += 5) {
    const batch = directories.slice(start, start + 5);
    const paths = Object.fromEntries(batch.map((path, index) => [`path${index}`, path]));
    const histories = Object.fromEntries(batch.map((path, index) => [`path${index}`, { nodes: dates[path] ? [{ committedDate: dates[path] }] : [] }]));
    recording[graphql({ owner, name, commit, ...paths })] = { status: 200, body: { data: { repository: { object: histories } } } };
  }
  return recording;
}

/** When JetBrains/example's skill was last modified: the 14th of March, 2026. */
export const EXAMPLE_MODIFIED = '2026-03-14T12:26:53Z';

/** What GitHub answers for a small repository, JetBrains/example, with one skill; its skill roots are listed at its commit. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  // docs/SKILL.md is not a skill: its directory is never listed.
  [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}`]: tree({ '.claude': 'e1', docs: 'e4' }),
  'https://api.github.com/repos/JetBrains/example/git/trees/e1': tree({ skills: 'e2' }),
  'https://api.github.com/repos/JetBrains/example/git/trees/e2?recursive=1': tree({ commits: 'e3', 'commits/SKILL.md': null }),
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  ...lastModified('JetBrains/example', EXAMPLE_COMMIT, { '.claude/skills/commits': EXAMPLE_MODIFIED }),
};

/** The commits GitHub answers for JetBrains/tools and JetBrains/secret. */
export const TOOLS_COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const SECRET_COMMIT = '89abcdef0123456789abcdef0123456789abcdef';

/** A git tree as GitHub answers it: each path a blob, or a tree when its value is a sha. */
export function tree(entries: Record<string, string | null>) {
  return {
    status: 200,
    body: {
      truncated: false,
      tree: Object.entries(entries).map(([path, sha]) =>
        sha ? { path, mode: '040000', type: 'tree', sha } : { path, mode: '100644', type: 'blob', sha: '0' }),
    },
  };
}

/**
 * An organization's repositories as REST lists them, 100 a page, each page's `Link` naming the last: `[id, node id]`
 * each, a third `true` for a fork. And how many GraphQL counts, those listed but the forks unless `counted` says more.
 */
export function listedRepositories(login: string, repositories: [string, string, boolean?][], counted?: number): Recording {
  const pages = Math.max(1, Math.ceil(repositories.length / 100));
  const url = (page: number) => `https://api.github.com/orgs/${login}/repos?per_page=100&page=${page}`;
  const recording: Recording = {
    [graphql({ login })]: {
      status: 200,
      body: { data: { repositoryOwner: { repositories: { totalCount: counted ?? repositories.filter(([, , fork]) => !fork).length } } } },
    },
  };
  for (let page = 1; page <= pages; page++) {
    recording[url(page)] = {
      status: 200,
      body: repositories.slice((page - 1) * 100, page * 100).map(([full_name, node_id, fork]) => ({ full_name, node_id, fork: Boolean(fork) })),
      headers: pages > 1 ? { Link: `<${url(Math.min(page + 1, pages))}>; rel="next", <${url(pages)}>; rel="last"` } : {},
    };
  }
  return recording;
}

/** A page of an owner's repositories, as GraphQL lists them: `[id, node id]` each; `next` the cursor of the next page. */
export function repositoriesPage(total: number, repositories: [string, string][], next?: string) {
  return {
    status: 200,
    body: {
      data: {
        repositoryOwner: {
          repositories: {
            totalCount: total,
            pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null },
            nodes: repositories.map(([nameWithOwner, id]) => ({ id, nameWithOwner })),
          },
        },
      },
    },
  };
}

/**
 * A repository as GraphQL answers for its skill roots: its commit (none when it is empty), and each
 * root's directories with their files; a file ending in `@` is a symbolic link.
 */
export function skillRoots(id: string, commit: string | null, roots: Record<string, Record<string, string[]> | string[]> = {}) {
  const entry = (name: string) => name.endsWith('@')
    ? { name: name.slice(0, -1), type: 'blob', mode: 0o120000 }
    : { name, type: 'blob', mode: 0o100644 };
  const root = (directories: Record<string, string[]> | string[] | undefined) => {
    if (!directories) return null;
    // A list: files at the root itself, not skills.
    if (Array.isArray(directories)) return { entries: directories.map(entry) };
    return { entries: Object.entries(directories).map(([name, files]) => ({ name, type: 'tree', mode: 0o040000, object: { entries: files.map(entry) } })) };
  };
  return {
    nameWithOwner: id,
    defaultBranchRef: commit ? { target: { oid: commit } } : null,
    ...Object.fromEntries(SKILL_ROOTS.map((name, index) => [`root${index}`, root(roots[name])])),
  };
}

/**
 * What GitHub answers for the JetBrains organization with a token: six repositories, and a fork, listed
 * over REST, looked into over GraphQL. JetBrains/example and JetBrains/tools have skills; JetBrains/docs has none and
 * JetBrains/empty has no commit, so neither is opened and they have no answers here.
 * JetBrains/secret is private: its file is read with the token. GraphQL answers nothing for
 * JetBrains/hidden.
 */
const ORGANIZATION: Recording = {
  'https://api.github.com/users/JetBrains': { status: 200, body: { login: 'JetBrains', type: 'Organization' } },
  ...listedRepositories('JetBrains', [
    ['JetBrains/example', 'R1'], ['JetBrains/docs', 'R2'], ['JetBrains/tools', 'R3'], ['JetBrains/fork', 'F1', true],
    ['JetBrains/empty', 'R4'], ['JetBrains/secret', 'R5'], ['JetBrains/hidden', 'R6'],
  ]),
  [graphql({ ids: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] })]: {
    status: 200,
    body: {
      data: {
        nodes: [
          skillRoots('JetBrains/example', EXAMPLE_COMMIT, { '.claude/skills': { commits: ['SKILL.md'] } }),
          skillRoots('JetBrains/docs', 'd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0'),
          skillRoots('JetBrains/tools', TOOLS_COMMIT, {
            '.agents/skills': { lint: ['SKILL.md'] },
            // A file in the root and a symbolic link are not skills; a skill's other files are not either.
            '.claude/skills': { lint: ['SKILL.md'], linked: ['SKILL.md@'] },
            '.github/skills': { build: ['SKILL.md', 'notes.md'] },
            'agent/skills': ['SKILL.md'],
          }),
          skillRoots('JetBrains/empty', null),
          skillRoots('JetBrains/secret', SECRET_COMMIT, { '.agents/skills': { deploy: ['SKILL.md'] } }),
          null,
        ],
      },
    },
  },
  [`https://raw.githubusercontent.com/JetBrains/tools/${TOOLS_COMMIT}/.agents/skills/lint/SKILL.md`]: {
    status: 200,
    body: '---\nname: lint\ndescription: Run the linters. Then fix what they find.\n---\n',
  },
  [`https://raw.githubusercontent.com/JetBrains/tools/${TOOLS_COMMIT}/.github/skills/build/SKILL.md`]: {
    status: 200,
    body: '---\nname: build\ndescription: [unclosed\n---\n',
  },
  ...lastModified('JetBrains/tools', TOOLS_COMMIT, { '.agents/skills/lint': '2025-12-31T12:00:00Z', '.github/skills/build': '2026-01-05T12:00:00Z' }),
  ...lastModified('JetBrains/secret', SECRET_COMMIT, { '.agents/skills/deploy': '2026-02-28T12:00:00Z' }),
};

/** JetBrains/secret's SKILL.md, there only for a request with the token, as for a private repository. */
const SECRET = `https://raw.githubusercontent.com/JetBrains/secret/${SECRET_COMMIT}/.agents/skills/deploy/SKILL.md`;
const recorded = replay({ ...EXAMPLE, ...ORGANIZATION });
export const github: Fetch = async (url, init) => {
  if (url !== SECRET) return recorded(url, init);
  if (init?.headers?.Authorization !== 'Bearer test') return new Response('404: Not Found', { status: 404 });
  return new Response('---\nname: deploy\ndescription: Deploy it.\n---\n');
};

/** What the CLI opens, with GitHub answering from EXAMPLE and ORGANIZATION, as with a token. */
export function open(input: string) {
  if (parseGitHubOwnerUrl(input)) return openGitHubOrganization(input, { fetch: github, token: 'test' });
  return parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input);
}

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE and ORGANIZATION. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const progress: string[] = [];
  const code = await run(args, {
    open,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    progress: (text) => progress.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), progress };
}
