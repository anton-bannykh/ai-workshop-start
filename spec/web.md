# Web view
`./skill-atlas serve [port]`: a local page, `http://127.0.0.1:<port>/`
Port 4173 by default; `0` picks a free one. The address is printed.
Listens on *127.0.0.1* only; *nothing is stored*.
## Page
- A **field** for a repository link (or a directory, as in `scan`)
- **Tab** in the field completes the sample link, while the field is empty or its start; otherwise Tab moves on
- The repository: `<id> · N skills`
- Each skill: **name**, description, link (path in **bold**), `also in` copies
- Choosing a skill shows **its SKILL.md**, *formatted*: the front matter as a table, the Markdown rendered
- A **Raw** tab: the SKILL.md as it is in the file
- Warnings and errors shown on the page
- `/?repo=<link>` opens the page with that repository scanned
## API
`GET /api/scan?repo=<GitHub URL | directory>` → JSON
`{ repository, skills, warnings }`; each skill has its `link`, `text` (the SKILL.md) and `html`
## Formatting
- Any repository's file: *nothing in it runs*. Raw HTML → shown as text (a block of it as code)
- Links: `http`, `https`, `mailto`, `file`, `#anchors`; images: `http`, `https`, `file`; others → dropped
- Relative links → against the SKILL.md at the scanned commit; GitHub images → the raw file
- Malformed front matter → shown as it is, with the warning
- A clear message → `400 { error }`; unknown paths → `404`; not `GET` → `405`
- Another `Host` than the local address → `403`
