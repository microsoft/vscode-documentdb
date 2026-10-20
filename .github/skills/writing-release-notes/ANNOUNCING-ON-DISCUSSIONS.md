# Announcing a Release on GitHub Discussions

Every release is announced in the **Announcements** category of
[GitHub Discussions](https://github.com/microsoft/vscode-documentdb/discussions). The body always comes
from `docs/release-notes/X.Y.md`, so write and commit the release notes first.

| Version type           | What to post                                                                                                            | Title                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Major or minor (X.Y.0) | One discussion with the whole release notes file, reusing a confirmed placeholder if present                            | `DocumentDB extension for Visual Studio Code vX.Y Released! <emoji>` |
| Patch (X.Y.Z, Z > 0)   | 1. Create or update the dedicated patch discussion<br>2. Then post the same text as a comment on the X.Y.0 announcement | `Patch Release vX.Y.Z 📎` (the 📎 emoji is part of the title)        |

## Ask about a placeholder before publishing

Always ask the operator: **Is there already a placeholder discussion for this release? If so, what
is its URL?** If the request already includes a placeholder URL, ask for confirmation that it is the
one to update instead of asking for the URL again. Wait for the answer before publishing. Create a
new discussion only after the operator confirms there is no placeholder.

When a placeholder is confirmed, read it and verify that it belongs to this repository's
**Announcements** category and is intended for this release. Ask the operator to resolve any
mismatch before editing. Update that discussion's title and body instead of creating another one.
For a patch, the placeholder must be the dedicated patch discussion, not the parent X.Y.0
announcement; the parent still receives a comment afterward.

Read the discussion using its number from the supplied URL, then use the returned node `id` to
update it with the title and prepared body from the applicable workflow below:

```bash
gh api graphql -f query='
query($number: Int!) {
  repository(owner: "microsoft", name: "vscode-documentdb") {
    discussion(number: $number) { id title url body category { name } }
  }
}' -F number=<discussion number> --jq '.data.repository.discussion'

gh api graphql -f query='
mutation($id: ID!, $title: String!, $body: String!) {
  updateDiscussion(input: {discussionId: $id, title: $title, body: $body}) {
    discussion { url }
  }
}' -f id=<discussion id> -f title='<release title>' -F body=@body.md \
  --jq '.data.updateDiscussion.discussion.url'
```

## Patch release: post, then comment

The order matters. Discussions sorts Announcements by most recent activity, so the X.Y.0 announcement
must receive its comment **after** the patch discussion is created or updated. That keeps the main release
announcement on top, with the patch post right below it.

1. **Extract the patch section** from the release notes. It starts at `## Patch Release vX.Y.Z` and
   ends before the next `---` separator (or at the end of the file). Use it as is, heading included:

   ```bash
   awk '/^## Patch Release vX.Y.Z$/{p=1} p&&/^---$/{exit} p' docs/release-notes/X.Y.md > patch-body.md
   ```

2. **Publish the patch discussion** in Announcements, titled `Patch Release vX.Y.Z 📎`. Update a
   confirmed placeholder using the command above with `patch-body.md`; otherwise, after the
   operator confirms there is no placeholder, create it:

   ```bash
   gh api graphql -f query='
   {
     repository(owner: "microsoft", name: "vscode-documentdb") {
       id
       discussionCategories(first: 20) { nodes { id name } }
     }
   }'

   gh api graphql -f query='
   mutation($repo: ID!, $cat: ID!, $title: String!, $body: String!) {
     createDiscussion(input: {repositoryId: $repo, categoryId: $cat, title: $title, body: $body}) {
       discussion { url }
     }
   }' -f repo=<repository id> -f cat=<Announcements category id> -f title="Patch Release vX.Y.Z 📎" \
     -F body=@patch-body.md --jq '.data.createDiscussion.discussion.url'
   ```

3. **Find the X.Y.0 announcement** for the version being patched. Do not assume it is the discussion
   that `releaseNotesUrl` in `package.json` points to: that is the announcement of the newest minor
   release, and a patch can target an older version (for example 1.0.2 shipped from a
   `release/1.0.2` branch while `main` is on 1.1). Look it up by title and check its content:

   ```bash
   gh api graphql -f query='
   query($cat: ID!) {
     repository(owner: "microsoft", name: "vscode-documentdb") {
       discussions(categoryId: $cat, first: 100) {
         nodes { number id title url body }
       }
     }
   }' -f cat=<Announcements category id> --jq '.data.repository.discussions.nodes[]
     | select(.title | contains("vX.Y Released"))
     | {number, id, title, url, heading: (.body | split("\n") | map(select(startswith("# "))) | first)}'
   ```

   - The title must contain `vX.Y Released`. Older titles use the retired product name (for example
     "DocumentDB for VS Code v0.7 Released! 🦈"), so match on the version, not on the name. The
     trailing space keeps `v0.1` from matching `v0.11`.
   - The `heading` (the first `# ` line of the body) must name the same `vX.Y` and must not be a
     patch heading. Compare a paragraph of the body with the opening of `docs/release-notes/X.Y.md`
     if in doubt.
   - Use the result only if exactly one discussion passes both checks. If none or several do, stop and
     ask the operator which discussion to use. Never fall back to `releaseNotesUrl` silently.
   - If Announcements ever holds more than 100 discussions, page through them with `pageInfo` and
     `after`.

4. **Comment on that announcement** with the same text, using the `id` from the lookup:

   ```bash
   gh api graphql -f query='
   mutation($id: ID!, $body: String!) {
     addDiscussionComment(input: {discussionId: $id, body: $body}) { comment { url } }
   }' -f id=<discussion id> -F body=@patch-body.md --jq '.data.addDiscussionComment.comment.url'
   ```

5. Check that the Announcements list shows the X.Y.0 announcement first and the patch discussion second.

## Major or minor release

1. Update the confirmed placeholder, or create the discussion only after the operator confirms
   there is no placeholder. Publish in Announcements with the release notes body (everything after the front
   matter, `sed '1,/^---$/d' docs/release-notes/X.Y.md`, read with `-F body=@file`), titled
   `DocumentDB extension for Visual Studio Code vX.Y Released! <emoji>`. Pick one emoji that fits the
   release.
2. Copy the discussion URL into `releaseNotesUrl` in `package.json`, so users reach the announcement
   from inside the extension.
3. Pin the new announcement and unpin the previous one. The API cannot pin discussions; use the
   **Pin discussion** and **Unpin discussion** actions on the discussion page.

## Things to know

- **Pass long bodies from a file.** Use `-F body=@file.md`. Passing the text inline can exceed the
  command-line length limit on Windows.
- **Images need absolute URLs.** Relative paths such as `./images/X.Y.Z_feature.png` do not render in
  Discussions. Upload each image by dragging it into any Discussions comment box (do not submit the
  comment), copy the generated `https://github.com/user-attachments/assets/...` URL, and replace the
  relative path in the body. There is no API for these uploads.
- **Keep `<picture>` light and dark pairs.** Upload both variants and set `srcset` and `src` to the two
  uploaded URLs.
- **Edit with `updateDiscussion`** (title and body) when the post needs a fix later. Keep the release
  notes file and the discussion text in sync.
