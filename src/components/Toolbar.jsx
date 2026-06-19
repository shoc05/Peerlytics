import React from 'react';

function ToolBtn({ title, active, disabled, onClick, children, wide }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`doc-toolbar-btn${active ? ' is-active' : ''}${wide ? ' wide' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ editor, disabled }) {
  if (!editor) return null;

  return (
    <div className="workspace-editor-toolbar">
      <ToolBtn title="Bold" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolBtn>
      <ToolBtn title="Italic" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolBtn>
      <ToolBtn title="Underline" active={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span style={{ textDecoration: 'underline' }}>U</span>
      </ToolBtn>
      <span className="toolbar-divider" />
      <ToolBtn title="Heading 1" active={editor.isActive('heading', { level: 1 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        H1
      </ToolBtn>
      <ToolBtn title="Heading 2" active={editor.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        H2
      </ToolBtn>
      <ToolBtn title="Heading 3" active={editor.isActive('heading', { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        H3
      </ToolBtn>
      <span className="toolbar-divider" />
      <ToolBtn title="Bullet list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()} wide>
        List
      </ToolBtn>
      <ToolBtn title="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()} wide>
        1.2.3
      </ToolBtn>
      <span className="toolbar-divider" />
      <ToolBtn title="Align left" active={editor.isActive({ textAlign: 'left' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <span className="align-icon align-left" />
      </ToolBtn>
      <ToolBtn title="Align center" active={editor.isActive({ textAlign: 'center' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <span className="align-icon align-center" />
      </ToolBtn>
      <ToolBtn title="Align right" active={editor.isActive({ textAlign: 'right' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <span className="align-icon align-right" />
      </ToolBtn>
      <span className="toolbar-divider" />
      <ToolBtn title="Undo" disabled={disabled} onClick={() => editor.chain().focus().undo().run()}>
        Undo
      </ToolBtn>
      <ToolBtn title="Redo" disabled={disabled} onClick={() => editor.chain().focus().redo().run()}>
        Redo
      </ToolBtn>
    </div>
  );
}
