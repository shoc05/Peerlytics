import fs from 'fs';

const p = 'src/components/peerlytics-app.jsx';
let c = fs.readFileSync(p, 'utf8');

const anchor = `                </ResponsiveContainer>
              </div>
            </motionWrap>
          )}

          {/* GRADING PANEL */}`.replace(/motionWrap/g, 'div');

const idx = c.indexOf(anchor);
if (idx < 0) {
  const alt = c.indexOf('Activity Timeline');
  console.error('anchor not found', alt);
  process.exit(1);
}

const insert = `                </ResponsiveContainer>
              </div>

              {isLecturer && (
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
                </div>
              )}
            </div>
          )}

          {/* GRADING PANEL */}`;

c = c.slice(0, idx) + insert + c.slice(idx + anchor.length);
fs.writeFileSync(p, c);
console.log('analytics panel inserted');
