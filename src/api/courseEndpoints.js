// The course site's API (src/courses/courseApi.js) on top of the routes in backend/openapi.yaml.
// Maps the API's responses onto the shapes the screens render. No Firebase imports, so it can be
// tested with a stubbed client.

const ANNOUNCEMENT_TITLE_MAX = 200;

const path = (...parts) => `/api/${parts.map(encodeURIComponent).join('/')}`;

const toMember = (m) => ({ uid: m.id, name: m.displayName, role: m.courseRole });

const toCourse = (c, lecturerName = c.ownerName ?? null) => ({ ...c, lecturerName });

const lecturerOf = (members) => members.find((m) => m.role === 'lecturer')?.name ?? null;

const toAnnouncement = (a) => ({ id: a.id, body: a.body, authorName: a.author?.displayName, createdAt: a.createdAt });

const toAssignment = (a) => ({ ...a, rubric: a.weights });

const toGroup = (g) => ({ id: g.id, name: g.name, memberCount: g.members?.length ?? 0 });

const toGrade = (g, titles) => ({
  id: g.id,
  studentName: g.student?.displayName,
  assignmentTitle: titles[g.assignmentId],
  grade: g.final,
});

/** The form has one box; the API also wants a title, so use its first line. */
function announcementBody({ body }) {
  const firstLine = body.split('\n')[0].trim();
  return { title: firstLine.slice(0, ANNOUNCEMENT_TITLE_MAX), body };
}

export function createCourseApi(client) {
  const get = (url) => client.request(url);
  const post = (url, body) => client.request(url, { method: 'POST', body });

  const loadMembers = async (courseId) => {
    const { members } = await get(path('courses', courseId, 'members'));
    return members.map(toMember);
  };

  /** Join and create answer without the lecturer's name, which the course list shows. */
  const withLecturer = async (course) => toCourse(course, lecturerOf(await loadMembers(course.id)));

  return {
    async listMyCourses() {
      const { courses } = await get('/api/courses');
      return courses.map((c) => toCourse(c));
    },

    joinCourse: async (joinCode) => withLecturer(await post('/api/courses/join', { joinCode })),

    createCourse: async (body) => withLecturer(await post('/api/courses', body)),

    async getCourse(courseId) {
      const [course, members, { announcements }, { assignments }, { grades }] = await Promise.all([
        get(path('courses', courseId)),
        loadMembers(courseId),
        get(path('courses', courseId, 'announcements')),
        get(path('courses', courseId, 'assignments')),
        get(path('courses', courseId, 'grades')),
      ]);
      const groupLists = await Promise.all(assignments.map((a) => get(path('assignments', a.id, 'groups'))));
      const titles = Object.fromEntries(assignments.map((a) => [a.id, a.title]));
      return {
        ...toCourse(course, lecturerOf(members)),
        members,
        announcements: announcements.map(toAnnouncement),
        assignments: assignments.map(toAssignment),
        groups: groupLists.flatMap((list) => list.groups.map(toGroup)),
        grades: grades.map((g) => toGrade(g, titles)),
      };
    },

    postAnnouncement: async (courseId, body) =>
      toAnnouncement(await post(path('courses', courseId, 'announcements'), announcementBody(body))),

    /** The form has no brief yet, and the API requires one, so the title stands in. */
    createAssignment: async (courseId, { title, deadline, rubric, brief }) =>
      toAssignment(await post(path('courses', courseId, 'assignments'), { title, brief: brief || title, deadline, weights: rubric })),
  };
}
