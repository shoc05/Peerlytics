import React, { useEffect, useImperativeHandle, forwardRef, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { HighlightMark } from './HighlightMark';
import Toolbar from './Toolbar';
import './workspace-editor.css';

const SAVE_DEBOUNCE_MS = 600;
/** Full page height in px (US Letter at ~96dpi) */
const PAGE_HEIGHT = 1056;
/** Content area inside margins (1056 - 96*2) */
const PAGE_CONTENT_HEIGHT = 864;

const WorkspaceEditor = forwardRef(function WorkspaceEditor(
  {
    storageKey,
    initialHtml = '',
    readOnly = false,
    placeholder = 'Start typing your document…',
    flaggedContent = [],
    onChange,
    onPasteLarge,
    onTypingStart,
    onTypingStop,
    onPageChange,
  },
  ref
) {
  const saveTimer = useRef(null);
  const lastLenRef = useRef(0);
  const hasAppliedHighlights = useRef(false);
  const canvasRef = useRef(null);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  const updatePages = useCallback(
    (editorInstance) => {
      const dom = editorInstance?.view?.dom;
      if (!dom) return;
      const contentH = dom.scrollHeight || PAGE_CONTENT_HEIGHT;
      const total = Math.max(1, Math.ceil(contentH / PAGE_HEIGHT));
      setPageCount(total);
      onPageChange?.(currentPage, total);
    },
    [currentPage, onPageChange]
  );

  const updateCurrentPageFromScroll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const page = Math.max(1, Math.min(pageCount, Math.floor(canvas.scrollTop / PAGE_HEIGHT) + 1));
    setCurrentPage(page);
    onPageChange?.(page, pageCount);
  }, [pageCount, onPageChange]);

  const persist = useCallback(
    (html, text) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ html, text, savedAt: Date.now() })
        );
      } catch {
        /* quota */
      }
    },
    [storageKey]
  );

  // Set by the real paste handler so onUpdate can report the ACTUAL pasted text
  // (not a length-delta guess). Cleared after it's consumed.
  const pendingPasteRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      HighlightMark,
    ],
    content: initialHtml || '<p></p>',
    editable: !readOnly,
    editorProps: {
      // Capture the real clipboard text on paste — this is the accurate pasted
      // fragment, regardless of where in the document it was inserted.
      handlePaste: (_view, event) => {
        try {
          const pasted = event.clipboardData?.getData('text/plain') || '';
          if (pasted.trim()) pendingPasteRef.current = pasted;
        } catch {
          /* ignore */
        }
        return false; // let TipTap perform the actual paste
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      const text = ed.getText();
      const prevLen = lastLenRef.current;
      const delta = text.length - prevLen;
      // Prefer the real pasted text captured by handlePaste; fall back to delta.
      const pastedText = pendingPasteRef.current;
      pendingPasteRef.current = null;
      if (pastedText && onPasteLarge) {
        onPasteLarge({ html, text, delta, pastedText });
      } else if (delta >= 25 && onPasteLarge) {
        onPasteLarge({ html, text, delta });
      }
      lastLenRef.current = text.length;
      onChange?.({ html, text });
      onTypingStart?.();
      const dom = ed.view?.dom;
      if (dom) {
        const total = Math.max(1, Math.ceil((dom.scrollHeight || PAGE_CONTENT_HEIGHT) / PAGE_HEIGHT));
        setPageCount(total);
        onPageChange?.(currentPage, total);
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        persist(html, text);
        onTypingStop?.();
      }, SAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    if (!editor) return undefined;
    const dom = editor.view?.dom;
    if (dom) {
      const total = Math.max(1, Math.ceil((dom.scrollHeight || PAGE_CONTENT_HEIGHT) / PAGE_HEIGHT));
      setPageCount(total);
      onPageChange?.(1, total);
    }
    const onResize = () => updatePages(editor);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [editor, updatePages, onPageChange]);

  useEffect(() => {
    if (!editor || !storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const hasFirestoreContent = initialHtml && initialHtml.replace(/<[^>]+>/g, '').trim().length > 0;
        if (parsed.html && !hasFirestoreContent) {
          editor.commands.setContent(parsed.html, false);
          lastLenRef.current = (parsed.text || '').length;
          updatePages(editor);
        }
      }
    } catch {
      /* ignore */
    }
  }, [editor, storageKey, initialHtml, updatePages]);

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || !readOnly || !flaggedContent?.length) return;
    if (hasAppliedHighlights.current) return;

    flaggedContent.forEach((flag) => {
      if (flag.startIndex !== undefined && flag.endIndex !== undefined) {
        const from = Math.max(1, flag.startIndex);
        const to = Math.min(editor.state.doc.content.size - 1, flag.endIndex);
        if (to <= from) return;
        editor
          .chain()
          .setTextSelection({ from, to })
          .setMark('highlight', {
            type: flag.highlight === 'red' ? 'ai-generated' : 'plagiarism',
            reason: flag.reason || '',
            id: flag.id || '',
          })
          .run();
      }
    });

    hasAppliedHighlights.current = true;
  }, [editor, readOnly, flaggedContent]);

  // Load content ONCE per document (keyed by storageKey). Critically, we do NOT
  // re-apply `initialHtml` on every change — the parent echoes the editor's own
  // output back as `initialHtml`, and re-applying it (even while unfocused) can
  // overwrite freshly typed text with a stale value, i.e. "writing gets deleted".
  // A new file (new storageKey) loads its content; remote collaborator updates are
  // pushed imperatively via the `setContent` ref handle, guarded against active typing.
  const loadedKeyRef = useRef(null);
  useEffect(() => {
    if (!editor) return;
    if (loadedKeyRef.current === storageKey) return; // already loaded this document
    loadedKeyRef.current = storageKey;
    if (initialHtml && editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, false);
      lastLenRef.current = editor.getText().length;
      hasAppliedHighlights.current = false;
      updatePages(editor);
    }
  }, [editor, storageKey, initialHtml, updatePages]);

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? '',
    getText: () => editor?.getText() ?? '',
    getEditor: () => editor,
    getPageInfo: () => ({ current: currentPage, total: pageCount }),
    setContent: (html) => {
      if (editor && html) {
        editor.commands.setContent(html, false);
        lastLenRef.current = editor.getText().length;
        updatePages(editor);
      }
    },
  }));

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const charCount = editor ? editor.getText().length : 0;

  return (
    <div className="workspace-editor-root">
      {!readOnly && <Toolbar editor={editor} disabled={readOnly} />}
      <div
        className="workspace-editor-canvas"
        ref={canvasRef}
        onScroll={updateCurrentPageFromScroll}
      >
        <div className="workspace-editor-gdoc-column">
          <div className={`workspace-editor-gdoc-page${readOnly ? ' read-only' : ''}`}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <div className="workspace-editor-status">
        <span>{readOnly ? 'View only' : 'Auto-save enabled'}</span>
        <span>
          Page {currentPage}
          {pageCount > 1 ? ` of ${pageCount}` : ''}
          {' · '}
          {charCount} characters
        </span>
      </div>
    </div>
  );
});

export default WorkspaceEditor;
