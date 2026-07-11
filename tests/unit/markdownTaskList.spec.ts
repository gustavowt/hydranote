import { describe, expect, test } from 'vitest';
import { markdownToHtml, rewriteTaskListHtml } from '@/services/markdownConverter';

describe('rewriteTaskListHtml', () => {
  test('converts unchecked GFM task items into TipTap taskList HTML', () => {
    const md = '- [ ] Buy milk\n- [ ] Walk dog';
    const html = rewriteTaskListHtml(markdownToHtml(md));

    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('Buy milk');
    expect(html).toContain('Walk dog');
  });

  test('preserves checked state for completed tasks', () => {
    const md = '- [x] Done item';
    const html = rewriteTaskListHtml(markdownToHtml(md));

    expect(html).toContain('data-checked="true"');
    expect(html).toContain('Done item');
  });

  test('leaves non-task lists unchanged', () => {
    const md = '- Regular item\n- Another item';
    const html = rewriteTaskListHtml(markdownToHtml(md));

    expect(html).not.toContain('data-type="taskList"');
    expect(html).toContain('Regular item');
  });
});
