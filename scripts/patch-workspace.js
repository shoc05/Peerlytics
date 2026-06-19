import fs from 'fs';

const p = 'src/components/WorkspacePanel.jsx';
let c = fs.readFileSync(p, 'utf8');
const start = c.indexOf('            {/* Document canvas */}');
const end = c.indexOf('            {/* Status bar */}');
if (start < 0 || end < 0) {
  console.error('markers not found');
  process.exit(1);
}

const replacement = `            {submitting && (
              <motionWrap style={{ padding: '12px 20px', background: '#e8f4fc', color: '#2b579a', fontSize: 13, textAlign: 'center' }}>
                Running AI + plagiarism analysis…
              </motionWrap>
            )}

            <motionWrap
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: isDoc ? '#f1f3f4' : '#525659',
              }}
            >
              {isDoc ? (
                <WorkspaceEditor
                  ref={editorRef}
                  storageKey={\`peerlytics-doc-\${openFile.id}\`}
                  initialHtml={editorHtml}
                  readOnly={readOnly || openFile.submitted}
                  placeholder={readOnly ? 'Student content (view only)' : 'Start typing your document…'}
                  onChange={handleEditorChange}
                  onPasteLarge={({ text }) => {
                    if (text.length - editorContent.length > 80) {
                      triggerPaste([{ start: editorContent.length, end: text.length }], text);
                    }
                  }}
                />
              ) : (
                <motionWrap
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: isMaximized ? '24px 0' : '20px 0',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <motionWrap
                    style={{
                      width: '100%',
                      maxWidth: 900,
                      minHeight: isMaximized ? 'calc(100vh - 200px)' : 480,
                      background: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      margin: '0 24px',
                      padding: 24,
                      boxSizing: 'border-box',
                    }}
                  >
                    <textarea
                      value={editorContent}
                      readOnly={readOnly}
                      onChange={onEditorChange}
                      onBlur={onBlurSave}
                      placeholder={readOnly ? 'Student content (view only)' : 'Content…'}
                      style={{
                        width: '100%',
                        minHeight: isMaximized ? 'calc(100vh - 280px)' : 400,
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        cursor: readOnly ? 'default' : 'text',
                        background: readOnly ? '#fafafa' : 'transparent',
                        color: openFile.type === 'code' ? '#24292e' : '#1a1a1a',
                        fontFamily: openFile.type === 'code' ? 'Consolas, monospace' : 'inherit',
                        fontSize: 14,
                        lineHeight: 1.6,
                      }}
                    />
                  </motionWrap>
                </motionWrap>
              )}
            </motionWrap>

`;

c = c.slice(0, start) + replacement.replace(/motionWrap/g, 'div') + c.slice(end);

if (!c.includes('showReportModal && submissionReport')) {
  const ins = c.indexOf('      {confirmDelete &&');
  const modal = `
      {showReportModal && submissionReport && (
        <motionWrap style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <motionWrap style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <ReportCard report={submissionReport} darkMode={darkMode} />
            <button type="button" onClick={() => setShowReportModal(false)} style={{ marginTop: 12, width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer' }}>Close</button>
          </motionWrap>
        </motionWrap>
      )}

`.replace(/motionWrap/g, 'motionWrap').replace(/motionWrap/g, 'div');
  c = c.slice(0, ins) + modal + c.slice(ins);
}

fs.writeFileSync(p, c);
console.log('done');
