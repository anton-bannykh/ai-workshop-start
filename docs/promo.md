# Skill Atlas: every AI agent skill on our GitHub, in seconds

Our teams are writing `SKILL.md` files for their AI agents, in every repository, each on their own. Nobody
can see them all, and the same skill gets copied, then drifts.

**Skill Atlas** shows them. Paste a repository or an organization link:

- **Every skill, found.** All of JetBrains, 688 repositories, scanned in seconds: 132 skills in 16 of them.
- **Read and searched.** Each SKILL.md formatted; filter all of them by name as you type.
- **Duplicates, grouped.** Skills whose names share a word, side by side, and any two diffed line by line:
  `code-style` in MPS and in intellij-community share 14 lines and differ in 34.

It works today, as a proof of concept: a CLI and a local web page, nothing stored. Taken to production, it
becomes the catalog of our agents' skills: shared, kept in sync, reused rather than rewritten.

The video: `npm run demo -- scripts/demos/promo.ts`, live GitHub, the scans sped up.
