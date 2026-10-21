---
name: status-update
description: Post a short status update to the project's Slack channel — find when the last update was posted, see what reached `main` since, and post a few lines with emojis and links to the PRs. Use when asked for a status update, a summary of recent changes, or "what's new" in this repository.
---

# Status update

A few lines in Slack that tell the team what reached `main` since the last update. Short enough to read at a
glance: one line per PR, an emoji for its kind, a link.

The channel is `C0CAS41KRD3`. Post with `slack_post`, as [issue-to-pr](../issue-to-pr/SKILL.md#slack) says; the
bot token is in `SLACK_BOT_TOKEN`, don't print it. If Slack answers `"ok": false`, say so in the report and stop:
without the channel there is nothing to post to.

## 1. When was the last update

An update is a message in the channel from this bot that starts with `📣 *Status update*`. Find the latest one;
its `ts` is when it was posted:

```sh
me=$(curl -s https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq -r .bot_id)
cursor=; last=
while :; do
  page=$(curl -s -G https://slack.com/api/conversations.history -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    --data-urlencode channel=C0CAS41KRD3 --data-urlencode limit=200 --data-urlencode cursor="$cursor")
  jq -e .ok >/dev/null <<<"$page" || { jq -r '"Slack: \(.error)"' <<<"$page" >&2; break; }
  last=$(jq -r --arg me "$me" \
    '[.messages[] | select(.bot_id == $me and (.text | startswith("📣 *Status update*")))][0].ts // empty' <<<"$page")
  cursor=$(jq -r '.response_metadata.next_cursor // empty' <<<"$page")
  [ -n "$last" ] || [ -z "$cursor" ] && break
done
if [ -n "$last" ]; then since=$(date -u -d "@${last%.*}" +%FT%TZ); else since=$(date -u -d '7 days ago' +%FT%TZ); fi
```

No update yet (the first run): the last 7 days. If it printed a Slack error instead, stop, as above: without the
history, the period isn't known.

## 2. What happened on `main` since

- **Merged PRs**, oldest first:

  ```sh
  gh pr list --repo anton-bannykh/ai-workshop-start --state merged --base main --search "merged:>=$since" \
    --limit 100 --json number,title,url,mergedAt,headRefName,files |
    jq --arg since "$since" '[.[] | select(.mergedAt > $since)] | sort_by(.mergedAt)'
  ```

  The search counts whole seconds, so the `select` drops a PR merged in the same second as the last update,
  which that update already had.
- **Commits pushed straight to `main`**, not through a PR. The checkout may be shallow; fetch what's needed, then
  take the first-parent commits that aren't merges:

  ```sh
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
    git fetch -q --shallow-since="$since" origin main
  else
    git fetch -q origin main
  fi
  git log --first-parent --no-merges --since="$since" --format='%H %s' origin/main
  ```

  Drop those that came from a PR anyway (a squash or a rebase merge):
  `gh api repos/anton-bannykh/ai-workshop-start/commits/<sha>/pulls --jq '.[].number'` prints its PR, if any.

Read each PR's title, and its description and files if the title doesn't say what it does. Don't list PRs that
were closed without merging, or are still open.

## 3. Write it

```
📣 *Status update* — since <the last update, e.g. 21 Oct 11:30 UTC; or "the last 7 days">
• 🐛 <https://github.com/anton-bannykh/ai-workshop-start/pull/24|#24> Skill list: only the SKILL.md path, descriptions cut at two lines
• ✨ <https://github.com/anton-bannykh/ai-workshop-start/pull/20|#20> Show when each skill was last modified
• 🧰 <https://github.com/anton-bannykh/ai-workshop-start/pull/26|#26> New red-agent skill: find bugs in the web view, file them with a video
• 🔧 Straight to main: <https://github.com/anton-bannykh/ai-workshop-start/commit/3f6ae6b|the review skill is back>, <https://github.com/anton-bannykh/ai-workshop-start/commit/eb2414e|address-review adjusted>
```

- The header exactly as shown, `📣 *Status update*`: it's how the next run finds this one.
- One line per PR: an emoji, the linked number, then what it does in a few words — the title, shortened if it's
  long. Don't add detail the title doesn't need.
- The emoji, by what the PR does: 🐛 a fix (a `fix/` branch, `Fixes #…`); ✨ a feature of the CLI or web view;
  🧰 a skill or tooling for agents (`.agents/skills/`, `scripts/`); 🧪 tests and CI only; 📝 docs or the spec
  only. Pick the one that fits best; one per line.
- Commits straight to `main`: one 🔧 line for all of them, each its subject in a few words, linked to the commit
  (`commit/<sha>`). Not a compare link: it would take in the PRs merged in between too.
- In the text, escape `&`, `<` and `>` as `&amp;`, `&lt;` and `&gt;`, or Slack takes them for markup.

## 4. Post it

`slack_post "$message"`. If nothing reached `main` since the last update, say so, in one line with the header, so
the team knows the update ran and the next run starts from here:

```
📣 *Status update* — nothing new on main since 21 Oct 11:30 UTC 💤
```

## Report

To the user: the period covered (since when, and whether an earlier update was found), the message as posted, and
any Slack error.
