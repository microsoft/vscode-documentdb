# GitHub Pages Workflows

This folder contains workflows for managing documentation deployment to GitHub Pages.

## Overview

Our documentation is deployed using a **two-workflow system** that enables both production documentation and PR preview functionality.

## GitHub Pages Configuration

**Setting Location:** Repository Settings → Pages → Build and deployment

**Required Configuration:**

- **Source:** Deploy from a branch
- **Branch:** `gh-pages`
- **Folder:** `/` (root)

## Architecture

```
Repository Structure:
├── main/next branch
│   └── docs/               ← Source documentation files
│
└── gh-pages branch         ← GitHub Pages deployment target
    ├── index.md            ← Production docs (root)
    ├── _config.yml
    ├── *.md
    └── pr-preview/         ← PR preview subdirectory
        ├── pr-418/
        └── pr-420/
```

**URLs:**

- Production: `https://microsoft.github.io/vscode-documentdb/`
- PR Preview: `https://microsoft.github.io/vscode-documentdb/pr-preview/pr-{number}/`

## Workflows

### 1. Deploy Documentation (Production)

**File:** `deploy-documentation-production.yml`

**Purpose:** Automatically deploy production documentation to GitHub Pages root.

**Trigger:**

- Automatic: When `docs/**` files are pushed to `next` branch
- Manual: Can be triggered via Actions tab (workflow_dispatch)

**What it does:**

1. Checks out the `next` branch
2. Deploys contents of `docs/` folder to root of `gh-pages` branch
3. Cleans old files (removes deleted docs)
4. **Preserves** `pr-preview/` subdirectory (does not touch PR previews)

**Key Configuration:**

```yaml
folder: docs/ # Source
branch: gh-pages # Target
clean: true # Remove old files
clean-exclude: pr-preview/** # Keep previews
```

### 2. Deploy Documentation (Preview)

**File:** `deploy-documentation-preview.yml`

**Purpose:** Manually create isolated PR preview deployments.

**Trigger:**

- Manual only (workflow_dispatch from Actions tab)

**Inputs:**

- `pr_number`: The PR number to preview
- `action_type`:
  - **Generate** - Deploy preview for a specific PR
  - **Clean** - Remove preview for a specific PR
  - **CleanAll** - Remove all PR previews

**What it does:**

**Generate:**

1. Fetches PR details and checks out PR branch
2. Deploys `docs/` to `gh-pages/pr-preview/pr-{number}/`
3. Posts comment on PR with preview URL

**Clean:**

1. Checks out `gh-pages` branch
2. Removes `pr-preview/pr-{number}/` directory
3. Posts comment on PR that preview was cleaned

**CleanAll:**

1. Checks out `gh-pages` branch
2. Removes entire `pr-preview/` directory
3. Useful for periodic cleanup of old previews

## How They Work Together

### Production Workflow

```
docs/ changed in 'next' → Workflow triggers → Copies to gh-pages/ root
                                           ↓
                                    Preserves pr-preview/
```

### Preview Workflow

```
Manual trigger with PR #418 → Fetches PR branch → Copies to gh-pages/pr-preview/pr-418/
                                                ↓
                                         Production docs untouched
```

### The Key: `clean-exclude`

The production workflow uses `clean-exclude: pr-preview/**` to ensure:

- ✅ Production docs are kept up-to-date
- ✅ Old/deleted production docs are removed
- ✅ PR previews are never touched by production deployments
- ✅ Both can coexist peacefully in the same branch

## Why This Architecture?

### GitHub Pages Limitation

GitHub Pages can only deploy from **one location**:

- ❌ Cannot deploy from both `main/docs/` AND `gh-pages` simultaneously
- ✅ Solution: Deploy everything to `gh-pages` branch

### Benefits

1. **Single Source:** All documentation served from one branch (`gh-pages`)
2. **Isolated Previews:** Each PR preview lives in its own subdirectory
3. **No Conflicts:** Production and preview workflows don't interfere
4. **Automatic Updates:** Production docs deploy automatically on merge
5. **On-Demand Previews:** Create previews only when needed

### Why Two Workflows?

**Separate workflows provide:**

- **Different triggers:** Automatic (production) vs Manual (preview)
- **Different permissions:** Production can clean, preview only adds
- **Clear responsibilities:** One maintains production, one handles previews
- **Better security:** Preview workflow requires explicit user action

## Usage Examples

### Deploying Production Docs

**Automatic:** Just merge changes to `next` branch - workflow runs automatically

**Manual:**

1. Go to Actions tab
2. Select "Deploy Documentation (Production)"
3. Click "Run workflow"

### Creating a PR Preview

1. Go to Actions tab
2. Select "Deploy Documentation (Preview)"
3. Click "Run workflow"
4. Enter:
   - PR number: `418`
   - Action: `Generate`
5. Preview will be available at: `https://microsoft.github.io/vscode-documentdb/pr-preview/pr-418/`

### Cleaning a PR Preview

Same as above, but select action: `Clean`

### Cleaning All Previews

Same as above, but select action: `CleanAll` (leave PR number empty)

## Maintenance

### When to Clean Previews

- After PR is merged
- After PR is closed/abandoned
- Periodic cleanup of old previews (use CleanAll)

### Monitoring

- Check Actions tab for workflow run status
- GitHub Pages deployment status visible in Deployments section
- Preview URLs posted as comments on PRs

## Troubleshooting

### Production docs not updating

1. Check workflow run in Actions tab
2. Verify `docs/**` files changed in commit
3. Ensure workflow completed successfully

### Preview not appearing

1. Verify GitHub Pages is set to deploy from `gh-pages` branch
2. Check workflow completed successfully
3. Wait 1-2 minutes for GitHub Pages to rebuild
4. Verify files exist in `gh-pages/pr-preview/pr-{number}/`

### Preview URL returns 404

1. Check if `_config.yml` exists in preview directory
2. Verify Jekyll isn't processing preview incorrectly
3. Check if files were actually deployed to correct path

## Technical Details

### Actions Used

- **`actions/checkout@v4`** - Checks out repository code
- **`actions/github-script@v7`** - Fetches PR details via GitHub API
- **`JamesIves/github-pages-deploy-action@v4`** - Handles git operations and deployment
- **`marocchino/sticky-pull-request-comment@v2`** - Posts/updates PR comments

### Why `JamesIves/github-pages-deploy-action`?

This action handles complex git operations:

- Creates `gh-pages` branch if it doesn't exist
- Uses git worktrees to avoid conflicts
- Smart file cleaning with exclusion patterns
- Idempotent (skips deploy if no changes)
- Handles retries and error cases
- Battle-tested and actively maintained

### Permissions Required

Both workflows need:

```yaml
permissions:
  contents: write # To push to gh-pages branch
  pull-requests: write # To comment on PRs (preview only)
```

## Migration Notes

**Previous Setup:**

- GitHub Pages deployed directly from `main/docs/`
- No workflow needed (GitHub's default behavior)

**Current Setup:**

- GitHub Pages deploys from `gh-pages` branch
- Production workflow copies `main/docs/` → `gh-pages/` (automatic)
- Preview workflow copies PR `docs/` → `gh-pages/pr-preview/` (manual)

**Behavior:** Identical to users - docs still auto-update on merge to `next`.
