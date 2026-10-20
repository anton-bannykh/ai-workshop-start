# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
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
## What is a project skill?
`<root>/<name>/SKILL.md`, `<root>` is one of:
`.agents/skills`, `.claude/skills`,
`.github/skills`, `agent/skills`
- The same `<name>` in two roots → one skill
- Anything else → not a skill