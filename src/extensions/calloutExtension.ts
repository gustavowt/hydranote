import { Extension } from '@tiptap/core';
import { Node, mergeAttributes } from '@tiptap/core';
import type { CalloutType } from '@/services/calloutConverter';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout') || 'note',
        renderHTML: (attrs) => ({ 'data-callout': attrs.type as string }),
      },
      title: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout-title') || '',
        renderHTML: (attrs) =>
          attrs.title ? { 'data-callout-title': attrs.title as string } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'aside[data-callout]',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            type: node.getAttribute('data-callout') || 'note',
            title: node.getAttribute('data-callout-title') || '',
            // Content parsed from children; body wrapper stripped by content model
          };
        },
        contentElement: (el) => {
          const body = (el as HTMLElement).querySelector('.callout-body');
          return (body || el) as HTMLElement;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const type = (node.attrs.type as string) || 'note';
    const title = (node.attrs.title as string) || '';
    const attrs: Record<string, string> = {
      ...HTMLAttributes,
      'data-callout': type,
      class: `callout callout-${type}`,
    };
    if (title) {
      attrs['data-callout-title'] = title;
    }
    return [
      'aside',
      mergeAttributes(attrs),
      ['div', { class: 'callout-body' }, 0],
    ];
  },
});

export const CalloutExtension = Extension.create({
  name: 'calloutExtension',
  addExtensions() {
    return [Callout];
  },
});
