// Database rows -> the response shapes in backend/openapi.yaml (camelCase, ISO times,
// numbers instead of numeric strings). Emails are only included for staff.

export const iso = (d) => (d == null ? null : new Date(d).toISOString());
const num = (v) => (v == null ? null : Number(v));

export function userRef(row, { withEmail }) {
  const ref = { id: row.id, displayName: row.display_name };
  if (withEmail && row.email) ref.email = row.email;
  return ref;
}

export function courseSummary(row, courseRole) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    term: row.term,
    courseRole: courseRole ?? null,
    archived: row.archived_at != null,
  };
}

export function course(row, { courseRole, staff }) {
  const out = {
    ...courseSummary(row, courseRole),
    description: row.description,
    collegeId: row.college_id,
    ownerId: row.owner_id,
    joinCodeEnabled: row.join_code_enabled,
    studentCount: Number(row.student_count ?? 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (staff) out.joinCode = row.join_code;
  return out;
}

export function announcement(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    author: { id: row.author_id, displayName: row.author_name },
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export const weightsOf = (row) => ({
  time: num(row.weight_time),
  edits: num(row.weight_edits),
  writing: num(row.weight_writing),
  tasks: num(row.weight_tasks),
});

export function assignment(row) {
  const out = {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    brief: row.brief,
    deadline: iso(row.deadline),
    weights: weightsOf(row),
    timeCapMinutes: row.time_cap_minutes,
    groupSize: row.group_size,
    groupCount: Number(row.group_count ?? 0),
    submittedCount: Number(row.submitted_count ?? 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if ('my_workspace_id' in row) {
    out.myWorkspaceId = row.my_workspace_id;
    out.effectiveDeadline = iso(row.my_effective_deadline ?? row.deadline);
  }
  return out;
}

/** row: a workspaces row joined with course_id, deadline, effective_deadline, submitted_at; members: user rows. */
export function workspace(row, members, { withEmail }) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    courseId: row.course_id,
    name: row.name,
    status: row.status,
    createdVia: row.created_via,
    members: members.map((m) => userRef(m, { withEmail })),
    deadline: iso(row.deadline),
    effectiveDeadline: iso(row.effective_deadline ?? row.deadline),
    submittedAt: iso(row.submitted_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function grade(row, { withEmail }) {
  const suggested = num(row.suggested);
  const overridden = row.override_grade != null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    assignmentId: row.assignment_id,
    student: userRef({ id: row.user_id, display_name: row.display_name, email: row.email }, { withEmail }),
    analysisResultId: row.analysis_result_id,
    scores: {
      time: num(row.time_score),
      edits: num(row.edits_score),
      writing: num(row.writing_score),
      tasks: num(row.tasks_score),
    },
    weights: row.weights,
    deductions: row.deductions,
    suggested,
    final: overridden ? num(row.override_grade) : suggested,
    overridden,
    explanation: row.explanation,
    computedAt: iso(row.computed_at),
  };
}
