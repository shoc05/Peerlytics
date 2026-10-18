// useDocumentTabs(collab, { enabled }) — the tab list of the live document, for the tabs
// panel (Ngawang's N5) and the editor. Behind doc_tabs_enabled, and only under live editing.
//
// Returns {
//   enabled,            false when tabs are off: one document body, nothing to show
//   tabs,               [{ id, title, parentId, order, depth }] in display order
//   activeTabId,        the tab on screen (local to this browser)
//   activeField,        the Yjs fragment the editor should edit
//   select(id),
//   add({ title, parentId }) -> id,  rename(id, title),  move(id, { parentId, index }),  remove(id)
// }
// The mutating functions throw an Error with a message to show the user (e.g. too deep).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { COLLAB_FIELD } from './collab';
import { addTab, deleteTab, fragmentName, listTabs, moveTab, renameTab, TABS_KEY } from './tabs';

const OFF = {
  enabled: false,
  tabs: [],
  activeTabId: null,
  activeField: COLLAB_FIELD,
  select: () => {},
  add: () => null,
  rename: () => {},
  move: () => {},
  remove: () => {},
};

export function useDocumentTabs(collab, { enabled }) {
  const ydoc = enabled && collab?.synced ? collab.ydoc : null;
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  useEffect(() => {
    if (!ydoc) {
      setTabs([]);
      setActiveTabId(null);
      return undefined;
    }
    const array = ydoc.getArray(TABS_KEY);
    const refresh = () => setTabs(listTabs(ydoc));
    refresh();
    array.observeDeep(refresh);
    return () => array.unobserveDeep(refresh);
  }, [ydoc]);

  // Keep a valid tab on screen when the active one is deleted by anyone.
  const resolvedActive = tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0]?.id ?? null;

  const select = useCallback((id) => setActiveTabId(id), []);
  const add = useCallback((opts) => {
    const id = addTab(ydoc, opts);
    setActiveTabId(id);
    return id;
  }, [ydoc]);
  const rename = useCallback((id, title) => renameTab(ydoc, id, title), [ydoc]);
  const move = useCallback((id, to) => moveTab(ydoc, id, to), [ydoc]);
  const remove = useCallback((id) => deleteTab(ydoc, id), [ydoc]);

  return useMemo(() => {
    if (!ydoc) return OFF;
    return {
      enabled: true,
      tabs,
      activeTabId: resolvedActive,
      activeField: resolvedActive ? fragmentName(resolvedActive) : COLLAB_FIELD,
      select,
      add,
      rename,
      move,
      remove,
    };
  }, [ydoc, tabs, resolvedActive, select, add, rename, move, remove]);
}
