import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_API_METHODS, isCourseApiReady } from '../courses/courseApi.js';
import { createCourseApi } from './courseEndpoints.js';

const COURSE_ID = 'c1';
const responses = {
  'GET /api/courses': { courses: [{ id: COURSE_ID, code: 'CTE412', title: 'DevOps', ownerName: 'Pema', courseRole: 'student' }] },
  'POST /api/courses': { id: COURSE_ID, code: 'CTE412', title: 'DevOps', joinCode: 'ABCD2345' },
  'POST /api/courses/join': { id: COURSE_ID, code: 'CTE412', title: 'DevOps', courseRole: 'student' },
  'GET /api/courses/c1': { id: COURSE_ID, code: 'CTE412', title: 'DevOps', description: 'About', joinCode: 'ABCD2345' },
  'GET /api/courses/c1/members': {
    members: [
      { id: 'lect-1', displayName: 'Pema', courseRole: 'lecturer' },
      { id: 'stu-1', displayName: 'Dorji', courseRole: 'student' },
    ],
  },
  'GET /api/courses/c1/announcements': {
    announcements: [{ id: 'n1', title: 'Hi', body: 'Hi all', author: { displayName: 'Pema' }, createdAt: '2026-01-01T00:00:00.000Z' }],
  },
  'GET /api/courses/c1/assignments': {
    assignments: [{ id: 'a1', title: 'Report', deadline: '2026-02-01T00:00:00.000Z', weights: { time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 } }],
  },
  'GET /api/courses/c1/grades': { grades: [{ id: 'g1', assignmentId: 'a1', student: { displayName: 'Dorji' }, final: 8.5 }] },
  'GET /api/assignments/a1/groups': { groups: [{ id: 'w1', name: 'Team 1', members: [{}, {}] }], ungroupedStudents: [] },
  'POST /api/courses/c1/announcements': { id: 'n2', body: 'x', author: { displayName: 'Pema' }, createdAt: '2026-01-01T00:00:00.000Z' },
  'POST /api/courses/c1/assignments': { id: 'a2', title: 'Essay', weights: { time: 1, edits: 0, writing: 0, tasks: 0 } },
};

function stubClient() {
  const calls = [];
  return {
    calls,
    request: async (url, { method = 'GET', body } = {}) => {
      calls.push({ method, url, body });
      const answer = responses[`${method} ${url}`];
      if (!answer) throw new Error(`No stub for ${method} ${url}`);
      return answer;
    },
  };
}

test('it provides every method the course site needs, which turns the Courses tab on', () => {
  const api = createCourseApi(stubClient());
  assert.equal(isCourseApiReady(api), true);
  assert.deepEqual(COURSE_API_METHODS.filter((name) => typeof api[name] !== 'function'), []);
});

test('listMyCourses shows the lecturer from the list', async () => {
  const [course] = await createCourseApi(stubClient()).listMyCourses();
  assert.equal(course.lecturerName, 'Pema');
});

test('joinCourse sends the code and returns the course with its lecturer', async () => {
  const client = stubClient();
  const course = await createCourseApi(client).joinCourse('ABCD2345');
  assert.deepEqual(client.calls[0], { method: 'POST', url: '/api/courses/join', body: { joinCode: 'ABCD2345' } });
  assert.equal(course.lecturerName, 'Pema');
});

test('createCourse sends the form and keeps the join code', async () => {
  const client = stubClient();
  const course = await createCourseApi(client).createCourse({ code: 'CTE412', title: 'DevOps', description: null });
  assert.equal(client.calls[0].url, '/api/courses');
  assert.equal(course.joinCode, 'ABCD2345');
  assert.equal(course.lecturerName, 'Pema');
});

test('getCourse maps every tab onto the shapes the screens render', async () => {
  const course = await createCourseApi(stubClient()).getCourse(COURSE_ID);
  assert.equal(course.lecturerName, 'Pema');
  assert.equal(course.joinCode, 'ABCD2345');
  assert.deepEqual(course.members[1], { uid: 'stu-1', name: 'Dorji', role: 'student' });
  assert.deepEqual(course.announcements[0], { id: 'n1', body: 'Hi all', authorName: 'Pema', createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(course.assignments[0].rubric.time, 0.25);
  assert.deepEqual(course.groups, [{ id: 'w1', name: 'Team 1', memberCount: 2 }]);
  assert.deepEqual(course.grades, [{ id: 'g1', studentName: 'Dorji', assignmentTitle: 'Report', grade: 8.5 }]);
});

test('an announcement gets its title from the first line, cut to the API limit', async () => {
  const client = stubClient();
  const api = createCourseApi(client);
  await api.postAnnouncement(COURSE_ID, { body: ' First line \nMore' });
  assert.deepEqual(client.calls[0].body, { title: 'First line', body: ' First line \nMore' });
  await api.postAnnouncement(COURSE_ID, { body: 'x'.repeat(250) });
  assert.equal(client.calls[1].body.title.length, 200);
});

test('createAssignment sends the rubric as weights, and the title as a stand-in brief', async () => {
  const client = stubClient();
  const rubric = { time: 1, edits: 0, writing: 0, tasks: 0 };
  const created = await createCourseApi(client).createAssignment(COURSE_ID, { title: 'Essay', deadline: '2026-03-01T00:00:00.000Z', rubric });
  assert.deepEqual(client.calls[0].body, { title: 'Essay', brief: 'Essay', deadline: '2026-03-01T00:00:00.000Z', weights: rubric });
  assert.deepEqual(created.rubric, rubric);
});

test('a course id is escaped in the path', async () => {
  const client = stubClient();
  await assert.rejects(createCourseApi(client).postAnnouncement('a/b', { body: 'x' }));
  assert.equal(client.calls[0].url, '/api/courses/a%2Fb/announcements');
});
