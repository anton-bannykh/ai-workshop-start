# Web view
`./skill-atlas serve [port]`: a local page, `http://127.0.0.1:<port>/`
Port 4173 by default; `0` picks a free one. The address is printed.
Listens on *127.0.0.1* only; *nothing is stored*.
## Page
- A **field** for a repository or organization link (or a directory, as in `scan`)
- **Tab** in the field completes the sample link, while the field is empty or its start; otherwise Tab moves on
- The repository: `<id> · N skills`
- The list of skills and the chosen SKILL.md **scroll independently**, each on its own; the page, as tall as the window, does not
- A **filter** on the top right: as you type, only the skills whose **name** contains it, ignoring case; *in the page*, no new scan
- While filtering, the counts are of the skills it keeps: `<id> · 2 of 42 skills`, and the same in the summary
- Each skill: **name**, description, link (path in **bold**), `also in` copies
- When it was last modified, in *grey*, out of the way: `DD-MM-YY`, local time; on the right of its name, and under
  its link when chosen (`Last modified DD-MM-YY`); no date known → nothing
- Choosing a skill shows **its SKILL.md**, *formatted*: the front matter as a table, the Markdown rendered
- A **Raw** tab: the SKILL.md as it is in the file
- An organization: `<owner> · N skills in M repositories · S scanned`; each repository a **group** with its heading,
  `<id> · N skills`, *collapsed* until opened; **Expand all** / **Collapse all**;
  the filter hides a group with no skill it keeps
- A repository with warnings, its own or a skill's: ❗ in its heading; its own *in its group*, above its skills;
  also one with no skills
- A skill with a warning: in the list, *only* ❗ by its name; choosing it shows the warning, above its SKILL.md
- While an organization is scanned: `Scanning… 5 of 688 repositories, 57 skills so far`
- Warnings and errors shown on the page; the other warnings out of the way, in a *collapsed* group: `❗ N warnings`
- `/?repo=<link>` opens the page with that repository scanned
## API
`GET /api/scan?repo=<GitHub URL | directory>` → JSON
`{ repository, skills, warnings }`; each skill has its `link`, `text` (the SKILL.md), `html`, `modified` (an ISO date, `''` when not known) and `warnings`, its own;
`warnings`, the repository's
An organization → `{ organization, repositories: [{ repository, skills, warnings }], scanned, warnings }`: the repositories
with skills or warnings, each with its own; `scanned`, how many repositories were; `warnings`, the organization's
`&progress` → `application/x-ndjson`: `{ progress: { done, total, skills } }` as each repository is done,
then `{ result }`, the same JSON; or `{ status, error }`. The page asks this way
## Formatting
- Any repository's file: *nothing in it runs*. Raw HTML → shown as text (a block of it as code)
- Links: `http`, `https`, `mailto`, `file`, `#anchors`; images: `http`, `https`, `file`; others → dropped
- Relative links → against the SKILL.md at the scanned commit; GitHub images → the raw file
- Malformed front matter → shown as it is; its warning, the skill's, above it
- A clear message → `400 { error }`; unknown paths → `404`; not `GET` → `405`
- Another `Host` than the local address → `403`
