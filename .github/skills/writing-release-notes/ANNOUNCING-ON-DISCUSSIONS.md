# Announcing a Release on GitHub Discussions

Every release is announced in the **Announcements** category of
[GitHub Discussions](https://github.com/microsoft/vscode-documentdb/discussions). The body always comes
from `docs/release-notes/X.Y.md`, so write and commit the release notes first.

| Version type           | What to post                                                                                                              | Title                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Major or minor (X.Y.0) | One new discussion with the whole release notes file                                                                      | `DocumentDB extension for Visual Studio Code vX.Y Released! <emoji>` |
| Patch (X.Y.Z, Z > 0)   | 1. A new discussion with the patch section<br>2. Then the same text as a comment on the X.Y.0 announcement, in that order | `Patch Release vX.Y.Z 📎` (the 📎 emoji is part of the title)        |

## Patch release: post, then comment

The order matters. Discussions sorts Announcements by most recent activity, so the X.Y.0 announcement
must receive its comment **after** the patch discussion is created. That keeps the main release
announcement on top, with the patch post right below it.

1. **Extract the patch section** from the release notes. It starts at `## Patch Release vX.Y.Z` and
   ends before the next `---` separator (or at the end of the file). Use it as is, heading included:

   ```bash
   awk '/^## Patch Release vX.Y.Z$/{p=1} p&&/^---$/{exit} p' docs/release-notes/X.Y.md > patch-body.md
   ```

2. **Create the patch discussion** in Announcements, titled `Patch Release vX.Y.Z 📎`:

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

3. **Comment on the X.Y.0 announcement** with the same text. The announcement is the discussion that
   `releaseNotesUrl` in `package.json` points to, which a patch release leaves unchanged:

   ```bash
   gh api graphql -f query='
   { repository(owner: "microsoft", name: "vscode-documentdb") { discussion(number: <N>) { id } } }'

   gh api graphql -f query='
   mutation($id: ID!, $body: String!) {
     addDiscussionComment(input: {discussionId: $id, body: $body}) { comment { url } }
   }' -f id=<discussion id> -F body=@patch-body.md --jq '.data.addDiscussionComment.comment.url'
   ```

4. Check that the Announcements list shows the X.Y.0 announcement first and the patch discussion second.

## Major or minor release

1. Create the discussion in Announcements with the release notes body (everything after the front
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
