// TipTap extensions for live editing. Use with StarterKit's history turned off: Yjs keeps
// its own undo history per user, so one student's undo never removes another's text.
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { COLLAB_FIELD } from './collab';

/** `field` is the Yjs fragment to edit: one per document tab (tabs.js), "default" without tabs. */
export function collabExtensions(collab, field = COLLAB_FIELD) {
  return [
    Collaboration.configure({ document: collab.ydoc, field }),
    CollaborationCursor.configure({ provider: collab.provider, user: collab.user }),
  ];
}
