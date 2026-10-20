// Builds postman/peerlytics.postman_collection.json from the request list below.
//   node postman/build-collection.mjs
// Edit this file, not the JSON. postman/collection.test.mjs fails if a route in
// backend/openapi.yaml has no request here, so the two can't drift apart.
//
// Requests run top to bottom: each one checks its status code, and saves ids for the next.
// Tokens and uids come from the environment (postman/peerlytics.postman_environment.json for
// the shape; postman/ci/seed-emulator.mjs fills it in CI). No secrets are stored here.
import { writeFileSync } from 'node:fs';

const requests = [];
const r = (folder, name, method, path, opts = {}) => requests.push({ folder, name, method, path, ...opts });
const inAWeek = `pm.collectionVariables.set('deadline', new Date(Date.now() + 7 * 864e5).toISOString());`;
const inTwoWeeks = `pm.collectionVariables.set('extendedDeadline', new Date(Date.now() + 14 * 864e5).toISOString());`;

// ── Health and auth ──
r('Health', 'Health (no token)', 'GET', '/health', { as: null, expect: 200, tests: [`pm.expect(json.ok).to.eql(true);`] });
r('Auth', 'Me without a token: 401 NO_TOKEN', 'GET', '/auth/me', { as: null, expect: 401, code: 'NO_TOKEN' });
r('Auth', 'Me', 'GET', '/auth/me', { as: 'student1', expect: 200, tests: [`pm.expect(json.role).to.eql('student');`] });
r('Auth', 'Pick a role twice: 409', 'POST', '/auth/role', { as: 'student1', body: { role: 'student' }, expect: 409, code: 'ROLE_ALREADY_SET' });
r('Auth', 'Admin sets a role', 'POST', '/admin/users/{{uid_spare}}/role', { as: 'superAdmin', body: { role: 'student' }, expect: 200 });
r('Auth', 'Student cannot set roles: 403', 'POST', '/admin/users/{{uid_spare}}/role', { as: 'student1', body: { role: 'lecturer' }, expect: 403 });

// ── Courses and enrolment ──
r('Courses', 'Student cannot create a course: 403', 'POST', '/courses', { as: 'student1', body: { code: 'CTE412', title: 'Mini project' }, expect: 403 });
r('Courses', 'User without a role: 403 NO_ROLE', 'GET', '/courses', { as: 'noRole', expect: 403, code: 'NO_ROLE' });
r('Courses', 'Create a course', 'POST', '/courses', {
  as: 'lecturer', body: { code: 'CTE412', title: 'Mini project', term: 'Autumn 2026' }, expect: 201,
  save: { courseId: 'json.id', joinCode: 'json.joinCode' },
  tests: [`pm.expect(json.joinCode).to.match(/^[A-HJKMNP-Z2-9]{8}$/);`],
});
r('Courses', 'Bad body: 400 INVALID_BODY', 'POST', '/courses', { as: 'lecturer', body: { code: 'X' }, expect: 400, code: 'INVALID_BODY' });
r('Courses', 'Not enrolled yet: 404', 'GET', '/courses/{{courseId}}', { as: 'student1', expect: 404 });
for (const s of ['student1', 'student2', 'student3']) {
  r('Enrolment', `${s} joins with the code`, 'POST', '/courses/join', { as: s, body: { joinCode: '{{joinCode}}' }, expect: 200 });
}
r('Enrolment', 'Join twice: 409 ALREADY_ENROLLED', 'POST', '/courses/join', { as: 'student1', body: { joinCode: '{{joinCode}}' }, expect: 409, code: 'ALREADY_ENROLLED' });
r('Enrolment', 'Unknown code: 404 INVALID_JOIN_CODE', 'POST', '/courses/join', { as: 'student2', body: { joinCode: 'ZZZZZZZZ' }, expect: 404, code: 'INVALID_JOIN_CODE' });
r('Courses', 'My courses', 'GET', '/courses', { as: 'student1', expect: 200, tests: [`pm.expect(json.courses.length).to.eql(1);`] });
r('Courses', 'Get a course (student: no join code)', 'GET', '/courses/{{courseId}}', { as: 'student1', expect: 200, tests: [`pm.expect(json).to.not.have.property('joinCode');`] });
r('Courses', 'Edit a course', 'PATCH', '/courses/{{courseId}}', { as: 'lecturer', body: { title: 'Mini project (CST)' }, expect: 200 });
r('Courses', 'Another lecturer cannot edit it: 404', 'PATCH', '/courses/{{courseId}}', { as: 'lecturer2', body: { title: 'x y' }, expect: 404 });
r('Enrolment', 'New join code', 'POST', '/courses/{{courseId}}/join-code', { as: 'lecturer', expect: 200, save: { joinCode: 'json.joinCode' } });
r('Enrolment', 'Members', 'GET', '/courses/{{courseId}}/members', { as: 'lecturer', expect: 200, tests: [`pm.expect(json.members.length).to.eql(4);`] });
r('Enrolment', 'Remove a student', 'DELETE', '/courses/{{courseId}}/members/{{uid_student3}}', { as: 'lecturer', expect: 204 });
r('Enrolment', 'They join again with the new code', 'POST', '/courses/join', { as: 'student3', body: { joinCode: '{{joinCode}}' }, expect: 200 });

// ── Announcements ──
r('Announcements', 'Post an announcement', 'POST', '/courses/{{courseId}}/announcements', { as: 'lecturer', body: { title: 'Welcome', body: 'Groups next week.', pinned: true }, expect: 201, save: { announcementId: 'json.id' } });
r('Announcements', 'Students cannot post: 403', 'POST', '/courses/{{courseId}}/announcements', { as: 'student1', body: { title: 'x', body: 'y' }, expect: 403 });
r('Announcements', 'List announcements', 'GET', '/courses/{{courseId}}/announcements', { as: 'student1', expect: 200 });
r('Announcements', 'Edit an announcement', 'PATCH', '/announcements/{{announcementId}}', { as: 'lecturer', body: { pinned: false }, expect: 200 });
r('Announcements', 'Delete an announcement', 'DELETE', '/announcements/{{announcementId}}', { as: 'lecturer', expect: 204 });

// ── Assignments ──
r('Assignments', 'Create an assignment (default weights)', 'POST', '/courses/{{courseId}}/assignments', {
  as: 'lecturer', pre: inAWeek, body: { title: 'Group report', brief: 'Write 2,000 words.', deadline: '{{deadline}}', timeCapMinutes: 60 }, expect: 201,
  save: { assignmentId: 'json.id' }, tests: [`pm.expect(json.weights).to.eql({ time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });`],
});
r('Assignments', 'Weights must add up to 1.00: 400', 'POST', '/courses/{{courseId}}/assignments', {
  as: 'lecturer', body: { title: 'Essay', brief: 'x', deadline: '{{deadline}}', weights: { time: 0.5, edits: 0.5, writing: 0.5, tasks: 0 } }, expect: 400, code: 'INVALID_BODY',
});
r('Assignments', 'A spare assignment', 'POST', '/courses/{{courseId}}/assignments', { as: 'lecturer', body: { title: 'Spare', brief: 'x', deadline: '{{deadline}}' }, expect: 201, save: { spareAssignmentId: 'json.id' } });
r('Assignments', 'List assignments', 'GET', '/courses/{{courseId}}/assignments', { as: 'student1', expect: 200 });
r('Assignments', 'Get an assignment', 'GET', '/assignments/{{assignmentId}}', { as: 'student1', expect: 200 });
r('Assignments', 'Edit an assignment', 'PATCH', '/assignments/{{assignmentId}}', { as: 'lecturer', body: { brief: 'Write 2,500 words.' }, expect: 200 });
r('Assignments', 'Delete an assignment', 'DELETE', '/assignments/{{spareAssignmentId}}', { as: 'lecturer', expect: 204 });

// ── Groups ──
r('Groups', 'Create a group', 'POST', '/assignments/{{assignmentId}}/groups', {
  as: 'lecturer', body: { name: 'Team Druk', memberIds: ['{{uid_student1}}', '{{uid_student2}}'] }, expect: 201, save: { workspaceId: 'json.id' },
});
r('Groups', 'A student in two groups: 409 ALREADY_IN_GROUP', 'POST', '/assignments/{{assignmentId}}/groups', {
  as: 'lecturer', body: { name: 'Team Two', memberIds: ['{{uid_student1}}'] }, expect: 409, code: 'ALREADY_IN_GROUP',
});
r('Groups', 'List groups', 'GET', '/assignments/{{assignmentId}}/groups', { as: 'lecturer', expect: 200 });
r('Groups', 'My workspaces', 'GET', '/me/workspaces', { as: 'student1', expect: 200, tests: [`pm.expect(json.workspaces.length).to.eql(1);`] });
r('Groups', 'Get a workspace', 'GET', '/workspaces/{{workspaceId}}', { as: 'student1', expect: 200 });
r('Groups', 'Not a member: 404', 'GET', '/workspaces/{{workspaceId}}', { as: 'student3', expect: 404 });
r('Groups', 'Rename a workspace', 'PATCH', '/workspaces/{{workspaceId}}', { as: 'lecturer', body: { name: 'Team Druk Gyalpo' }, expect: 200 });
r('Groups', 'Add a member', 'POST', '/workspaces/{{workspaceId}}/members', { as: 'lecturer', body: { userId: '{{uid_student3}}' }, expect: 200 });
r('Groups', 'Remove a member', 'DELETE', '/workspaces/{{workspaceId}}/members/{{uid_student3}}', { as: 'lecturer', expect: 204 });
r('Extensions', 'Extend the group deadline', 'POST', '/groups/{{workspaceId}}/extension', {
  as: 'lecturer', pre: inTwoWeeks, body: { deadline: '{{extendedDeadline}}', reason: 'Field trip clashed with the deadline' }, expect: 200,
});

// ── Tasks ──
r('Tasks', 'Add a task', 'POST', '/workspaces/{{workspaceId}}/tasks', { as: 'student1', body: { title: 'Write the introduction', ownerId: '{{uid_student1}}' }, expect: 201, save: { taskId: 'json.id' } });
r('Tasks', 'A spare task', 'POST', '/workspaces/{{workspaceId}}/tasks', { as: 'student2', body: { title: 'Temporary' }, expect: 201, save: { spareTaskId: 'json.id' } });
r('Tasks', 'List tasks', 'GET', '/workspaces/{{workspaceId}}/tasks', { as: 'student2', expect: 200 });
r('Tasks', 'Tick a task done', 'PATCH', '/tasks/{{taskId}}', { as: 'student1', body: { done: true }, expect: 200, tests: [`pm.expect(json.doneAt).to.be.a('string');`] });
r('Tasks', 'Delete a task', 'DELETE', '/tasks/{{spareTaskId}}', { as: 'student2', expect: 204 });
r('Tasks', 'Lecturers wait for submission: 409', 'GET', '/workspaces/{{workspaceId}}/tasks', { as: 'lecturer', expect: 409, code: 'NOT_SUBMITTED' });

// ── Tracking and submission ──
r('Submissions', 'Tracking events (text is rejected)', 'POST', '/workspaces/{{workspaceId}}/events', {
  as: 'student1',
  body: { events: [{ kind: 'metric', at: 1798000000000, payload: { timeSpent: 3, edits: 12 } }, { kind: 'paste', at: 1798000000000, payload: { fileId: 'f1', length: 3, changeType: 'paste-small', contentSnippet: 'abc' } }] },
  expect: 200, tests: [`pm.expect(json).to.eql({ accepted: 1, rejected: 1 });`],
});
// In CI the editor isn't running, so the submitted file is written straight into the Firestore
// emulator. Skipped when firestoreEmulator is empty (a real server: create the file in the app).
const fsDoc = (name, docPath, fields) =>
  r('Submissions', name, 'POST', `{{firestoreEmulator}}/v1/projects/{{firebaseProjectId}}/databases/(default)/documents/${docPath}`, {
    absolute: true, as: null, headers: { Authorization: 'Bearer owner' }, body: { fields }, expect: 200, skipUnless: 'firestoreEmulator',
  });
fsDoc('Emulator only: the file', 'groups/{{workspaceId}}/files?documentId=f1', { name: { stringValue: 'Report' } });
fsDoc('Emulator only: its text', 'documents?documentId=f1', {
  text: { stringValue: 'Bhutan measures progress with Gross National Happiness. The index covers nine domains. Critics say the survey is long.' },
});
r('Submissions', 'Submit', 'POST', '/workspaces/{{workspaceId}}/submission', {
  as: 'student1', body: { fileId: 'f1' }, expect: 201, save: { submissionId: 'json.submission.id' },
  tests: [`pm.expect(json.analysis.notice).to.match(/signal, not proof/);`],
});
r('Submissions', 'Submit twice: 409 ALREADY_SUBMITTED', 'POST', '/workspaces/{{workspaceId}}/submission', { as: 'student2', body: { fileId: 'f1' }, expect: 409, code: 'ALREADY_SUBMITTED' });
r('Submissions', 'Get the submission', 'GET', '/workspaces/{{workspaceId}}/submission', { as: 'lecturer', expect: 200 });
r('Analysis', 'Get the analysis', 'GET', '/submissions/{{submissionId}}/analysis', { as: 'student1', expect: 200 });
r('Analysis', 'Re-run the analysis', 'POST', '/submissions/{{submissionId}}/analysis', { as: 'lecturer', body: { provider: 'legacy' }, expect: 201 });

// ── Grades ──
r('Grades', 'Workspace grades', 'GET', '/workspaces/{{workspaceId}}/grades', {
  as: 'lecturer', expect: 200, save: { gradeId: 'json.grades[0].id' }, tests: [`pm.expect(json.grades.length).to.eql(2);`],
});
r('Grades', 'Student overrides: 403', 'POST', '/grades/{{gradeId}}/overrides', { as: 'student1', body: { grade: 10, reason: 'Please' }, expect: 403 });
r('Grades', 'Override a grade', 'POST', '/grades/{{gradeId}}/overrides', { as: 'lecturer', body: { grade: 7.5, reason: 'Viva showed good understanding' }, expect: 201 });
r('Grades', 'Override history', 'GET', '/grades/{{gradeId}}/overrides', { as: 'lecturer', expect: 200, tests: [`pm.expect(json.overrides[0].newGrade).to.eql(7.5);`] });
r('Grades', 'Course grades', 'GET', '/courses/{{courseId}}/grades', { as: 'student1', expect: 200 });
r('Grades', 'Grades as CSV', 'GET', '/courses/{{courseId}}/grades.csv', {
  as: 'lecturer', expect: 200, json: false, tests: [`pm.expect(pm.response.headers.get('Content-Type')).to.match(/text\\/csv/);`, `pm.expect(pm.response.text()).to.match(/^course_code,assignment,group,/);`],
});
r('Grades', 'Tasks are readable after submission', 'GET', '/workspaces/{{workspaceId}}/tasks', { as: 'lecturer', expect: 200 });

// ── Peer evaluation (needs peer_eval_enabled on; CI turns it on) ──
r('Peer evaluation', 'Rate your teammate', 'PUT', '/workspaces/{{workspaceId}}/peer-evaluations', {
  as: 'student1', body: { ratings: [{ rateeId: '{{uid_student2}}', rating: 4, comment: 'Found the best sources.' }] }, expect: 200,
});
r('Peer evaluation', 'Rating yourself: 400', 'PUT', '/workspaces/{{workspaceId}}/peer-evaluations', {
  as: 'student2', body: { ratings: [{ rateeId: '{{uid_student2}}', rating: 5 }] }, expect: 400, code: 'INVALID_BODY',
});
r('Peer evaluation', 'Ratings I gave', 'GET', '/workspaces/{{workspaceId}}/peer-evaluations', { as: 'student1', expect: 200, tests: [`pm.expect(json.ratings.length).to.eql(1);`] });
r('Peer evaluation', 'Lecturer sees averages, not raters', 'GET', '/workspaces/{{workspaceId}}/peer-evaluations', {
  as: 'lecturer', expect: 200, tests: [`pm.expect(JSON.stringify(json)).to.not.include('rater');`],
});

// ── Random groups (a fresh assignment, so all three students are ungrouped) ──
r('Random groups', 'An assignment to group', 'POST', '/courses/{{courseId}}/assignments', { as: 'lecturer', body: { title: 'Pair work', brief: 'x', deadline: '{{deadline}}' }, expect: 201, save: { autoAssignmentId: 'json.id' } });
r('Random groups', 'Shuffle students into groups', 'POST', '/assignments/{{autoAssignmentId}}/groups/auto', {
  as: 'lecturer', body: { size: 2 }, expect: 201, tests: [`pm.expect(json.groups.reduce((n, g) => n + g.members.length, 0)).to.eql(3);`],
});
r('Random groups', 'Nobody left: 409 NOT_ENOUGH_STUDENTS', 'POST', '/assignments/{{autoAssignmentId}}/groups/auto', { as: 'lecturer', body: { size: 2 }, expect: 409, code: 'NOT_ENOUGH_STUDENTS' });

// ── Course comparison (needs course_dashboard_enabled on; CI turns it on) ──
r('Comparison', 'Compare the groups in a course', 'GET', '/courses/{{courseId}}/comparison', {
  as: 'lecturer', expect: 200, tests: [`pm.expect(json.groups.length).to.be.above(0);`, `pm.expect(json.groups[0].contributionGini).to.be.within(0, 1);`],
});
r('Comparison', 'Students cannot see it: 403', 'GET', '/courses/{{courseId}}/comparison', { as: 'student1', expect: 403 });

// ── Reports ──
r('Reports', 'Report as XML', 'GET', '/workspaces/{{workspaceId}}/report.xml', {
  as: 'lecturer', expect: 200, json: false, tests: [`pm.expect(pm.response.text()).to.include('<?xml-stylesheet type="text/xsl"');`],
});
r('Reports', 'The XSL stylesheet (no token)', 'GET', '/reports/report.xsl', { as: null, expect: 200, json: false });

// ── Legacy ──
r('Legacy', 'Old /check', 'POST', '/check', { as: null, body: { text: 'A long enough piece of text to analyse here.' }, expect: 200 });
r('Legacy', 'Old /analyze', 'POST', '/analyze', { as: null, body: { text: 'A long enough piece of text to analyse here.' }, expect: 200 });

// ── In the contract, not built yet: 404 until their step lands. When one is built this
// request fails, which is the reminder to move it up and give it real checks. ──
const notYet = (name, method, path, as, body) => r('Not built yet', `${name} (404 until built)`, method, path, { as, body, expect: 404 });
notYet('Usage (3.10)', 'GET', '/usage', 'superAdmin');
notYet('Delete my data (4.9)', 'DELETE', '/me/data', 'spare', { confirm: 'DELETE' });
notYet('Delete a user’s data (4.9)', 'DELETE', '/admin/users/{{uid_spare}}/data', 'superAdmin', { confirm: 'DELETE' });
notYet('Inline comments (4.6)', 'GET', '/workspaces/{{workspaceId}}/comments?fileId=f1', 'lecturer');
notYet('Add a comment (4.6)', 'POST', '/workspaces/{{workspaceId}}/comments', 'lecturer', { fileId: 'f1', quote: { exact: 'Gross National Happiness' }, comment: 'Cite the source.' });
notYet('Edit a comment (4.6)', 'PATCH', '/workspaces/{{workspaceId}}/comments/c1', 'lecturer', { comment: 'x' });
notYet('Delete a comment (4.6)', 'DELETE', '/workspaces/{{workspaceId}}/comments/c1', 'lecturer');

// ── OAuth practical: Google sign-in -> Firebase ID token (run by hand in Postman) ──
// 1. In "Google ID token", open Authorization > Get New Access Token. Postman runs Google's
//    OAuth 2.0 authorization-code flow with PKCE (scope openid email profile) and gets an
//    id_token. Copy it into the googleIdToken environment variable.
// 2. "Exchange for a Firebase ID token" sends it to Firebase Auth, which returns the Firebase
//    ID token this API accepts; the test saves it as token_google.
// 3. "Me with the Google account" calls the API with it.
// All three are skipped when googleIdToken is empty (as in CI).
r('OAuth practical', 'Google ID token (Authorization tab: Get New Access Token)', 'GET', 'https://openidconnect.googleapis.com/v1/userinfo', {
  absolute: true, as: null, expect: 200, skipUnless: 'googleIdToken', json: false,
  auth: {
    type: 'oauth2',
    oauth2: [
      { key: 'grant_type', value: 'authorization_code_with_pkce', type: 'string' },
      { key: 'authUrl', value: 'https://accounts.google.com/o/oauth2/v2/auth', type: 'string' },
      { key: 'accessTokenUrl', value: 'https://oauth2.googleapis.com/token', type: 'string' },
      { key: 'clientId', value: '{{googleClientId}}', type: 'string' },
      { key: 'clientSecret', value: '{{googleClientSecret}}', type: 'string' },
      { key: 'scope', value: 'openid email profile', type: 'string' },
      { key: 'useBrowser', value: true, type: 'boolean' },
      { key: 'tokenName', value: 'Google', type: 'string' },
      { key: 'addTokenTo', value: 'header', type: 'string' },
    ],
  },
});
r('OAuth practical', 'Exchange for a Firebase ID token', 'POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={{firebaseWebApiKey}}', {
  absolute: true, as: null, skipUnless: 'googleIdToken', expect: 200,
  body: { postBody: 'id_token={{googleIdToken}}&providerId=google.com', requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true },
  tests: [`pm.environment.set('token_google', json.idToken);`],
});
r('OAuth practical', 'Me with the Google account', 'GET', '/auth/me', { as: 'google', skipUnless: 'googleIdToken', expect: 200 });

// ── Build ──
const lines = (s) => s.split('\n');

function item(req) {
  const exec = [`pm.test('${req.method} ${req.path.replace(/'/g, "\\'")} -> ${req.expect}', function () { pm.response.to.have.status(${req.expect}); });`];
  if (req.json !== false && req.expect !== 204) exec.push(`let json = {}; try { json = pm.response.json(); } catch (e) {}`);
  if (req.code) exec.push(`pm.test('code ${req.code}', function () { pm.expect(json.code).to.eql('${req.code}'); });`);
  if (req.tests?.length) exec.push(`pm.test('${req.name.replace(/'/g, "\\'")}', function () {`, ...req.tests.map((t) => `  ${t}`), `});`);
  for (const [name, expr] of Object.entries(req.save || {})) {
    exec.push(`if (pm.response.code === ${req.expect}) pm.collectionVariables.set('${name}', ${expr});`);
  }
  const pre = [];
  if (req.skipUnless) pre.push(`if (!pm.variables.get('${req.skipUnless}')) { pm.execution.skipRequest(); }`);
  if (req.pre) pre.push(...lines(req.pre));

  const header = [];
  if (req.as) header.push({ key: 'Authorization', value: `Bearer {{token_${req.as}}}` });
  for (const [key, value] of Object.entries(req.headers || {})) header.push({ key, value });
  if (req.body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });

  return {
    name: req.name,
    event: [
      ...(pre.length ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec } },
    ],
    request: {
      method: req.method,
      header,
      ...(req.auth ? { auth: req.auth } : { auth: { type: 'noauth' } }),
      ...(req.body !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(req.body, null, 2), options: { raw: { language: 'json' } } } } : {}),
      url: req.absolute ? req.path : `{{baseUrl}}/api${req.path}`,
      description: req.absolute ? undefined : `${req.method} /api${req.path}`,
    },
  };
}

const folders = [];
for (const req of requests) {
  let folder = folders.find((f) => f.name === req.folder);
  if (!folder) folders.push((folder = { name: req.folder, item: [] }));
  folder.item.push(item(req));
}

const collection = {
  info: {
    name: 'Peerlytics API',
    description:
      'Every route in backend/openapi.yaml, in an order that runs end to end (step 3.3). Generated by postman/build-collection.mjs; edit that file, not this one. ' +
      'Set the environment (postman/peerlytics.postman_environment.json) first. AI likelihood is a signal, not proof.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders,
  variable: ['autoAssignmentId', 'courseId', 'joinCode', 'announcementId', 'assignmentId', 'spareAssignmentId', 'deadline', 'extendedDeadline', 'workspaceId', 'taskId', 'spareTaskId', 'submissionId', 'gradeId'].map(
    (key) => ({ key, value: '' })
  ),
};

const out = new URL('./peerlytics.postman_collection.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Wrote ${requests.length} requests in ${folders.length} folders to postman/peerlytics.postman_collection.json`);
