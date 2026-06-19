import { Mark } from '@tiptap/core';

/**
 * Custom TipTap mark for plagiarism and AI-generated content highlighting.
 * Usage: editor.commands.setMark('highlight', { type: 'plagiarism'|'ai-generated', reason, id })
 */
export const HighlightMark = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      type: {
        default: 'plagiarism', // 'plagiarism' or 'ai-generated'
        parseHTML: (element) => element.getAttribute('data-type'),
        renderHTML: (attributes) => ['data-type', attributes.type],
      },
      reason: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-reason'),
        renderHTML: (attributes) => ['data-reason', attributes.reason],
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => ['data-id', attributes.id],
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'mark[data-type]',
      },
    ];
  },

  renderHTML({ attributes }) {
    const isAI = attributes.type === 'ai-generated';
    const bgColor = isAI ? '#ffcccc' : '#fffacd';
    const borderColor = isAI ? '#dc143c' : '#daa520';
    const title = (isAI ? 'AI-Generated' : 'Plagiarism') + ': ' + (attributes.reason || 'Flagged');

    return [
      'mark',
      {
        'data-type': attributes.type,
        'data-reason': attributes.reason,
        'data-id': attributes.id,
        style: `
          background-color: ${bgColor};
          border-bottom: 2px solid ${borderColor};
          padding: 0 2px;
          border-radius: 2px;
          cursor: help;
        `,
        title,
      },
      0,
    ];
  },

  addCommands() {
    return {
      setHighlight:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
