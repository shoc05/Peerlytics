// What the course site (step 1.7) needs from the backend. The backend has no course routes
// yet: they come with step 2.1 (courses API and backend/openapi.yaml). Until then the app
// passes `courseApi = null` from src/api/index.js and the Courses tab says "Not available yet".
//
// Step 2.6 builds an object with these methods on top of the real routes in
// src/api/endpoints.js and exports it as `courseApi`. That is the only change needed to
// switch the course site on. Each method returns a promise and throws ApiError on failure.
//
//   listMyCourses()                         -> Course[]       courses the user is enrolled in or teaches
//   joinCourse(joinCode)                    -> Course         student joins with a join code
//   getCourse(courseId)                     -> CourseDetail
//   createCourse({ code, title, description })       -> Course
//   postAnnouncement(courseId, { body })             -> Announcement
//   createAssignment(courseId, { title, deadline, rubric }) -> Assignment
//       deadline: ISO string; rubric: { time, edits, writing, tasks } fractions summing to 1
//
// Shapes the screens render (2.6 maps the API's responses onto these):
//   Course        { id, code, title, lecturerName }
//   CourseDetail  Course + { description, announcements[], assignments[], groups[], members[], grades[] }
//   Announcement  { id, body, authorName, createdAt }
//   Assignment    { id, title, deadline, rubric }
//   Group         { id, name, memberCount }
//   Member        { uid, name, role }
//   Grade         { id, studentName, assignmentTitle, grade }   grade 0-10, or null if not graded

export const COURSE_API_METHODS = Object.freeze([
  'listMyCourses',
  'joinCourse',
  'getCourse',
  'createCourse',
  'postAnnouncement',
  'createAssignment',
]);

/** True only when `api` provides every method the course site calls. */
export function isCourseApiReady(api) {
  return api != null && COURSE_API_METHODS.every((name) => typeof api[name] === 'function');
}
