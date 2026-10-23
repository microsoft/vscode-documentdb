/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { micromark } from 'micromark';

/**
 * Renders AI-generated Markdown as email-safe HTML for the "Copy as rich text" report.
 *
 * `micromark` (already bundled through `react-markdown`) does the parsing; it escapes raw HTML and
 * drops unsafe link protocols. Its output uses plain tags only, so this adds inline styles (email
 * clients and Word ignore classes, `<style>` blocks and CSS variables), keeps http(s) links only,
 * shows images as their alt text and maps `#`/`##` headings to `h3`, below the report's own headings.
 */

export const shareFontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const shareMonospaceStack = "Consolas, Menlo, Monaco, 'Courier New', monospace";

export const sharePalette = {
    text: '#242424',
    muted: '#616161',
    border: '#d1d1d1',
    subtleBackground: '#f5f5f5',
    link: '#0f6cbd',
} as const;

const styles = {
    heading: (level: number): string =>
        `margin:16px 0 8px 0;font-size:${level <= 3 ? 16 : level === 4 ? 15 : 14}px;font-weight:600;color:${sharePalette.text};`,
    p: `margin:8px 0;line-height:1.5;color:${sharePalette.text};`,
    list: `margin:8px 0;padding-left:24px;color:${sharePalette.text};`,
    li: 'margin:4px 0;line-height:1.5;',
    code: `font-family:${shareMonospaceStack};font-size:90%;background-color:${sharePalette.subtleBackground};padding:1px 4px;`,
    pre: `margin:8px 0;padding:8px 12px;background-color:${sharePalette.subtleBackground};border:1px solid ${sharePalette.border};font-size:13px;line-height:1.4;white-space:pre-wrap;overflow-wrap:break-word;color:${sharePalette.text};`,
    blockquote: `margin:8px 0;padding:0 0 0 12px;border-left:3px solid ${sharePalette.border};color:${sharePalette.muted};`,
    hr: `border:0;border-top:1px solid ${sharePalette.border};margin:16px 0;`,
    link: `color:${sharePalette.link};text-decoration:underline;`,
} as const;

/** Escapes text for use in HTML element content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function markdownToEmailHtml(markdown: string): string {
    return micromark(markdown)
        .replace(/<(\/?)h[12]>/g, '<$1h3>')
        .replace(/<(h[3-6])>/g, (_tag, name: string) => `<${name} style="${styles.heading(Number(name[1]))}">`)
        .replace(/<pre><code[^>]*>/g, `<pre style="${styles.pre}"><code style="font-family:${shareMonospaceStack};">`)
        .replace(/<code>/g, `<code style="${styles.code}">`)
        .replace(/<img [^>]*?alt="([^"]*)"[^>]*>/g, '$1')
        .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_link, href: string, text: string) =>
            /^https?:\/\//i.test(href) ? `<a href="${href}" style="${styles.link}">${text}</a>` : text,
        )
        .replace(/<(p|li|blockquote)>/g, (_tag, name: 'p' | 'li' | 'blockquote') => `<${name} style="${styles[name]}">`)
        .replace(
            /<(ul|ol)( start="\d+")?>/g,
            (_tag, name: string, start = '') => `<${name}${start} style="${styles.list}">`,
        )
        .replace(/<hr \/>/g, `<hr style="${styles.hr}">`)
        .trim();
}
