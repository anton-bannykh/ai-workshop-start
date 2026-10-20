// Publishes recorded demos, and screenshots, for a pull request: uploads them to the `demos` branch of
// `origin`, never the repository it was forked from, and prints the Markdown that shows them in a PR
// description or comment.
// `demos` has no history in common with `main`, so the videos never reach it. Needs `gh`, logged in.
//
//   node scripts/publish-demo.ts --pr <number> <demo.webp>…
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

const BRANCH = 'demos';

/** `gh api`, with a JSON body on stdin: a video is too large for a command-line argument. */
function api(path: string, body?: unknown, method = body ? 'POST' : 'GET'): { ok: boolean; json: any } {
  const result = spawnSync('gh', ['api', '-X', method, path, ...(body ? ['--input', '-'] : [])], {
    input: body ? JSON.stringify(body) : undefined,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, json: result.stdout ? JSON.parse(result.stdout) : undefined };
}

/** `owner/repo` of `origin`. */
function origin(): string {
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`origin is not a GitHub repository: ${url}`);
  return match[1];
}

/** The `demos` branch, created with one README when it is not there yet. */
function ensureBranch(repo: string) {
  if (api(`repos/${repo}/git/ref/heads/${BRANCH}`).ok) return;
  const text = '# Demos\n\nRecorded demos of the web view, for pull requests: `pr-<number>/`. Not part of `main`.\n';
  const tree = api(`repos/${repo}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: text }] });
  const commit = api(`repos/${repo}/git/commits`, { message: 'Demos for pull requests', tree: tree.json.sha, parents: [] });
  const ref = api(`repos/${repo}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.json.sha });
  if (!ref.ok) throw new Error(`Cannot create the ${BRANCH} branch in ${repo}`);
}

/** Uploads the files for the PR; the URL of each, in order. Each upload keeps its own name, so an earlier
 * comment still shows what it showed. */
export function publish(pr: string, files: string[]): string[] {
  const repo = origin();
  ensureBranch(repo);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return files.map((file) => {
    const path = `pr-${pr}/${stamp}-${basename(file)}`;
    const put = api(`repos/${repo}/contents/${path}`, {
      message: `Demo for #${pr}: ${basename(file)}`,
      branch: BRANCH,
      content: readFileSync(file).toString('base64'),
    }, 'PUT');
    if (!put.ok) throw new Error(`Cannot upload ${file} to ${repo}: ${JSON.stringify(put.json)}`);
    return `https://github.com/${repo}/raw/${BRANCH}/${path}`;
  });
}

if (import.meta.main) {
  const { values, positionals: files } = parseArgs({ allowPositionals: true, options: { pr: { type: 'string' } } });
  if (!values.pr || !/^\d+$/.test(values.pr) || files.length === 0) {
    throw new Error('Usage: node scripts/publish-demo.ts --pr <number> <demo.webp>…');
  }
  const urls = publish(values.pr, files);
  // An image plays inline, in any browser; anything else, a link.
  console.log(files.map((file, index) => {
    const image = /\.(webp|gif|png)$/.exec(file);
    return image ? `![Demo: ${basename(file, image[0])}](${urls[index]})` : `[${basename(file)}](${urls[index]})`;
  }).join('\n'));
}
