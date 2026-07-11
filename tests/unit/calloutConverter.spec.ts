import { describe, expect, test } from 'vitest';
import {
  rewriteCalloutHtml,
  calloutHtmlToMarkdown,
  rewriteCalloutsInMarkdown,
  CALLOUT_TYPES,
} from '@/services/calloutConverter';
import { markdownToHtml } from '@/services/markdownConverter';

describe('calloutConverter', () => {
  test('exports supported callout types', () => {
    expect(CALLOUT_TYPES).toEqual(['note', 'tip', 'warning']);
  });

  test('rewriteCalloutHtml converts Obsidian note blockquote to data-callout', () => {
    const md = '> [!note]\n> Remember this point.';
    const html = rewriteCalloutHtml(markdownToHtml(md));

    expect(html).toContain('data-callout="note"');
    expect(html).toContain('Remember this point');
    expect(html).not.toContain('[!note]');
  });

  test('rewriteCalloutHtml handles tip with optional title', () => {
    const md = '> [!tip] Pro tip\n> Use shortcuts.';
    const html = rewriteCalloutHtml(markdownToHtml(md));

    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('data-callout-title="Pro tip"');
    expect(html).toContain('Use shortcuts');
  });

  test('rewriteCalloutHtml handles warning callout', () => {
    const md = '> [!warning]\n> Be careful.';
    const html = rewriteCalloutHtml(markdownToHtml(md));

    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('Be careful');
  });

  test('rewriteCalloutHtml leaves normal blockquotes unchanged', () => {
    const md = '> Just a quote\n> Second line';
    const html = rewriteCalloutHtml(markdownToHtml(md));

    expect(html).not.toContain('data-callout');
    expect(html).toContain('Just a quote');
  });

  test('calloutHtmlToMarkdown round-trips note callout', () => {
    const md = '> [!note]\n> Body text here.';
    const html = rewriteCalloutHtml(markdownToHtml(md));
    const restored = calloutHtmlToMarkdown(html);

    expect(restored).toContain('> [!note]');
    expect(restored).toContain('> Body text here.');
  });

  test('calloutHtmlToMarkdown round-trips tip with title', () => {
    const md = '> [!tip] Title here\n> Body line.';
    const html = rewriteCalloutHtml(markdownToHtml(md));
    const restored = calloutHtmlToMarkdown(html);

    expect(restored).toContain('> [!tip] Title here');
    expect(restored).toContain('> Body line.');
  });

  test('rewriteCalloutsInMarkdown is idempotent on plain markdown', () => {
    const md = '# Hello\n\nPlain paragraph.';
    expect(rewriteCalloutsInMarkdown(md)).toBe(md);
  });
});
