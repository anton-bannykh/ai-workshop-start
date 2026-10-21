// The web view for the visual tests: GitHub answers from tests/helpers.ts, and from HANDBOOK below, a
// repository with a SKILL.md that shows what the formatting does. Nothing reaches the network, so every
// run shows the same pages.
import { AtlasError } from '../../src/core/errors.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOwnerUrl, parseGitHubUrl } from '../../src/core/github.ts';
import { replay, type Recording } from '../../src/core/replay.ts';
import { createWebServer, listen } from '../../src/web.ts';
import { github, lastModified, tree } from '../helpers.ts';

export const PORT = 4174;
const HANDBOOK_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const RAW = `https://raw.githubusercontent.com/JetBrains/handbook/${HANDBOOK_COMMIT}`;

const RELEASE = `---
name: release
description: Cut a release of the product. Run it from a clean main branch.
allowed-tools: Bash, Read
---
# Release

Cut a release in **four steps**; stop at the first that fails.

## Steps

1. Check that \`main\` is green.
2. Bump the version in \`build.gradle.kts\`.
3. Tag it: \`git tag v<version>\`.
4. Publish the [release notes](docs/release-notes.md).

| Channel | Who | When |
| --- | --- | --- |
| EAP | everyone who opted in | every week |
| Stable | all users | when EAP is quiet |

\`\`\`sh
./gradlew publish -Pversion=1.2.3
\`\`\`

> Never release on a Friday.
`;

const REVIEW = `---
name: review
description: Review a change the way this team does. Short, honest, actionable. Read the whole diff first, then say what it does, what is good about it, and what to fix, most important first.
---
# Review

- What the change does, in a sentence
- What is good about it
- What to fix, most important first
`;

/** JetBrains/handbook: release, and review with a copy in .claude/skills. */
const HANDBOOK: Recording = {
  'https://api.github.com/repos/JetBrains/handbook': { status: 200, body: { full_name: 'JetBrains/handbook', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/handbook/commits/main': { status: 200, body: { sha: HANDBOOK_COMMIT } },
  [`https://api.github.com/repos/JetBrains/handbook/git/trees/${HANDBOOK_COMMIT}`]: tree({ '.agents': 'h1', '.claude': 'h3' }),
  'https://api.github.com/repos/JetBrains/handbook/git/trees/h1': tree({ skills: 'h2' }),
  'https://api.github.com/repos/JetBrains/handbook/git/trees/h2?recursive=1':
    tree({ release: 'h5', 'release/SKILL.md': null, review: 'h6', 'review/SKILL.md': null }),
  'https://api.github.com/repos/JetBrains/handbook/git/trees/h3': tree({ skills: 'h4' }),
  'https://api.github.com/repos/JetBrains/handbook/git/trees/h4?recursive=1': tree({ review: 'h7', 'review/SKILL.md': null }),
  [`${RAW}/.agents/skills/release/SKILL.md`]: { status: 200, body: RELEASE },
  [`${RAW}/.agents/skills/review/SKILL.md`]: { status: 200, body: REVIEW },
  [`${RAW}/.claude/skills/review/SKILL.md`]: { status: 200, body: REVIEW },
  ...lastModified('JetBrains/handbook', HANDBOOK_COMMIT, { '.agents/skills/release': '2026-09-28T12:00:00Z', '.agents/skills/review': '2026-05-07T12:00:00Z' }),
  // A repository that does not exist.
  'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } },
};

const fetch = replay(HANDBOOK, github);
const open = (input: string) => {
  if (parseGitHubOwnerUrl(input)) return openGitHubOrganization(input, { fetch, token: 'test' });
  if (parseGitHubUrl(input)) return openGitHub(input, { fetch, token: 'test' });
  // Not a local directory: its file:// links would show where this checkout is.
  throw new AtlasError(`Not recorded for the visual tests: ${input}`);
};

if (import.meta.main) console.log(`Skill Atlas at ${await listen(createWebServer(open), PORT)}`);
