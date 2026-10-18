// TipTap extensions for live editing. Use with StarterKit's history turned off: Yjs keeps
// its own undo history per user, so one student's undo never removes another's text.
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';

// Must match FIELD in collab/src/server.js.
export const COLLAB_FIELD = 'default';

export function collabExtensions(collab) {
  return [
    Collaboration.configure({ document: collab.ydoc, field: COLLAB_FIELD }),
    CollaborationCursor.configure({ provider: collab.provider, user: collab.user }),
  ];
}
