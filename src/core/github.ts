import { AtlasError, Unavailable } from './errors.ts';
import { findSkills, SKILL_ROOTS } from './find.ts';
import type { OrganizationSource, Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/** `https://github.com/owner`, an organization or a user, with or without the scheme or a trailing slash. */
export function parseGitHubOwnerUrl(input: string): { owner: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?:orgs\/)?([\w.-]+)\/?$/i.exec(input.trim());
  return match ? { owner: match[1] } : undefined;
}

type RepositoryInfo = { full_name: string; default_branch: string };

/** Resolves the default branch to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<RepositoryInfo>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  const warnings: string[] = [];
  const paths = options.token ? [...(await searchPaths(github, `repo:${info.full_name}`, warnings)).values()].flat() : undefined;
  return openRepository(github, info, paths, warnings);
}

/**
 * Every repository of an organization or a user that has skills. With a token, one code search
 * finds them all; without it, each repository's tree is listed, which only a small owner fits
 * in the rate limit. Forks are left out, as code search leaves them out.
 */
export async function openGitHubOrganization(input: string, options: GitHubOptions): Promise<OrganizationSource> {
  const name = parseGitHubOwnerUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const owner = await github.json<{ login: string; type: string }>(
    `${API}/users/${name.owner}`,
    `Organization or user not found: https://github.com/${name.owner}`,
  );
  const kind = owner.type === 'Organization' ? 'org' : 'user';
  const warnings: string[] = [];
  const opens: { id: string; open: () => Promise<Source> }[] = [];
  if (options.token) {
    const found = await searchPaths(github, `${kind}:${owner.login}`, warnings);
    // A repository whose SKILL.md files are none of them skills is not even opened.
    for (const [id, paths] of found) {
      if (findSkills(paths).length === 0) continue;
      opens.push({ id, open: async () => openRepository(github, await github.json<RepositoryInfo>(`${API}/repos/${id}`), paths, []) });
    }
  } else {
    for (const info of await repositories(github, `${API}/${kind === 'org' ? 'orgs' : 'users'}/${owner.login}/repos`)) {
      opens.push({ id: info.full_name, open: () => openRepository(github, info, undefined, []) });
    }
  }
  // One repository that cannot be opened, empty for one, is skipped; GitHub not answering at all is not.
  const sources = await mapLimited(opens, 8, ({ id, open }) => open().catch((error: unknown) => {
    if (!(error instanceof AtlasError) || error instanceof Unavailable) throw error;
    warnings.push(`${id}: ${error.message}; skipped`);
    return undefined;
  }));
  return {
    organization: { id: owner.login, url: `https://github.com/${owner.login}` },
    repositories: sources.filter((source) => source !== undefined),
    warnings,
  };
}

/** The repository at its default branch's commit; its files from `paths`, or from its tree. */
async function openRepository(github: Client, info: RepositoryInfo, paths: string[] | undefined, warnings: string[]): Promise<Source> {
  const id = info.full_name;
  const { sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`);
  const listed = paths ?? (await treePaths(github, id, sha, warnings));
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths: listed,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Every SKILL.md code search finds for the qualifier, by repository; it looks at default branches, 100 results a page. */
async function searchPaths(github: Client, qualifier: string, warnings: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, Set<string>>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: { path: string; repository?: { full_name: string } }[] }>(
      `${API}/search/code?q=filename:SKILL.md+${qualifier}&per_page=100&page=${page}`,
    );
    for (const item of result.items) {
      const id = item.repository?.full_name ?? '';
      found.set(id, (found.get(id) ?? new Set()).add(item.path));
    }
    if (result.total_count > 1000 && page === 1) {
      warnings.push(`GitHub search found ${result.total_count} SKILL.md files and returns only the first 1000`);
    }
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return new Map([...found].map(([id, paths]) => [id, [...paths]]));
}

/** Every repository on the listing's pages, forks left out. */
async function repositories(github: Client, url: string): Promise<RepositoryInfo[]> {
  const all: RepositoryInfo[] = [];
  for (let page = 1; ; page++) {
    const listed = await github.json<(RepositoryInfo & { fork: boolean })[]>(`${url}?per_page=100&page=${page}`);
    all.push(...listed.filter((info) => !info.fork));
    if (listed.length < 100) return all;
  }
}

/** `map` over the items, at most `limit` at a time, the results in the items' order. */
async function mapLimited<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string, warnings: string[]): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')} (GITHUB_TOKEN searches everywhere)`);
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new Unavailable(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new Unavailable(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new Unavailable('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
