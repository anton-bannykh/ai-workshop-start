import { AtlasError, Unavailable } from './errors.ts';
import { findSkills, SKILL_ROOTS } from './find.ts';
import { pool } from './pool.ts';
import type { Listing, OrganizationSource, Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** A higher rate limit, private repositories, and an organization's repositories through GraphQL. */
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

/**
 * Resolves the default branch to a commit and lists the files that may be skills, at that commit.
 * With a token, only the skill roots, a few small trees; without one, the whole tree in one request
 * when it fits, which spends less of the 60 an hour.
 */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<RepositoryInfo>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  return openRepository(github, info, (sha) => options.token ? rootPaths(github, info.full_name, sha) : treePaths(github, info.full_name, sha));
}

/**
 * Every repository of an organization or a user, forks left out. With a token, GraphQL lists them all
 * and looks into their skill roots, 10 repositories a query: one without a skill is never opened.
 * Without a token, each repository is opened and its skill roots listed, which only a small owner
 * fits in the rate limit. Either way, a repository's skills are the files at its commit.
 */
export async function openGitHubOrganization(input: string, options: GitHubOptions): Promise<OrganizationSource> {
  const name = parseGitHubOwnerUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const owner = await github.json<{ login: string; type: string }>(
    `${API}/users/${name.owner}`,
    `Organization or user not found: https://github.com/${name.owner}`,
  );
  const listing = `${API}/${owner.type === 'Organization' ? 'orgs' : 'users'}/${owner.login}/repos`;
  const warnings: string[] = [];
  return {
    organization: { id: owner.login, url: `https://github.com/${owner.login}` },
    warnings,
    list: options.token
      ? (found) => lookUp(github, owner.login, found, warnings)
      : async ({ total, repository }) => {
        for await (const page of repositories(github, listing)) {
          total(page.length);
          for (const info of page) repository({ id: info.full_name, open: () => openRepository(github, info, (sha) => rootPaths(github, info.full_name, sha)) });
        }
      },
  };
}

type RepositoriesPage = {
  repositoryOwner: { repositories: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ({ id: string; nameWithOwner: string } | null)[] } };
};

type Entries = { entries: { name: string; type: string; mode: number; object?: Entries | null }[] } | null;

const REPOSITORIES = `query($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 100, after: $after, isFork: false, ownerAffiliations: OWNER) {
      totalCount pageInfo { hasNextPage endCursor } nodes { id nameWithOwner }
    }
  }
}`;

// HEAD is the default branch's commit, the one `oid` names. Each skill root's directories, and their files.
const SKILL_ROOT_FILES = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Repository {
      nameWithOwner
      defaultBranchRef { target { oid } }
      ${SKILL_ROOTS.map((root, index) => `root${index}: object(expression: "HEAD:${root}") { ...directories }`).join('\n      ')}
    }
  }
}
fragment directories on GitObject { ... on Tree { entries { name type mode object { ... on Tree { entries { name type mode } } } } } }`;

/**
 * Lists the owner's repositories, 100 a page, and looks into each one's skill roots as its page comes:
 * 10 repositories a query, 8 queries at a time. Only one with skills is to be scanned.
 * The total is the repositories listed, page by page: GitHub's `totalCount` may count ones the token
 * cannot read, which it does not list; if it does, a warning says how many.
 */
async function lookUp(github: Client, login: string, { total, checked, repository }: Listing, warnings: string[]): Promise<void> {
  const queries = pool(8);
  let counted = 0;
  let listed = 0;
  for (let after: string | null = null; !queries.failed;) {
    const answer: RepositoriesPage = await github.graphql(REPOSITORIES, { login, after });
    const page = answer.repositoryOwner.repositories;
    counted = page.totalCount;
    // A repository the token may not read can be left out of a page, or answered as null.
    const nodes = page.nodes.filter((node) => node !== null);
    listed += nodes.length;
    total(nodes.length);
    for (let start = 0; start < nodes.length; start += 10) {
      const batch = nodes.slice(start, start + 10);
      void queries.run(async () => {
        let answer: { nodes: ({ nameWithOwner: string; defaultBranchRef: { target: { oid: string } } | null } & Record<string, Entries> | null)[] };
        try {
          answer = await github.graphql(SKILL_ROOT_FILES, { ids: batch.map((node) => node.id) });
        } catch (error) {
          if (!(error instanceof AtlasError) || error instanceof Unavailable) throw error;
          // A query that fails costs its repositories, not the scan: each is skipped, with the reason.
          for (const { nameWithOwner } of batch) repository({ id: nameWithOwner, open: () => Promise.reject(error) });
          return;
        }
        let without = 0;
        for (const [index, node] of answer.nodes.entries()) {
          const { id: nodeId, nameWithOwner: id } = batch[index];
          if (!node) {
            repository({ id, open: () => Promise.reject(new AtlasError(`GitHub's GraphQL API answered nothing for it (${nodeId})`)) });
            continue;
          }
          const sha = node.defaultBranchRef?.target.oid;
          // An empty repository has no commit, and no skills.
          const paths = sha ? SKILL_ROOTS.flatMap((root, rootIndex) => rootFiles(root, node[`root${rootIndex}`])) : [];
          if (!sha || findSkills(paths).length === 0) without++;
          else repository({ id, open: async () => source(github, id, sha, paths) });
        }
        checked(without);
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  await queries.done();
  if (counted > listed) {
    warnings.push(`GitHub counts ${counted} repositories, but lists only ${listed} to this token; the other ${counted - listed} cannot be read with it and were not scanned`);
  }
}

/** `<root>/<directory>/<file>` for each regular file in each of the root's directories. */
function rootFiles(root: string, tree: Entries | undefined): string[] {
  return (tree?.entries ?? []).flatMap((directory) => directory.type !== 'tree' ? [] : (directory.object?.entries ?? [])
    .filter((file) => file.type === 'blob' && file.mode !== SYMLINK)
    .map((file) => `${root}/${directory.name}/${file.name}`));
}

/** A symbolic link's mode, 120000 in octal: its content is its target, not a SKILL.md. */
const SYMLINK = 0o120000;

/** The repository at its default branch's commit; `list` gives its files at that commit. An empty repository has none. */
async function openRepository(github: Client, info: RepositoryInfo, list: (sha: string) => Promise<string[]>): Promise<Source> {
  const id = info.full_name;
  let sha: string;
  try {
    ({ sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`));
  } catch (error) {
    if (error instanceof Empty) return source(github, id, '', []);
    throw error;
  }
  return source(github, id, sha, await list(sha));
}

/** The repository at the commit, with its files; each read at that commit. With a token, when each skill was last modified. */
function source(github: Client, id: string, sha: string, paths: string[]): Source {
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings: [],
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
    modified: github.authorized ? (directories) => lastModified(github, id, sha, directories) : undefined,
  };
}

/** The last commit that changed each path, from the commit back: one history each, `count` paths a query. */
function lastModifiedQuery(count: number): string {
  const paths = Array.from({ length: count }, (_, index) => index);
  return `query($owner: String!, $name: String!, $commit: GitObjectID!, ${paths.map((index) => `$path${index}: String!`).join(', ')}) {
  repository(owner: $owner, name: $name) {
    object(oid: $commit) {
      ... on Commit {
        ${paths.map((index) => `path${index}: history(first: 1, path: $path${index}) { nodes { committedDate } }`).join('\n        ')}
      }
    }
  }
}`;
}

type History = { nodes: { committedDate: string }[] } | null;

/**
 * When each directory was last modified: the date of the last commit that changed it, up to the commit.
 * Over GraphQL, so with a token only: without one, a request per skill would spend the 60 an hour.
 * A history is slow to look up in a large repository: 10 paths a query, all of them at once.
 */
async function lastModified(github: Client, id: string, sha: string, directories: string[]): Promise<Map<string, string>> {
  const [owner, name] = id.split('/');
  const sorted = [...directories].sort();
  const batches = [];
  for (let start = 0; start < sorted.length; start += 10) batches.push(sorted.slice(start, start + 10));
  const answers = await Promise.all(batches.map((batch) => github.graphql<{ repository: { object: Record<string, History> | null } | null }>(
    lastModifiedQuery(batch.length),
    { owner, name, commit: sha, ...Object.fromEntries(batch.map((path, index) => [`path${index}`, path])) },
  )));
  const modified = new Map<string, string>();
  for (const [index, answer] of answers.entries()) {
    for (const [at, path] of batches[index].entries()) {
      const date = answer.repository?.object?.[`path${at}`]?.nodes[0]?.committedDate;
      if (date) modified.set(path, date);
    }
  }
  return modified;
}

/** Every repository on the listing's pages, forks left out, a page at a time. */
async function* repositories(github: Client, url: string): AsyncGenerator<RepositoryInfo[]> {
  for (let page = 1; ; page++) {
    const listed = await github.json<(RepositoryInfo & { fork: boolean })[]>(`${url}?per_page=100&page=${page}`);
    yield listed.filter((info) => !info.fork);
    if (listed.length < 100) return;
  }
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer: the same skills. */
async function treePaths(github: Client, id: string, sha: string): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  return tree.truncated ? rootPaths(github, id, sha) : files(tree);
}

/** The files in the skill roots: all a skill can be, in a few small trees even for the largest repository. */
async function rootPaths(github: Client, id: string, sha: string): Promise<string[]> {
  const paths = await Promise.all(SKILL_ROOTS.map(async (root) => {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) return [];
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    return files(subtree).map((path) => `${root}/${path}`);
  }));
  return paths.flat();
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

/** GitHub's answer for a repository without a commit: it has no files, and so no skills. */
class Empty extends AtlasError {}

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  // A private repository's files too, on raw.githubusercontent.com as on the API.
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: Parameters<Fetch>[1]): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new Unavailable(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string, init?: Parameters<Fetch>[1]): Promise<unknown> {
    const response = await get(url, { ...init, headers: { ...headers, ...auth } });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new Unavailable(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new Unavailable('GitHub rejected the token in GITHUB_TOKEN');
    if (response.status === 409) throw new Empty(`GitHub answered 409 for ${url}${text && `: ${text}`}`);
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** Whether it asks with a token: GraphQL needs one. */
    authorized: Boolean(token),
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A GraphQL answer's data; a query that times out (502, 504) is asked once more. */
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const ask = () => request(`${API}/graphql`, 'GitHub GraphQL not found', { method: 'POST', body: JSON.stringify({ query, variables }) });
      let answer: { data?: T | null; errors?: { type?: string; message: string }[] };
      try {
        answer = await ask() as typeof answer;
      } catch (error) {
        if (!(error instanceof AtlasError) || !/^GitHub answered 50[24] /.test(error.message)) throw error;
        answer = await ask() as typeof answer;
      }
      const errors = answer.errors ?? [];
      if (errors.some((error) => error.type === 'RATE_LIMITED')) throw new Unavailable('GitHub rate limit reached; try again in a minute');
      // A partial answer is still an answer: what it could not resolve is null.
      if (!answer.data) throw new AtlasError(`GitHub GraphQL answered: ${errors.map((error) => error.message).join('; ') || 'no data'}`);
      return answer.data;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url, { headers: auth });
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
