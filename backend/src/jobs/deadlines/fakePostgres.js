// In-memory stand-in for the deadline store in postgres.js. Unit tests only;
// deadlines.pg.itest.js runs the real SQL against PostgreSQL.

/**
 * `workspaces`: { id: { status, deadlineMs, extensions: [ms...] (oldest first), memberIds } }.
 * `failNextLock`: make the next lockAtDeadline throw, as a lost connection would.
 */
export function fakePostgres(workspaces = {}) {
  const rows = new Map(Object.entries(structuredClone(workspaces)).map(([id, w]) => [id, { extensions: [], memberIds: [], ...w }]));
  const submissions = new Map(); // workspaceId -> row
  const auditLog = [];
  const effective = (w) => w.extensions.at(-1) ?? w.deadlineMs;
  let ids = 0;

  return {
    rows,
    submissions,
    auditLog,
    failNextLock: null,

    async knownWorkspaceIds(groupIds) {
      return new Set(groupIds.filter((id) => rows.has(id)));
    },

    async dueWorkspaces(nowMs) {
      return [...rows.entries()]
        .filter(([, w]) => w.status === 'open' && effective(w) <= nowMs)
        .sort(([a, wa], [b, wb]) => effective(wa) - effective(wb) || a.localeCompare(b))
        .map(([id, w]) => ({ id, deadlineMs: effective(w), extended: w.extensions.length > 0, memberIds: [...w.memberIds].sort() }));
    },

    async lockAtDeadline({ workspaceId, nowMs, deadlineMs, extended, submission }) {
      if (this.failNextLock) {
        const err = this.failNextLock;
        this.failNextLock = null;
        throw err;
      }
      const w = rows.get(workspaceId);
      if (w?.status !== 'open') return { status: 'skipped', reason: w?.status ?? 'missing' };
      let submissionId = null;
      if (submission && !submissions.has(workspaceId)) {
        submissionId = `sub${(ids += 1)}`;
        submissions.set(workspaceId, { id: submissionId, submittedBy: null, trigger: 'deadline', submittedAtMs: nowMs, ...structuredClone(submission) });
      }
      w.status = 'locked';
      auditLog.push({
        actorId: null,
        action: 'workspace.locked',
        targetType: 'workspace',
        targetId: workspaceId,
        details: { trigger: 'deadline', deadline: new Date(deadlineMs).toISOString(), extended, submissionId, documentRef: submission?.documentRef ?? null },
      });
      return { status: 'locked', submissionId };
    },
  };
}
