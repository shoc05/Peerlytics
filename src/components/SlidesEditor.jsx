import React, { useState, useEffect, useRef } from 'react';

function parseInitial(value) {
  if (!value) return [{ id: 's-1', title: 'Slide 1', body: '' }];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* fall through */
  }
  return [{ id: 's-1', title: 'Slide 1', body: '' }];
}

export default function SlidesEditor({ fileId, readOnly = false, darkMode = true, initialValue, onChange }) {
  const [slides, setSlides] = useState(() => parseInitial(initialValue));
  const [activeId, setActiveId] = useState(() => slides[0]?.id || null);
  const lastFileIdRef = useRef(fileId);

  useEffect(() => {
    if (lastFileIdRef.current !== fileId) {
      lastFileIdRef.current = fileId;
      const next = parseInitial(initialValue);
      setSlides(next);
      setActiveId(next[0]?.id || null);
    }
  }, [fileId, initialValue]);

  const commit = (next) => {
    setSlides(next);
    onChange?.(JSON.stringify(next));
  };

  const active = slides.find((s) => s.id === activeId) || slides[0];

  const updateActive = (patch) => {
    if (readOnly || !active) return;
    commit(slides.map((s) => (s.id === active.id ? { ...s, ...patch } : s)));
  };

  const addSlide = () => {
    if (readOnly) return;
    const id = `s-${Date.now()}`;
    const next = [...slides, { id, title: `Slide ${slides.length + 1}`, body: '' }];
    commit(next);
    setActiveId(id);
  };

  const removeSlide = (id) => {
    if (readOnly || slides.length <= 1) return;
    const next = slides.filter((s) => s.id !== id);
    commit(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const bg = darkMode ? '#1c1c1c' : '#404040';
  const sidebarBg = darkMode ? '#0d0d0d' : '#2b2b2b';
  const borderColor = darkMode ? '#2e2e2e' : '#3d3d3d';
  const txt = '#f1f1f1';
  const sub = '#b0b0b0';
  const activeBg = 'rgba(210, 71, 38, 0.25)';
  const activeBorder = '#d24726';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: bg }}>
      <div style={{ background: '#d24726', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
        Presentation
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: 200, background: sidebarBg, borderRight: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slides.map((s, i) => {
              const isActive = s.id === activeId;
              return (
                <div
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  style={{
                    border: `2px solid ${isActive ? activeBorder : borderColor}`,
                    background: isActive ? activeBg : '#1f1f1f',
                    borderRadius: 6,
                    padding: 8,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <div style={{ fontSize: 10, color: sub, marginBottom: 4 }}>Slide {i + 1}</div>
                  <div style={{ fontSize: 11, color: txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '(untitled)'}
                  </div>
                  {!readOnly && slides.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeSlide(s.id); }}
                      style={{ position: 'absolute', top: 4, right: 4, background: 'transparent', border: 'none', color: sub, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                      aria-label="Remove slide"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnly && (
            <div style={{ padding: 10, borderTop: `1px solid ${borderColor}` }}>
              <button
                type="button"
                onClick={addSlide}
                style={{ width: '100%', background: '#d24726', border: 'none', borderRadius: 6, padding: '6px 16px', color: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Add slide
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          {active && (
            <div
              style={{
                width: 'min(820px, 100%)',
                aspectRatio: '16 / 9',
                background: '#fff',
                color: '#1a1a1a',
                borderRadius: 8,
                boxShadow: '0 6px 30px rgba(0,0,0,0.35)',
                padding: 40,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <input
                type="text"
                value={active.title}
                readOnly={readOnly}
                onChange={(e) => updateActive({ title: e.target.value })}
                placeholder="Slide title"
                style={{ border: 'none', outline: 'none', fontSize: 32, fontWeight: 700, color: '#1a1a1a', background: 'transparent', width: '100%' }}
              />
              <textarea
                value={active.body}
                readOnly={readOnly}
                onChange={(e) => updateActive({ body: e.target.value })}
                placeholder="Slide content"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 18, color: '#333', background: 'transparent', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
