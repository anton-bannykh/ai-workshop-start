# Command line
`./skill-atlas scan <GitHub URL | directory>`; the URL: a repository or an organization
Prints the result **at once**, when the scan is done; *nothing is stored*.
While it runs, on a terminal: *one line* on stderr, rewritten in place, says how far it is; cleared before the result.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- The path part of the link in **bold** (ANSI)
- `also in <paths>` for copies; warnings go to *stderr*
## An organization
```
JetBrains · 132 skills in 16 repositories

JetBrains/Exposed · 2 skills
…

JetBrains/MPS · 42 skills
…
```
- Each repository as above, after a *blank line*: easy to see where one ends
- While it runs: `Scanning JetBrains: 5 of 16 repositories, 57 skills so far…`
- Each repository's warning names its repository; by repository, sorted by id
