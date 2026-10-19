// TipTap extension that highlights the text each inline comment is anchored to (step 4.6).
// Decorations only: the document itself is never changed, so the submitted text stays as
// submitted. Update the comments with editor.commands.setFeedback(items).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { resolveAnchor, textIndex } from './anchors';

export const feedbackKey = new PluginKey('inlineFeedback');

function build(doc, items) {
  if (!items?.length) return DecorationSet.empty;
  const index = textIndex(doc);
  const decorations = [];
  for (const item of items) {
    const found = resolveAnchor(index.text, item.quote);
    const range = found && index.toPositions(found.start, found.end);
    if (!range) continue;
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: 'inline-feedback',
        title: `${item.lecturerName || 'Lecturer'}: ${item.comment}`,
        'data-feedback-id': item.id,
        style: 'background: rgba(255, 196, 0, 0.35); border-bottom: 2px solid #e0a800; cursor: help;',
      })
    );
  }
  return DecorationSet.create(doc, decorations);
}

export const FeedbackHighlights = Extension.create({
  name: 'inlineFeedback',

  addCommands() {
    return {
      setFeedback:
        (items) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(feedbackKey, items || []));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: feedbackKey,
        state: {
          init: () => ({ items: [], decorations: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const items = tr.getMeta(feedbackKey);
            if (items) return { items, decorations: build(newState.doc, items) };
            if (tr.docChanged) return { items: value.items, decorations: build(newState.doc, value.items) };
            return value;
          },
        },
        props: {
          decorations: (state) => feedbackKey.getState(state).decorations,
        },
      }),
    ];
  },
});
