# Repository analysis
## Input
A **GitHub repository** URL, a **GitHub organization** (or user) URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**
Make the path part of the link bold
## Architecture
Core: fetch → find → parse. CLI and web view: *thin clients*.
Skill: id = `repo:path`, name, description, commit, text (the SKILL.md), modified, warnings (its own)
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory; a number as the file writes it, `1.10`, not `1.1`; so is the description
- The link pins the *scanned commit*
- **Modified**: when the skill was last modified, the date of the *last commit that changed its directory*, up to the
  scanned commit; a local directory: its newest file's modification time
  - With `GITHUB_TOKEN` only: GraphQL, 10 directories a query, all at once; without it, no date (a request each
    would spend the 60 an hour)
  - A directory no commit changed: no date; the dates cannot be asked for → a *warning*, the repository's; the
    scan goes on
- Only the skill roots, *at the scanned commit*; without `GITHUB_TOKEN`, the whole tree when it fits in one answer
- Malformed front matter → a *warning*, the skill's own; the scan goes on
- A SKILL.md that cannot be read → still listed, by its *directory name*, with a warning that says why
- A private repository: read with `GITHUB_TOKEN`, its SKILL.md files too
- Unreachable repository → a clear message, exit code 1
## An organization
`https://github.com/<owner>` (or `/orgs/<owner>`): every repository of the owner, at once
- Each repository on its own: its id, its skills, its commit; sorted by **id**
- Only the repositories *with skills* (the web view: or with warnings); forks left out
- With `GITHUB_TOKEN`: **GraphQL** lists *every* repository, 100 a page, and looks into each one's skill roots
  at its commit, 10 repositories a query, 8 queries at a time; a repository with no skill is not opened
- The repositories to scan: those GitHub *lists* to the token, counted page by page as they come. GitHub's
  `totalCount` may count more, ones the token cannot read (e.g. a private one behind SAML single sign-on the token
  is not authorized for) → a *warning* with both numbers; those are not scanned
- *No code search*: it returns 1000 results at most, and owner-wide it leaves files out and names ones gone
- Without it: every repository opened; only a small owner fits in the rate limit
- An empty repository: no skills, *no warning*
- A repository that cannot be read → a *warning*, its own; the scan goes on
- A GraphQL query that times out → asked *once more*; failing again → a warning for each of its repositories
- 8 repositories at a time; *progress* as each one is done: how many of all the owner's listed so far, the skills so far
- The result: the repositories with skills, and how many were *scanned*: most have no skills
- Unknown owner, unreachable GitHub, the rate limit → a clear message, exit code 1
## What is a project skill?
`<root>/<name>/SKILL.md`, `<root>` is one of:
`.agents/skills`, `.claude/skills`,
`.github/skills`, `agent/skills`
- The same `<name>` in two roots → one skill
- Anything else → not a skill