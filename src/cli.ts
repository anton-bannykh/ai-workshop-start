#!/usr/bin/env node
// The Node client: a GitHub repository or organization through the GitHub API, or a local
// directory; stdout and stderr, or the web view. Nothing is stored.
import { run } from './commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { createWebServer, listen } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const open = (input: string) => {
  if (parseGitHubOwnerUrl(input)) return openGitHubOrganization(input, { fetch, token });
  return parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input);
};

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // On a terminal only: one line, rewritten in place and cut to its width, when it has one, so it never wraps.
  progress: process.stderr.isTTY
    ? (text) => process.stderr.write(`\r\x1b[K${text.slice(0, (process.stderr.columns || Infinity) - 1)}`)
    : undefined,
  serve: (port) => listen(createWebServer(open), port),
});
