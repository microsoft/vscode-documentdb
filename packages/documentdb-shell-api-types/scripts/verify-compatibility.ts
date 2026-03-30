/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * verify-compatibility.ts
 *
 * Verifies that the shell API method registry is consistent with the official
 * Azure DocumentDB compatibility documentation.
 *
 * What it does:
 *   1. Fetches the compatibility page from the azure-databases-docs GitHub repo
 *   2. Extracts the "Database commands" table to find supported commands
 *   3. Checks that every server command in our method registry is still
 *      marked as supported (✅) in the official documentation
 *   4. Reports any mismatches (commands we reference that are no longer supported,
 *      or new commands that we might want to add)
 *
 * Usage:
 *   npm run verify
 *   npx ts-node packages/shell-api-types/scripts/verify-compatibility.ts
 */

import { getRequiredServerCommands, SHELL_API_METHODS } from '../src/methodRegistry';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPAT_PAGE_URL =
    'https://raw.githubusercontent.com/MicrosoftDocs/azure-databases-docs/main/articles/documentdb/compatibility-query-language.md';

const OUTPUT_FILE = path.join(__dirname, '..', 'resources', 'scraped', 'compatibility-commands.md');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandStatus {
    command: string;
    category: string;
    supported: boolean;
    /** Raw status text from the table (e.g., "✅ Yes", "❌ No", "N/A³") */
    rawStatus: string;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchCompatPage(): Promise<string> {
    console.log(`Fetching: ${COMPAT_PAGE_URL}`);
    const response = await fetch(COMPAT_PAGE_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch compatibility page: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

// ---------------------------------------------------------------------------
// Parsing — extract the "Database commands" table
// ---------------------------------------------------------------------------

function parseCommandsTable(markdown: string): CommandStatus[] {
    const commands: CommandStatus[] = [];

    // Find the "## Database commands" section
    const dbCmdStart = markdown.indexOf('## Database commands');
    if (dbCmdStart === -1) {
        throw new Error('Could not find "## Database commands" section in compatibility page');
    }

    // Find the end of this section (next ##)
    const nextSection = markdown.indexOf('\n## ', dbCmdStart + 1);
    const section = nextSection === -1
        ? markdown.substring(dbCmdStart)
        : markdown.substring(dbCmdStart, nextSection);

    // Parse table rows: | Category | Command | v5.0 | v6.0 | v7.0 | v8.0 |
    // We care about whether ANY version column has "✅ Yes"
    const rows = section.split('\n').filter((line) => line.startsWith('|'));

    for (const row of rows) {
        const cells = row
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);

        if (cells.length < 3) continue;

        // Skip header/separator rows
        if (cells[0].startsWith('---') || cells[0] === '' || cells[1]?.startsWith('---')) continue;
        if (cells[0].toLowerCase().includes('category')) continue;

        const category = cells[0];
        // Strip backticks from command names (the docs use `command` format)
        const command = cells[1].replace(/`/g, '');

        // Check if N/A (like "N/A⁵" for entire rows that are categories)
        if (command.startsWith('N/A')) continue;

        // Check if any version column has ✅
        const statusCells = cells.slice(2);
        const supported = statusCells.some((s) => s.includes('✅'));
        const rawStatus = statusCells.join(' | ');

        commands.push({ command, category, supported, rawStatus });
    }

    return commands;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function verify(
    scrapedCommands: CommandStatus[],
    requiredCommands: readonly string[],
): { missing: string[]; unsupported: string[]; extraSupported: string[] } {
    const supportedSet = new Set(
        scrapedCommands
            .filter((c) => c.supported)
            .map((c) => c.command.toLowerCase()),
    );

    const allScrapedSet = new Set(
        scrapedCommands.map((c) => c.command.toLowerCase()),
    );

    const requiredLower = requiredCommands.map((c) => c.toLowerCase());

    // Commands we require but are NOT in the scraped data at all
    const missing = requiredLower.filter((c) => !allScrapedSet.has(c));

    // Commands we require but are explicitly NOT supported
    const unsupported = requiredLower.filter(
        (c) => allScrapedSet.has(c) && !supportedSet.has(c),
    );

    // Commands that ARE supported but we don't reference
    // (potential candidates for new shell methods)
    const referencedLower = new Set(requiredLower);
    const extraSupported = [...supportedSet].filter(
        (c) => !referencedLower.has(c),
    );

    return { missing, unsupported, extraSupported };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
    scrapedCommands: CommandStatus[],
    requiredCommands: readonly string[],
    result: { missing: string[]; unsupported: string[]; extraSupported: string[] },
): string {
    const lines: string[] = [];
    lines.push('# Shell API Compatibility Verification Report');
    lines.push('');
    lines.push(`<!-- AUTO-GENERATED by verify-compatibility.ts -->`);
    lines.push(`<!-- Last verified: ${new Date().toISOString().split('T')[0]} -->`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Server commands scraped from docs | ${scrapedCommands.length} |`);
    lines.push(`| Server commands supported (✅) | ${scrapedCommands.filter((c) => c.supported).length} |`);
    lines.push(`| Server commands required by shell API | ${requiredCommands.length} |`);
    lines.push(`| Shell API methods (total) | ${SHELL_API_METHODS.length} |`);
    lines.push(`| Shell API methods (shell-only) | ${SHELL_API_METHODS.filter((m) => m.shellOnly).length} |`);
    lines.push('');

    // Status
    const allOk = result.missing.length === 0 && result.unsupported.length === 0;
    lines.push(`## Verification Result`);
    lines.push('');
    if (allOk) {
        lines.push('### ✅ COMPATIBLE');
        lines.push('');
        lines.push('All server commands used by the shell API type definitions are confirmed');
        lines.push('as supported in the official Azure DocumentDB compatibility documentation.');
        lines.push('');
        lines.push(`This means every method in \`documentdb-shell-api.d.ts\` maps to a server`);
        lines.push(`command that DocumentDB supports. Users can safely use all ${SHELL_API_METHODS.filter((m) => !m.shellOnly).length} server-backed`);
        lines.push(`methods and ${SHELL_API_METHODS.filter((m) => m.shellOnly).length} shell-only utility methods in their scratchpad files.`);
    } else {
        lines.push('### ⚠️ ISSUES FOUND');
        lines.push('');
        lines.push('The shell API type definitions reference server commands that are no longer');
        lines.push('confirmed as supported in the official documentation. **Action required:**');
        lines.push('review the issues below and update the `.d.ts` file or the method registry.');
    }
    lines.push('');

    if (result.unsupported.length > 0) {
        lines.push('### ❌ Commands we reference that are NOT supported');
        lines.push('');
        lines.push('These server commands appear in our method registry but are marked');
        lines.push('as unsupported in the official documentation. The corresponding');
        lines.push('shell methods may not work on DocumentDB.');
        lines.push('');
        for (const cmd of result.unsupported) {
            const methods = SHELL_API_METHODS.filter((m) =>
                m.serverCommands.some((sc) => sc.toLowerCase() === cmd),
            );
            const methodNames = methods.map((m) => `${m.target}.${m.name}`).join(', ');
            lines.push(`- **${cmd}** — used by: ${methodNames}`);
        }
        lines.push('');
    }

    if (result.missing.length > 0) {
        lines.push('### ⚠️ Commands we reference that are NOT in the docs table');
        lines.push('');
        lines.push('These server commands appear in our method registry but were not');
        lines.push('found in the compatibility page table. They may be valid commands');
        lines.push('that are simply not listed, or they may need investigation.');
        lines.push('');
        for (const cmd of result.missing) {
            const methods = SHELL_API_METHODS.filter((m) =>
                m.serverCommands.some((sc) => sc.toLowerCase() === cmd),
            );
            const methodNames = methods.map((m) => `${m.target}.${m.name}`).join(', ');
            lines.push(`- **${cmd}** — used by: ${methodNames}`);
        }
        lines.push('');
    }

    if (result.extraSupported.length > 0) {
        lines.push('### ℹ️ Supported commands not referenced by the shell API');
        lines.push('');
        lines.push('These server commands are supported by DocumentDB but no shell');
        lines.push('method in our registry maps to them. Some are expected (admin');
        lines.push('commands, session commands, etc.) but others might be candidates');
        lines.push('for new shell methods.');
        lines.push('');
        for (const cmd of result.extraSupported.sort()) {
            const entry = scrapedCommands.find((c) => c.command.toLowerCase() === cmd);
            lines.push(`- **${cmd}** (${entry?.category ?? 'unknown'})`);
        }
        lines.push('');
    }

    // Full command lists (supported and unsupported)
    const supported = scrapedCommands.filter((c) => c.supported).sort((a, b) => a.command.localeCompare(b.command));
    const notSupported = scrapedCommands.filter((c) => !c.supported).sort((a, b) => a.command.localeCompare(b.command));

    lines.push('## Supported Server Commands');
    lines.push('');
    lines.push(`${supported.length} commands marked as supported (✅) in the official documentation.`);
    lines.push('');
    lines.push('| Command | Category |');
    lines.push('| --- | --- |');
    for (const cmd of supported) {
        lines.push(`| ${cmd.command} | ${cmd.category} |`);
    }
    lines.push('');

    lines.push('## Unsupported / Not Available Server Commands');
    lines.push('');
    lines.push(`${notSupported.length} commands that are not supported, not applicable, or deprecated.`);
    lines.push('');
    lines.push('| Command | Category | Status |');
    lines.push('| --- | --- | --- |');
    for (const cmd of notSupported) {
        lines.push(`| ${cmd.command} | ${cmd.category} | ${cmd.rawStatus} |`);
    }
    lines.push('');

    // Method-to-command mapping table
    lines.push('## Method-to-Command Mapping');
    lines.push('');
    lines.push('| Target | Method | Server Command(s) | Shell-Only |');
    lines.push('| --- | --- | --- | --- |');
    for (const m of SHELL_API_METHODS) {
        const cmds = m.serverCommands.length > 0 ? m.serverCommands.join(', ') : '—';
        lines.push(`| ${m.target} | ${m.name} | ${cmds} | ${m.shellOnly ? '✅' : ''} |`);
    }
    lines.push('');

    // Conclusion
    lines.push('---');
    lines.push('');
    lines.push('## What This Report Means');
    lines.push('');
    lines.push('This report verifies that the type definitions shipped with the DocumentDB');
    lines.push('VS Code extension are consistent with the official Azure DocumentDB');
    lines.push('compatibility documentation.');
    lines.push('');
    lines.push('**How to read it:**');
    lines.push('');
    lines.push('- If the **Verification Result** is ✅ COMPATIBLE, every shell method in');
    lines.push('  `documentdb-shell-api.d.ts` maps to a server command that DocumentDB');
    lines.push('  officially supports. No action is needed.');
    lines.push('- If ❌ issues appear under "Commands we reference that are NOT supported",');
    lines.push('  it means the upstream DocumentDB documentation has removed support for a');
    lines.push('  command that our type definitions still include. The corresponding methods');
    lines.push('  should be removed from the `.d.ts` file and the method registry.');
    lines.push('- If new commands appear under "Supported commands not referenced by the');
    lines.push('  shell API", they are candidates for new shell methods to be added to the');
    lines.push('  `.d.ts` file (if they have useful client-side wrapper functions).');
    lines.push('');
    lines.push('**Reference:** https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language');
    lines.push('');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    console.log('=== Shell API Compatibility Verification ===\n');

    // 1. Fetch and parse compatibility page
    const markdown = await fetchCompatPage();
    const scrapedCommands = parseCommandsTable(markdown);
    console.log(`Scraped ${scrapedCommands.length} commands from compatibility page`);
    console.log(`  Supported: ${scrapedCommands.filter((c) => c.supported).length}`);
    console.log(`  Not supported: ${scrapedCommands.filter((c) => !c.supported).length}`);

    // 2. Get our required commands
    const requiredCommands = getRequiredServerCommands();
    console.log(`\nShell API requires ${requiredCommands.length} server commands:`);
    console.log(`  ${requiredCommands.join(', ')}`);

    // 3. Verify
    const result = verify(scrapedCommands, requiredCommands);

    // 4. Report — each outcome emits a unique CI-parsable key
    console.log('');
    if (result.unsupported.length > 0) {
        console.log('[SHELL-API-INCOMPATIBLE] the following server commands are used by the shell API');
        console.log('   but are NO LONGER marked as supported in the official documentation:');
        for (const cmd of result.unsupported) {
            const methods = SHELL_API_METHODS.filter((m) =>
                m.serverCommands.some((sc) => sc.toLowerCase() === cmd),
            );
            const methodNames = methods.map((m) => `${m.target}.${m.name}`).join(', ');
            console.log(`   [SHELL-API-UNSUPPORTED-COMMAND] ${cmd} (used by: ${methodNames})`);
        }
        console.log('');
        console.log('   ACTION: Remove or update these methods in documentdb-shell-api.d.ts');
    }
    if (result.missing.length > 0) {
        console.log('[SHELL-API-MISSING-COMMAND] the following commands are referenced but not found in the docs table:');
        for (const cmd of result.missing) {
            console.log(`   [SHELL-API-MISSING-COMMAND] ${cmd}`);
        }
    }
    if (result.unsupported.length === 0 && result.missing.length === 0) {
        console.log('[SHELL-API-COMPATIBLE] all server commands used by the shell API type definitions');
        console.log('   are confirmed as supported in the official Azure DocumentDB documentation.');
        console.log(`   (${requiredCommands.length} server commands checked, ${SHELL_API_METHODS.length} shell methods total)`);
    }
    if (result.extraSupported.length > 0) {
        console.log(`\n[SHELL-API-NEW-COMMANDS] ${result.extraSupported.length} supported commands exist in the docs but are not`);
        console.log('   referenced by the shell API (may be candidates for new methods)');
    }

    // 5. Write report
    const report = generateReport(scrapedCommands, requiredCommands, result);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, report);
    console.log(`\nReport written to: ${OUTPUT_FILE}`);
}

main().catch((e) => {
    console.error('Verification failed:', e);
    process.exit(1);
});
