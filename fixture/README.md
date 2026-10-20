# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `agent/skills/commits` | the same skill in another root: a copy |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `SKILL.md` | at the repository root: not a skill |
| `.claude/skills/SKILL.md` | directly in a root, no `<name>`: not a skill |
| `.claude/skills/nested/deeper/SKILL.md` | too deep: not a skill |
| `.claude/skills/lowercase/skill.md` | not named exactly `SKILL.md`: not a skill |
| `docs/skills/notes/SKILL.md` | outside the roots: not a skill |
