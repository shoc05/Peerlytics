// One course: header (code, title, lecturer) and the Projects, Overview, Groups, Members
// and Grades tabs. Only rendered when the course API is available (see ./courseApi.js).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../utils/workspaceHelpers';
import { COURSE_TABS, parseCourseTab, tabIndexAfterKey } from './tabs';
import { RUBRIC_CRITERIA } from './rubric';
import { errorKey, projectIsOpen } from './viewState';
import { AnnouncementForm, AssignmentForm, GroupForm } from './CourseForms';

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

function Empty({ ui, children }) {
  return <p className={`m-0 text-sm ${ui.sub}`}>{children}</p>;
}

function Overview({ course, t, ui, isLecturer, onPost }) {
  const announcements = course.announcements || [];
  return (
    <div className="grid gap-5">
      <section aria-labelledby="course-description" className={ui.card}>
        <h2 id="course-description" className="m-0 mb-2 text-base font-bold">{t('description')}</h2>
        {course.description
          ? <p className="m-0 text-sm whitespace-pre-wrap">{course.description}</p>
          : <Empty ui={ui}>{t('noDescription')}</Empty>}
      </section>
      <section aria-labelledby="course-announcements" className={ui.card}>
        <h2 id="course-announcements" className="m-0 mb-3 text-base font-bold">{t('announcements')}</h2>
        {isLecturer && <div className={`pb-4 mb-4 border-b ${ui.divider}`}><AnnouncementForm t={t} ui={ui} onSubmit={onPost} /></div>}
        {announcements.length === 0
          ? <Empty ui={ui}>{t('noAnnouncements')}</Empty>
          : (
            <ul className="m-0 p-0 list-none grid gap-3">
              {announcements.map((a) => (
                <li key={a.id} className={`border-l-4 border-l-brand-500 pl-3`}>
                  <p className="m-0 text-sm whitespace-pre-wrap">{a.body}</p>
                  <p className={`m-0 mt-1 text-xs ${ui.sub}`}>
                    {t('postedBy', { name: a.authorName || t('lecturer'), date: formatDateTime(a.createdAt) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function ProjectStatus({ project, t, ui }) {
  const open = projectIsOpen(project);
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${open ? ui.pill : ui.mutedPill}`}>
      {open ? t('projectOpen') : t('projectClosed')}
    </span>
  );
}

function Projects({ course, t, ui, isLecturer, onCreate, onOpenWorkspace }) {
  const projects = course.assignments || [];
  return (
    <div className="grid gap-5">
      {isLecturer && <section className={ui.card}><AssignmentForm t={t} ui={ui} onSubmit={onCreate} /></section>}
      <section className={ui.card} aria-label={t('tabProjects')}>
        {projects.length === 0
          ? <Empty ui={ui}>{t('noAssignments')}</Empty>
          : (
            <ul className="m-0 p-0 list-none grid gap-3">
              {projects.map((a) => {
                const mine = (a.groups || []).find((g) => g.id === a.myWorkspaceId);
                return (
                  <li key={a.id} className={`pb-3 border-b last:border-b-0 last:pb-0 ${ui.divider}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold">{a.title}</span>
                      <ProjectStatus project={a} t={t} ui={ui} />
                    </div>
                    <p className={`m-0 mt-1 text-xs ${ui.sub}`}>
                      {a.deadline ? t('due', { date: formatDateTime(a.effectiveDeadline ?? a.deadline) }) : t('noDeadline')}
                      {a.groupSize ? ` · ${t('groupsOf', { size: a.groupSize })}` : ''}
                    </p>
                    {isLecturer && (
                      <>
                        <p className={`m-0 mt-1 text-xs ${ui.sub}`}>
                          {t('groupsCount', { count: a.groupCount ?? 0 })} · {t('submittedCount', { done: a.submittedCount ?? 0, total: a.groupCount ?? 0 })}
                        </p>
                        {a.rubric && (
                          <p className={`m-0 mt-1 text-xs ${ui.sub}`}>
                            {RUBRIC_CRITERIA.map((k) => `${t(`criterion${capitalise(k)}`)} ${Math.round((a.rubric[k] ?? 0) * 100)}%`).join(' · ')}
                          </p>
                        )}
                      </>
                    )}
                    {!isLecturer && (a.myWorkspaceId
                      ? (
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          {mine && <span className={`text-xs ${ui.sub}`}>{t('yourGroup', { name: mine.name })}</span>}
                          <button type="button" className={ui.ghostBtn} onClick={() => onOpenWorkspace({ id: a.myWorkspaceId, name: mine?.name ?? a.title })}>
                            {projectIsOpen(a) ? t('openWorkspace') : t('viewWorkspace')}
                          </button>
                        </div>
                      )
                      : <p className={`m-0 mt-2 text-xs ${ui.sub}`}>{t('noGroupYet')}</p>)}
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </div>
  );
}

function Groups({ course, t, ui, isLecturer, onCreateGroup, onOpenWorkspace }) {
  const projects = course.assignments || [];
  if (projects.length === 0) {
    return <section className={ui.card}><Empty ui={ui}>{isLecturer ? t('noProjectsForGroups') : t('noGroups')}</Empty></section>;
  }
  return (
    <div className="grid gap-5">
      {projects.map((a) => (
        <section key={a.id} className={ui.card} aria-label={a.title}>
          <h3 className="m-0 mb-3 text-sm font-bold">{a.title}</h3>
          {(a.groups || []).length === 0
            ? <Empty ui={ui}>{isLecturer ? t('noGroups') : t('noGroupYet')}</Empty>
            : (
              <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {a.groups.map((g) => (
                  <li key={g.id} className={`border rounded-lg p-3 ${ui.divider}`}>
                    <div className="text-sm font-bold truncate">{g.name}</div>
                    <div className={`text-xs mt-1 ${ui.sub}`}>{g.memberNames.join(', ') || t('memberCount', { count: 0 })}</div>
                    {isLecturer && (
                      <div className="mt-2 grid gap-1.5 justify-items-start">
                        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${g.submitted ? ui.pill : ui.mutedPill}`}>
                          {g.submitted ? t('groupSubmitted') : t('groupNotSubmitted')}
                        </span>
                        {g.submitted
                          ? <button type="button" className={ui.ghostBtn} onClick={() => onOpenWorkspace({ id: g.id, name: g.name })}>{t('viewWorkspace')}</button>
                          : <span className={`text-xs ${ui.sub}`}>{t('groupWaitingForSubmission')}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          {isLecturer && (
            <div className={`mt-4 pt-4 border-t ${ui.divider}`}>
              <GroupForm t={t} ui={ui} students={a.ungroupedStudents} onSubmit={(body) => onCreateGroup(a.id, body)} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function JoinCodeCard({ code, t, ui, onCopy, onRegenerate }) {
  return (
    <section className={ui.card} aria-labelledby="join-code-heading">
      <h2 id="join-code-heading" className="m-0 mb-2 text-base font-bold">{t('joinCodeLabel')}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <strong data-testid="join-code" className="font-mono text-lg tracking-[0.15em]">{code}</strong>
        <button type="button" className={ui.ghostBtn} onClick={onCopy}>{t('copyJoinCode')}</button>
        <button type="button" className={ui.ghostBtn} onClick={onRegenerate}>{t('regenerateJoinCode')}</button>
      </div>
      <p className={`m-0 mt-2 text-xs ${ui.sub}`}>{t('joinCodeShareHelp')}</p>
    </section>
  );
}

function Members({ course, t, ui, onCopyCode, onRegenerateCode }) {
  const members = course.members || [];
  return (
    <div className="grid gap-5">
      {course.joinCode && <JoinCodeCard code={course.joinCode} t={t} ui={ui} onCopy={onCopyCode} onRegenerate={onRegenerateCode} />}
      <section className={ui.card} aria-label={t('tabMembers')}>
        {members.length === 0
          ? <Empty ui={ui}>{t('noMembers')}</Empty>
          : (
            <ul className="m-0 p-0 list-none grid gap-2">
              {members.map((m) => (
                <li key={m.uid} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{m.name}</span>
                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${ui.pill}`}>
                    {m.role === 'lecturer' ? t('roleLecturer') : t('roleStudent')}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function Grades({ course, t, ui }) {
  const grades = course.grades || [];
  if (grades.length === 0) return <section className={ui.card}><Empty ui={ui}>{t('noGrades')}</Empty></section>;
  const th = `text-left text-xs font-semibold py-2 pr-3 ${ui.sub}`;
  return (
    <section className={`${ui.card} overflow-x-auto`} aria-label={t('tabGrades')}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className={`border-b ${ui.divider}`}>
            <th scope="col" className={th}>{t('colStudent')}</th>
            <th scope="col" className={th}>{t('colAssignment')}</th>
            <th scope="col" className={`${th} text-right pr-0`}>{t('colGrade')}</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => (
            <tr key={g.id} className={`border-b last:border-b-0 ${ui.divider}`}>
              <td className="py-2 pr-3">{g.studentName}</td>
              <td className="py-2 pr-3">{g.assignmentTitle}</td>
              <td className="py-2 text-right tabular-nums">
                {typeof g.grade === 'number' ? t('gradeOutOf', { grade: g.grade.toFixed(1) }) : t('notGraded')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const PANELS = { projects: Projects, overview: Overview, groups: Groups, members: Members, grades: Grades };

export default function CoursePage({ api, courseId, t, ui, isLecturer, onBack, pushToast, onOpenWorkspace }) {
  const [course, setCourse] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(() => parseCourseTab());
  const tabRefs = useRef([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCourse(await api.getCourse(courseId));
    } catch (err) {
      setError(err);
    }
  }, [api, courseId]);

  useEffect(() => { load(); }, [load]);

  const onTabKey = (e) => {
    const next = tabIndexAfterKey(COURSE_TABS.indexOf(tab), e.key);
    if (next === null) return;
    e.preventDefault();
    setTab(COURSE_TABS[next]);
    tabRefs.current[next]?.focus();
  };

  const onPost = async (body) => {
    const announcement = await api.postAnnouncement(courseId, body);
    setCourse((c) => ({ ...c, announcements: [announcement, ...(c.announcements || [])] }));
    pushToast(t('posted'));
  };

  const onCreate = async (body) => {
    const assignment = await api.createAssignment(courseId, body);
    setCourse((c) => ({ ...c, assignments: [...(c.assignments || []), assignment] }));
    pushToast(t('assignmentCreated'));
  };

  const onCreateGroup = async (assignmentId, body) => {
    await api.createGroup(assignmentId, body);
    await load();
    pushToast(t('groupCreated'));
  };

  const onCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(course.joinCode);
      pushToast(t('joinCodeCopied'));
    } catch {
      pushToast(t('joinCodeCopyFailed'));
    }
  };

  const onRegenerateCode = async () => {
    if (!window.confirm(t('regenerateConfirm'))) return;
    try {
      const { joinCode } = await api.regenerateJoinCode(courseId);
      setCourse((c) => ({ ...c, joinCode }));
      pushToast(t('joinCodeRegenerated'));
    } catch (err) {
      pushToast(t(errorKey(err)));
    }
  };

  const backButton = (
    <button type="button" onClick={onBack} className={`${ui.ghostBtn} mb-4`}>
      <span aria-hidden="true">←</span> {t('back')}
    </button>
  );

  if (error) {
    return (
      <div className={`p-4 sm:p-8 overflow-auto ${ui.txt}`}>
        {backButton}
        <div role="alert" className={`${ui.card} grid gap-3`}>
          <p className={`m-0 text-sm font-medium ${ui.error}`}>{t(errorKey(error))}</p>
          <div><button type="button" onClick={load} className={ui.ghostBtn}>{t('retry')}</button></div>
        </div>
      </div>
    );
  }

  if (!course) {
    return <div role="status" className={`p-8 text-sm ${ui.sub}`}>{t('loading')}</div>;
  }

  const Panel = PANELS[tab];
  return (
    <div data-testid="course-page" className={`p-4 sm:p-8 overflow-auto ${ui.txt}`}>
      {backButton}
      <header className="mb-5">
        <span className={`inline-block text-[11px] font-bold uppercase tracking-[0.06em] rounded-full px-2.5 py-0.5 ${ui.pill}`}>
          {course.code}
        </span>
        <h1 className="m-0 mt-2 text-[22px] sm:text-[26px] font-bold tracking-tight break-words">{course.title}</h1>
        <p className={`m-0 mt-1 text-[13px] ${ui.sub}`}>
          {t('lecturer')}: {course.lecturerName || t('noLecturer')}
        </p>
        {course.joinCode && (
          <p className={`m-0 mt-1 text-[13px] ${ui.sub}`}>
            {t('joinCodeLabel')}: <strong className="font-mono tracking-[0.1em]">{course.joinCode}</strong>
          </p>
        )}
      </header>

      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        className={`flex gap-1 border rounded-xl p-1 mb-5 overflow-x-auto max-w-full w-fit ${ui.tabBar}`}
      >
        {COURSE_TABS.map((id, i) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              ref={(el) => { tabRefs.current[i] = el; }}
              type="button"
              role="tab"
              id={`course-tab-${id}`}
              aria-selected={selected}
              aria-controls={`course-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition active:scale-95 ${ui.focus} ${
                selected ? 'bg-brand-gradient text-white shadow-soft' : `${ui.sub} hover:text-current`
              }`}
            >
              {t(`tab${capitalise(id)}`)}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`course-panel-${tab}`} aria-labelledby={`course-tab-${tab}`} tabIndex={0} className={`rounded-xl ${ui.focus}`}>
        <Panel
          course={course}
          t={t}
          ui={ui}
          isLecturer={isLecturer}
          onPost={onPost}
          onCreate={onCreate}
          onCreateGroup={onCreateGroup}
          onOpenWorkspace={onOpenWorkspace}
          onCopyCode={onCopyCode}
          onRegenerateCode={onRegenerateCode}
        />
      </div>
    </div>
  );
}
