/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');

const versionFiles = ['package.json', 'package-lock.json'];

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function github(method, endpoint, body) {
    const args = ['api', endpoint];
    if (method === 'GET') {
        args.push('--paginate', '--slurp');
    } else {
        args.push('--method', method, '--input', '-');
    }
    return JSON.parse(
        execFileSync('gh', args, {
            encoding: 'utf8',
            input: body === undefined ? undefined : JSON.stringify(body),
        }),
    );
}

function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required to prepare the version-bump reminder.`);
    }
    return value;
}

function summary(markdown) {
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }
}

function prepareBranch(branch, newVersion, title) {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    if (manifest.version !== newVersion || lock.version !== newVersion || lock.packages?.['']?.version !== newVersion) {
        throw new Error('The prepared manifest and both root lockfile versions must match NEW_VERSION.');
    }
    const staged = git('diff', '--cached', '--name-only');
    if (staged && staged.split('\n').some((file) => !versionFiles.includes(file))) {
        throw new Error('Unrelated files are staged; refusing to include them in the version bump.');
    }

    const remote = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], {
        encoding: 'utf8',
    });
    if (remote.error) {
        throw remote.error;
    }
    if (remote.status === 0) {
        git('fetch', '--no-tags', 'origin', `refs/heads/${branch}`);
        const base = git('merge-base', 'HEAD', 'FETCH_HEAD');
        const changedFiles = git('diff', '--name-only', base, 'FETCH_HEAD').split('\n');
        if (
            changedFiles.some((file) => !versionFiles.includes(file)) ||
            versionFiles.some((file) => git('show', `FETCH_HEAD:${file}`) !== fs.readFileSync(file, 'utf8').trim())
        ) {
            throw new Error(`Existing branch ${branch} has conflicting changes; refusing to overwrite it.`);
        }
        console.log(`Reusing existing branch ${branch}; no commits were overwritten.`);
        return;
    }
    if (remote.status !== 2) {
        throw new Error(`Could not inspect remote branch ${branch}: ${remote.stderr}`);
    }

    git('switch', '-c', branch);
    git('add', '--', ...versionFiles);
    git(
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        title,
        '-m',
        'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
    );
    git('push', 'origin', `HEAD:refs/heads/${branch}`);
}

function main() {
    const oldVersion = required('OLD_VERSION');
    const newVersion = required('NEW_VERSION');
    const repository = required('GITHUB_REPOSITORY');
    const server = required('GITHUB_SERVER_URL');
    const runId = required('GITHUB_RUN_ID');
    const assignee = required('REMINDER_ASSIGNEE');
    if (
        !/^\d+\.\d+\.\d+$/.test(oldVersion) ||
        !/^\d+\.\d+\.\d+-alpha\.0$/.test(newVersion) ||
        !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
        !/^\d+$/.test(runId) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(assignee)
    ) {
        throw new Error('Invalid version, repository, run ID, or reminder assignee.');
    }

    const branch = `bot/bump-${newVersion}`;
    const title = `chore: prepare ${newVersion} development`;
    const runUrl = `${server}/${repository}/actions/runs/${runId}`;
    const source = process.env.RELEASE_TAG
        ? `[Release ${process.env.RELEASE_TAG}](${server}/${repository}/releases/tag/${encodeURIComponent(process.env.RELEASE_TAG)})`
        : 'Manual workflow run';
    const description = [
        '## Why this change is needed',
        '',
        'Move `main` to the next development version so ongoing development no longer uses an already released version.',
        'The published release and its tag are unchanged.',
        '',
        '## Version change',
        '',
        '| File | Old version | New version |',
        '| --- | --- | --- |',
        `| \`package.json\` | \`${oldVersion}\` | **\`${newVersion}\`** |`,
        `| \`package-lock.json\` (both root version entries) | \`${oldVersion}\` | **\`${newVersion}\`** |`,
        '',
        '`alpha.0` means the **first alpha of the next patch**; `.0` is the prerelease counter.',
        'Reruns do not advance it to `alpha.1`. Workspace package and dependency versions are unchanged.',
        'Nothing is published or merged automatically. Replace the alpha with the intended numeric version before the next release.',
        '',
        '## Source',
        '',
        `- Trigger: ${source}`,
        `- [Workflow run](${runUrl})`,
    ].join('\n');
    const compareUrl = new URL(`${server}/${repository}/compare/main...${branch}`);
    compareUrl.search = new URLSearchParams({ expand: '1', title, body: description }).toString();
    const prUrl = compareUrl.toString();

    prepareBranch(branch, newVersion, title);
    summary(
        `## Development version is ready\n\n${description}\n\nBranch: [\`${branch}\`](${server}/${repository}/tree/${branch})\n\n[Create version-bump PR](${prUrl})\n`,
    );

    const marker = `<!-- post-release-version:${newVersion} -->`;
    const body = [
        marker,
        description,
        '',
        '## Next steps',
        '',
        `@${assignee}: the branch \`${branch}\` is prepared.`,
        '',
        `1. [Create version-bump PR](${prUrl}) using the prefilled title and description.`,
        '2. Submit the PR yourself; normal pull-request CI will run under your user identity.',
        '3. Review and merge after checks pass, then close this reminder.',
        '',
        'The workflow cannot create PRs under the repository policy. This issue is the reminder, not a failure to prepare the change.',
    ].join('\n');
    // Enumerate issues instead of search: newly created issues may not be search-indexed on a retry.
    const issues = github('GET', `repos/${repository}/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100`).flat();
    const matches = issues.filter((issue) => !issue.pull_request && issue.body?.includes(marker));
    if (matches.length > 1) {
        throw new Error(`Multiple reminders exist for ${newVersion}; resolve the duplicates before retrying.`);
    }
    const existing = matches[0];
    const issue = github(
        existing ? 'PATCH' : 'POST',
        `repos/${repository}/issues${existing ? `/${existing.number}` : ''}`,
        {
            title: `Prepare development version ${newVersion}`,
            body,
            assignees: [assignee],
            ...(existing ? { state: 'open' } : {}),
        },
    );
    if (!issue.assignees?.some((user) => user.login === assignee)) {
        throw new Error(`Reminder ${issue.html_url} was not assigned to @${assignee}; check issue assignment permissions.`);
    }
    summary(`Reminder assigned to @${assignee}: ${issue.html_url}`);
}

main();
