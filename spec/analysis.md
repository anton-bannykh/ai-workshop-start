# Repository analysis
## Input
A **GitHub repository** URL, a **GitHub organization** (or user) URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**
Make the path part of the link bold
## Architecture
Core: fetch → find → parse. CLI and web view: *thin clients*.
Skill: id = `repo:path`, name, description, commit, text (the SKILL.md)
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
## An organization
`https://github.com/<owner>` (or `/orgs/<owner>`): every repository of the owner, at once
- Each repository on its own: its id, its skills, its commit; sorted by **id**
- Only the repositories *with skills*; forks left out
- With `GITHUB_TOKEN`: one code search for the owner, for *which* repositories; repositories with no skill are not opened
- Without it: every repository; only a small owner fits in the rate limit
- A repository's skills: from its skill roots *at its commit*, never from search's paths
  (owner-wide, search can leave a file out, or name one the commit no longer has)
- More than 1000 search results → a *warning*: GitHub returns the first 1000
- Search returning fewer results than it counted (pages repeat some) → a *warning*: some skills may be missing
- A repository that cannot be read → a *warning*, the scan goes on
- 8 repositories at a time; *progress* as each one is done: how many of how many, the skills so far
- Unknown owner, unreachable GitHub, the rate limit → a clear message, exit code 1
## What is a project skill?
`<root>/<name>/SKILL.md`, `<root>` is one of:
`.agents/skills`, `.claude/skills`,
`.github/skills`, `agent/skills`
- The same `<name>` in two roots → one skill
- Anything else → not a skill