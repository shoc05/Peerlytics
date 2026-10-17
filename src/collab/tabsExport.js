// Turn a tab's Yjs fragment into { html, text } with the editor's schema, so tabs other
// than the one on screen can be saved and analysed too.
import { getHTMLFromFragment } from '@tiptap/core';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { exportTabs } from './tabs.js';

export function fragmentSerializer(schema) {
  return (fragment) => {
    const node = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    return {
      html: getHTMLFromFragment(node.content, schema),
      // Same block separator as editor.getText().
      text: node.textBetween(0, node.content.size, '\n\n'),
    };
  };
}

/** The whole document, every tab with its title: { html, text, tabs }. */
export function exportDocument(ydoc, schema) {
  return exportTabs(ydoc, fragmentSerializer(schema));
}
