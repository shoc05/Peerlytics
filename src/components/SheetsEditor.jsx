import React, { useState, useMemo, useRef, useEffect } from 'react';

const COLS = 12;
const ROWS = 30;
const HEADER_WIDTH = 40;
const COL_WIDTH = 100;
const ROW_HEIGHT = 26;

const colLabel = (c) => String.fromCharCode(65 + c);
const cellKey = (r, c) => `${r}:${c}`;

function parseInitial(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function SheetsEditor({ fileId, readOnly = false, darkMode = false, initialValue, onChange }) {
  const [grid, setGrid] = useState(() => parseInitial(initialValue));
  const [selected, setSelected] = useState({ row: -1, col: -1 });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef(null);
  const lastFileIdRef = useRef(fileId);

  // Reset state when switching files
  useEffect(() => {
    if (lastFileIdRef.current !== fileId) {
      lastFileIdRef.current = fileId;
      setGrid(parseInitial(initialValue));
      setSelected({ row: -1, col: -1 });
      setEditing(false);
    }
  }, [fileId, initialValue]);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const commit = (next) => {
    setGrid(next);
    onChange?.(JSON.stringify(next));
  };

  const startEdit = (r, c) => {
    if (readOnly) return;
    setSelected({ row: r, col: c });
    setEditValue(grid[cellKey(r, c)] || '');
    setEditing(true);
  };

  const finishEdit = (commitValue) => {
    if (!editing) return;
    if (commitValue) {
      const key = cellKey(selected.row, selected.col);
      const next = { ...grid };
      const v = editValue.trim();
      if (v === '') delete next[key];
      else next[key] = editValue;
      commit(next);
    }
    setEditing(false);
  };

  const bg = darkMode ? '#1c1c1c' : '#ffffff';
  const headerBg = '#f3f3f3';
  const headerAccent = '#217346';
  const borderColor = darkMode ? '#2e2e2e' : '#d4d4d4';
  const txt = darkMode ? '#ededed' : '#000000';
  const selectedBg = darkMode ? 'rgba(33,116,70,0.25)' : '#e7f4ea';

  const cellRef = selected.row >= 0 && selected.col >= 0 ? `${colLabel(selected.col)}${selected.row + 1}` : '';

  const cells = useMemo(() => {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const key = cellKey(r, c);
        row.push({ r, c, key, value: grid[key] || '' });
      }
      rows.push(row);
    }
    return rows;
  }, [grid]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: darkMode ? '#0d0d0d' : '#f3f3f3' }}>
      <div style={{ background: headerAccent, color: '#fff', padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
        Spreadsheet
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: bg, borderBottom: `1px solid ${borderColor}`, fontSize: 12, color: txt }}>
        <span style={{ color: '#666', fontWeight: 600 }}>fx</span>
        <span style={{ flex: 1, fontFamily: 'Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {editing ? editValue : (grid[cellKey(selected.row, selected.col)] || '')}
        </span>
        {cellRef && <span style={{ color: darkMode ? '#9a9a9a' : '#666' }}>{cellRef}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: bg }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: HEADER_WIDTH, minWidth: HEADER_WIDTH, background: headerAccent, border: `1px solid ${borderColor}`, color: '#fff', fontSize: 11, fontWeight: 700, position: 'sticky', top: 0, left: 0, zIndex: 3 }} />
              {Array.from({ length: COLS }, (_, c) => (
                <th key={c} style={{ width: COL_WIDTH, background: selected.col === c ? '#1e6b42' : headerAccent, border: `1px solid ${borderColor}`, color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 2 }}>
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, r) => (
              <tr key={r}>
                <td style={{ background: selected.row === r ? '#1e6b42' : headerAccent, border: `1px solid ${borderColor}`, color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center', width: HEADER_WIDTH, position: 'sticky', left: 0, zIndex: 1, height: ROW_HEIGHT }}>
                  {r + 1}
                </td>
                {row.map((cell) => {
                  const isSel = selected.row === cell.r && selected.col === cell.c;
                  const isEditing = isSel && editing;
                  return (
                    <td
                      key={cell.key}
                      onClick={() => setSelected({ row: cell.r, col: cell.c })}
                      onDoubleClick={() => startEdit(cell.r, cell.c)}
                      style={{
                        border: `1px solid ${borderColor}`,
                        background: isSel ? selectedBg : bg,
                        color: txt,
                        padding: 0,
                        width: COL_WIDTH,
                        height: ROW_HEIGHT,
                        fontSize: 12,
                        overflow: 'hidden',
                        cursor: readOnly ? 'default' : 'cell',
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={editRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => finishEdit(true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
                            else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
                          }}
                          style={{ width: '100%', height: '100%', border: 'none', outline: 'none', background: '#fff', color: '#000', padding: '0 4px', fontSize: 12, boxSizing: 'border-box' }}
                        />
                      ) : (
                        <div style={{ padding: '0 4px', lineHeight: `${ROW_HEIGHT}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cell.value}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
