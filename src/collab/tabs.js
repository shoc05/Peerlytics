// Document tabs (step 2.3, behind doc_tabs_enabled). Pure Yjs operations, no React.
//
// One live document holds:
//   tabs: Y.Array of Y.Map { id, title, parentId, order }  — the tab list, synced live
//   one Y.XmlFragment per tab                               — that tab's text
// The first tab uses the "default" fragment, so a document written before tabs existed
// becomes "Tab 1" with all its text. Other tabs use "tab:<id>".

import * as Y from 'yjs';
import { COLLAB_FIELD } from './collab.js';

export const TABS_KEY = 'tabs';
export const DEFAULT_TAB_ID = 'default';
export const MAX_TABS = 50;
export const MAX_DEPTH = 3; // a tab, a sub-tab and a sub-sub-tab, like Google Docs
export const MAX_TITLE = 100;

export function fragmentName(tabId) {
  return tabId === DEFAULT_TAB_ID ? COLLAB_FIELD : `tab:${tabId}`;
}

export function tabFragment(ydoc, tabId) {
  return ydoc.getXmlFragment(fragmentName(tabId));
}

const tabsArray = (ydoc) => ydoc.getArray(TABS_KEY);

function cleanTitle(title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!t) throw new Error('A tab needs a title.');
  return t;
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Every tab as a plain object, first copy wins if two clients created the same id at once. */
function rawTabs(ydoc) {
  const seen = new Set();
  const out = [];
  tabsArray(ydoc).forEach((m, index) => {
    const id = m.get('id');
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: m.get('title') || 'Untitled', parentId: m.get('parentId') ?? null, order: m.get('order') ?? 0, index });
  });
  // A tab whose parent is gone (deleted concurrently) is shown at the top level.
  return out.map((t) => (t.parentId && !seen.has(t.parentId) ? { ...t, parentId: null } : t));
}

/**
 * The tab tree in display order: [{ id, title, parentId, order, depth }]. A document that
 * has no tab list yet shows one tab, "Tab 1", backed by the default fragment.
 */
export function listTabs(ydoc) {
  const tabs = rawTabs(ydoc);
  if (!tabs.length) return [{ id: DEFAULT_TAB_ID, title: 'Tab 1', parentId: null, order: 0, depth: 0 }];
  const byParent = new Map();
  for (const t of tabs) {
    const key = t.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const out = [];
  const walk = (parentId, depth) => {
    const children = (byParent.get(parentId) || []).sort((a, b) => a.order - b.order || a.index - b.index);
    for (const { index: _index, ...t } of children) {
      out.push({ ...t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Create the tab list with "Tab 1" if it doesn't exist yet. */
export function ensureTabs(ydoc) {
  if (tabsArray(ydoc).length) return;
  ydoc.transact(() => {
    tabsArray(ydoc).push([new Y.Map(Object.entries({ id: DEFAULT_TAB_ID, title: 'Tab 1', parentId: null, order: 0 }))]);
  });
}

function findMap(ydoc, id) {
  let found = null;
  tabsArray(ydoc).forEach((m) => {
    if (!found && m.get('id') === id) found = m;
  });
  return found;
}

function depthOf(tabs, id) {
  let depth = 0;
  let current = tabs.find((t) => t.id === id);
  while (current?.parentId) {
    depth += 1;
    current = tabs.find((t) => t.id === current.parentId);
  }
  return depth;
}

function subtreeHeight(tabs, id) {
  const children = tabs.filter((t) => t.parentId === id);
  return children.length ? 1 + Math.max(...children.map((c) => subtreeHeight(tabs, c.id))) : 0;
}

function descendants(tabs, id) {
  const out = [];
  for (const child of tabs.filter((t) => t.parentId === id)) out.push(child.id, ...descendants(tabs, child.id));
  return out;
}

/** Add a tab (or a sub-tab under parentId) at the end of its siblings. Returns its id. */
export function addTab(ydoc, { title = 'Untitled tab', parentId = null } = {}) {
  ensureTabs(ydoc);
  const tabs = listTabs(ydoc);
  if (tabs.length >= MAX_TABS) throw new Error(`A document can have at most ${MAX_TABS} tabs.`);
  if (parentId) {
    if (!tabs.some((t) => t.id === parentId)) throw new Error('That parent tab no longer exists.');
    if (depthOf(tabs, parentId) + 1 >= MAX_DEPTH) throw new Error(`Tabs can be nested ${MAX_DEPTH} levels deep.`);
  }
  const siblings = tabs.filter((t) => (t.parentId ?? null) === (parentId ?? null));
  const id = newId();
  const order = siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0;
  ydoc.transact(() => {
    tabsArray(ydoc).push([new Y.Map(Object.entries({ id, title: cleanTitle(title), parentId: parentId ?? null, order }))]);
  });
  return id;
}

export function renameTab(ydoc, id, title) {
  ensureTabs(ydoc);
  const map = findMap(ydoc, id);
  if (!map) throw new Error('That tab no longer exists.');
  const clean = cleanTitle(title);
  ydoc.transact(() => map.set('title', clean));
}

/**
 * Move a tab to position `index` among the children of `parentId` (null = top level).
 * Moves its sub-tabs with it. Refuses moves into its own sub-tree or past MAX_DEPTH.
 */
export function moveTab(ydoc, id, { parentId = null, index = 0 } = {}) {
  ensureTabs(ydoc);
  const tabs = listTabs(ydoc);
  const tab = tabs.find((t) => t.id === id);
  if (!tab) throw new Error('That tab no longer exists.');
  if (parentId) {
    if (parentId === id || descendants(tabs, id).includes(parentId)) throw new Error('A tab cannot go inside itself.');
    if (!tabs.some((t) => t.id === parentId)) throw new Error('That parent tab no longer exists.');
    if (depthOf(tabs, parentId) + 1 + subtreeHeight(tabs, id) >= MAX_DEPTH) {
      throw new Error(`Tabs can be nested ${MAX_DEPTH} levels deep.`);
    }
  }
  const siblings = tabs.filter((t) => (t.parentId ?? null) === (parentId ?? null) && t.id !== id);
  const at = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, tab);
  ydoc.transact(() => {
    siblings.forEach((t, order) => {
      const map = findMap(ydoc, t.id);
      if (map.get('order') !== order) map.set('order', order);
    });
    const map = findMap(ydoc, id);
    if ((map.get('parentId') ?? null) !== (parentId ?? null)) map.set('parentId', parentId ?? null);
  });
}

/** Delete a tab, its sub-tabs and their text. The last remaining tab can't be deleted. */
export function deleteTab(ydoc, id) {
  ensureTabs(ydoc);
  const tabs = listTabs(ydoc);
  if (!tabs.some((t) => t.id === id)) return [];
  const doomed = [id, ...descendants(tabs, id)];
  if (doomed.length >= tabs.length) throw new Error('A document needs at least one tab.');
  ydoc.transact(() => {
    const arr = tabsArray(ydoc);
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (doomed.includes(arr.get(i).get('id'))) arr.delete(i, 1);
    }
    for (const tabId of doomed) {
      const fragment = tabFragment(ydoc, tabId);
      if (fragment.length) fragment.delete(0, fragment.length);
    }
  });
  return doomed;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The whole document with tab titles, for saving, analysis and the report.
 * `serialize(fragment)` returns { html, text } for one tab (the editor supplies it).
 * Returns { html, text, tabs: [{ id, title, depth, wordCount }] }.
 */
export function exportTabs(ydoc, serialize) {
  const tabs = listTabs(ydoc);
  const parts = tabs.map((tab) => ({ tab, ...serialize(tabFragment(ydoc, tab.id)) }));
  // A document with a single tab exports exactly as it did before tabs existed.
  if (parts.length === 1) {
    const [{ tab, html, text }] = parts;
    return { html, text, tabs: [{ id: tab.id, title: tab.title, depth: 0, wordCount: countWords(text) }] };
  }
  return {
    html: parts
      .map(({ tab, html }) => `<h${tab.depth + 1} data-tab-id="${escapeHtml(tab.id)}">${escapeHtml(tab.title)}</h${tab.depth + 1}>${html}`)
      .join(''),
    text: parts.map(({ tab, text }) => `${tab.title}\n${text}`.trim()).join('\n\n'),
    tabs: parts.map(({ tab, text }) => ({ id: tab.id, title: tab.title, depth: tab.depth, wordCount: countWords(text) })),
  };
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}
