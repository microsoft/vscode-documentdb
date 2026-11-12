/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToEmailHtml } from './markdownToEmailHtml';

describe('markdownToEmailHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });

    it('renders the report Markdown with heading levels and inline styles', () => {
        const html = markdownToEmailHtml(
            '# Title\n## Section\n### Key Issues\n1. 🔻 **Critical**: scan on `status_1`\n2. 🔼 Good\n\n```javascript\ndb.items.find({ a: "<b>" })\n```\n\n> quoted\n\n---\n\n3. third',
        );
        expect(html).toMatch(/^<div style="font-family:[^"]+">\n<h1 style="[^"]*font-size:22px[^"]*">Title<\/h1>/);
        expect(html).toMatch(/<h2 style="[^"]*font-size:18px[^"]*">Section<\/h2>/);
        expect(html).toMatch(/<h3 style="[^"]*font-size:16px[^"]*">Key Issues<\/h3>/);
        expect(html).toMatch(
            /<ol style="[^"]+">\n<li style="[^"]+">🔻 <strong>Critical<\/strong>: scan on <code style="[^"]+">status_1<\/code><\/li>/,
        );
        expect(html).toMatch(
            /<pre style="[^"]+"><code style="[^"]+">db\.items\.find\(\{ a: &quot;&lt;b&gt;&quot; \}\)/,
        );
        expect(html).toMatch(/<blockquote style="[^"]+">\n<p style="[^"]+">quoted<\/p>/);
        expect(html).toMatch(/<hr style="[^"]+">/);
        expect(html).toContain('<ol start="3" style="');
    });

    it('allows only http(s) links and never passes raw HTML through', () => {
        const html = markdownToEmailHtml(
            '[docs](https://learn.microsoft.com/a?b=1&c=2) [bad](javascript:alert(1)) [rel](/x) ![img](https://x/y.png)\n\n<script>alert("x")</script><img src=x onerror=alert(1)>',
        );
        expect(html).toContain('<a href="https://learn.microsoft.com/a?b=1&amp;c=2" style="');
        expect(html).not.toContain('javascript:');
        expect(html).toContain(' bad rel img');
        expect(html).not.toMatch(/<img|<script|href="\/x"/);
        expect(html).toContain('&lt;script&gt;');
    });

    it('uses inline styles only', () => {
        const html = markdownToEmailHtml('# H\n\ntext `code`\n\n- a\n\n```js\nx\n```\n\n> q\n\n[l](https://a.b)');
        expect(html).not.toMatch(/class=|<style|var\(--|display:\s*flex|display:\s*grid/);
    });
});
