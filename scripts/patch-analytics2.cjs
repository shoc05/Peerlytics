const fs = require('fs');
const p = 'src/components/peerlytics-app.jsx';
let c = fs.readFileSync(p, 'utf8');

const marker = '          {/* GRADING PANEL */}';
const gi = c.indexOf(marker);
if (gi < 0) {
  console.error('GRADING marker not found');
  process.exit(1);
}

const beforeGrading = c.slice(0, gi);
const closeOuter = beforeGrading.lastIndexOf('            </div>\r\n          )}');
if (closeOuter < 0) {
  console.error('outer close not found');
  process.exit(1);
}

const block =
  `              {isLecturer && (
                <div
                  style={{
                    background: darkMode ? 'rgba(26, 31, 58, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                    border: \`1px solid \${darkMode ? '#2a3555' : '#e0e0e0'}\`,
                    borderRadius: '12px',
                    padding: '24px',
                    backdropFilter: 'blur(10px)',
                    marginTop: '24px',
                  }}
                >
                  <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600' }}>
                    Submission Reports (AI + Plagiarism)
                  </h2>
                  <AnalyticsPanel reports={submissionReports} groupMembers={groupMembers} darkMode={darkMode} />
                </motionWrap>
              )}
            </motionWrap>
          )}

          `.replace(/motionWrap/g, 'div');

const out = c.slice(0, closeOuter) + block + c.slice(gi);
fs.writeFileSync(p, out);
console.log('patched at', closeOuter);
