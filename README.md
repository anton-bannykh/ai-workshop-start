# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

`./skill-atlas serve` opens the same scan as a local web view at http://127.0.0.1:4173/: a field for
a repository link, its skills, and each skill's SKILL.md.

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests; `npm run test:e2e`,
with `GITHUB_TOKEN` set, runs the CLI against real JetBrains repositories on GitHub.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
