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
- In the list, out of the way: the description, *two lines* at most, cut with `…`; of the link, only the SKILL.md's
  **path**, in grey, `SKILL.md` in **bold**, a link to it; the whole of each on hover; the whole link when chosen
- When it was last modified, in *grey*, out of the way: `DD-MM-YY`, local time; on the right of its name, and under
  its link when chosen (`Last modified DD-MM-YY`); no date known → nothing
- Choosing a skill shows **its SKILL.md**, *formatted*: the front matter as a table, the Markdown rendered;
  another skill *from its top*, wherever the last one was scrolled to; the same one again stays where it was
- A **Raw** tab: the SKILL.md as it is in the file
- An organization: `<owner> · N skills in M repositories · S scanned`; each repository a **group** with its heading,
  `<id> · N skills`, *collapsed* until opened; **Expand all** / **Collapse all**;
  the filter hides a group with no skill it keeps
- A repository with warnings, its own or a skill's: ❗ in its heading; its own *in its group*, above its skills;
  also one with no skills
- A skill with a warning: in the list, *only* ❗ by its name; choosing it shows the warning, above its SKILL.md
- While an organization is scanned: `Scanning… 5 of 688 repositories, 57 skills so far`; each repository with
  skills or warnings in the list *as soon as it is scanned*, in its place by id. Open it, choose a skill, filter,
  meanwhile: what comes after, and the result, leave them so. The groups, once it is done
- A scan that stops halfway: the repositories it listed stay, and the skill chosen; the error above them
- Warnings and errors shown on the page; the other warnings out of the way, in a *collapsed* group: `❗ N warnings`
- `/?repo=<link>` opens the page with that repository scanned
- **Skills** / **Groups**, as buttons by the title: two views of *the same scan*, in the page, not two pages: no new scan;
  the field, its Tab, the filter and its text stay; each view, back, as it was left (the skill or group chosen, the tab)
- A chosen skill: **Similar skills →**, under its link: the groups, *that skill marked*; no new scan
- The address says what is shown: `/?repo=<link>`, and `&view=groups`, `&skill=<id>` in the groups; a new scan
  leaves out `&skill`
## Groups
**Groups**, or `/?repo=<link>&view=groups`: the same skills, *grouped*, to see similar ones side by side, what is the
same in them and what is not
- A **group**: the skills whose **names** share a word, two at least; a skill is in a group for each word it shares
  - The words: split on anything not a letter or a digit, and between camelCase words; ignoring case; no single
    letters, nor `a an and by for from in of on or skill skills the to with`
  - Words shared by the *very same* skills: one group, `build · tools`, in the order of the first skill's name
  - An organization: *every repository's skills together*: the same skill copied in several repositories, grouped
- The biggest groups first, then by their words; in a group, the skills by name, then repository, then path
- The summary: `<id> · N groups · M skills`, an organization's `· S scanned`; while scanning, as for the skills
- Each group in the list: its words, `N skills`, its skills' names with the shared words *marked*
- The **filter**, the same one: only the groups with a skill whose **name** contains it, ignoring case; `2 of 5 groups`
- The first group chosen. A chosen group: its words, `N skills · K lines in all of them`, and two tabs; another group
  *from its top*, as another skill:
  - **Side by side**: a column for each skill, with its name, repository, description and link, then its SKILL.md
    line by line: in *all* of them in grey, in *some* plain, *only in this one* marked
  - **Compare two**: two of them, the first two at first, any two chosen; a line diff, the lines the same in grey,
    only in the first `−`, only in the second `+`; `N lines the same · X only in the first · Y only in the second`
  - Lines compared *trimmed*; a blank line is in all; the counts leave out the lines without a letter or a digit,
    a blank line, the front matter's `---`
- **Similar skills →**, or `/?repo=<link>&view=groups&skill=<id>`: the first group of that skill chosen, the skill marked in the list and in its column,
  and first in **Compare two**; a skill in no group → `No other skill here shares a word of its name with <path>.`
- No two skills share a word → `No two skills here share a word of their names.`
- Warnings, all of them, each naming its SKILL.md (and its repository), in a *collapsed* group: `❗ N warnings`;
  errors as for the skills
## API
`GET /api/scan?repo=<GitHub URL | directory>` → JSON
`{ repository, skills, warnings, groups }`; each skill has its `link`, `text` (the SKILL.md), `html`, `modified` (an ISO date, `''` when not known) and `warnings`, its own;
`warnings`, the repository's
An organization → `{ organization, repositories: [{ repository, skills, warnings }], scanned, warnings, groups }`: the repositories
with skills or warnings, each with its own; `scanned`, how many repositories were; `warnings`, the organization's;
`groups`, every repository's skills together
`groups`: each `{ words, skills }`, each skill its `id` and `kinds`, `'all' | 'some' | 'own'`, one for each line of
its `text`, split at `\n`, `\r\n` or `\r`, the last line end left out
`&progress` → `application/x-ndjson`: `{ progress: { done, total, skills } }` as each repository is done, each one
with skills or warnings in a `{ repository }` line before it, as in the result; then `{ result }`, the same JSON; or
`{ status, error }`. The page asks this way
## Formatting
- Any repository's file: *nothing in it runs*. Raw HTML → shown as text (a block of it as code)
- Links: `http`, `https`, `mailto`, `file`, `#anchors`; images: `http`, `https`, `file`; others → dropped
- Relative links → against the SKILL.md at the scanned commit; GitHub images → the raw file
- Malformed front matter → shown as it is; its warning, the skill's, above it
- A clear message → `400 { error }`; unknown paths → `404`; not `GET` → `405`
- Another `Host` than the local address → `403`
