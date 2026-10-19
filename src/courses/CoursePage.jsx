// One course: header (code, title, lecturer) and the Overview, Assignments, Groups, Members
// and Grades tabs. Only rendered when the course API is available (see ./courseApi.js).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../utils/workspaceHelpers';
import { COURSE_TABS, parseCourseTab, tabIndexAfterKey } from './tabs';
import { RUBRIC_CRITERIA } from './rubric';
import { errorKey } from './viewState';
import { AnnouncementForm, AssignmentForm } from './CourseForms';

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

function Assignments({ course, t, ui, isLecturer, onCreate }) {
  const assignments = course.assignments || [];
  return (
    <div className="grid gap-5">
      {isLecturer && <section className={ui.card}><AssignmentForm t={t} ui={ui} onSubmit={onCreate} /></section>}
      <section className={ui.card} aria-label={t('tabAssignments')}>
        {assignments.length === 0
          ? <Empty ui={ui}>{t('noAssignments')}</Empty>
          : (
            <ul className="m-0 p-0 list-none grid gap-3">
              {assignments.map((a) => (
                <li key={a.id} className={`pb-3 border-b last:border-b-0 last:pb-0 ${ui.divider}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-bold">{a.title}</span>
                    <span className={`text-xs ${ui.sub}`}>
                      {a.deadline ? t('due', { date: formatDateTime(a.deadline) }) : t('noDeadline')}
                    </span>
                  </div>
                  {a.rubric && (
                    <p className={`m-0 mt-1 text-xs ${ui.sub}`}>
                      {RUBRIC_CRITERIA.map((k) => `${t(`criterion${capitalise(k)}`)} ${Math.round((a.rubric[k] ?? 0) * 100)}%`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function Groups({ course, t, ui }) {
  const groups = course.groups || [];
  if (groups.length === 0) return <section className={ui.card}><Empty ui={ui}>{t('noGroups')}</Empty></section>;
  return (
    <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <li key={g.id} className={ui.card}>
          <div className="text-sm font-bold truncate">{g.name}</div>
          <div className={`text-xs mt-1 ${ui.sub}`}>{t('memberCount', { count: g.memberCount ?? 0 })}</div>
        </li>
      ))}
    </ul>
  );
}

function Members({ course, t, ui }) {
  const members = course.members || [];
  if (members.length === 0) return <section className={ui.card}><Empty ui={ui}>{t('noMembers')}</Empty></section>;
  return (
    <section className={ui.card} aria-label={t('tabMembers')}>
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
    </section>
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

const PANELS = { overview: Overview, assignments: Assignments, groups: Groups, members: Members, grades: Grades };

export default function CoursePage({ api, courseId, t, ui, isLecturer, onBack, pushToast }) {
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
    <div className={`p-4 sm:p-8 overflow-auto ${ui.txt}`}>
      {backButton}
      <header className="mb-5">
        <span className={`inline-block text-[11px] font-bold uppercase tracking-[0.06em] rounded-full px-2.5 py-0.5 ${ui.pill}`}>
          {course.code}
        </span>
        <h1 className="m-0 mt-2 text-[22px] sm:text-[26px] font-bold tracking-tight break-words">{course.title}</h1>
        <p className={`m-0 mt-1 text-[13px] ${ui.sub}`}>
          {t('lecturer')}: {course.lecturerName || t('noLecturer')}
        </p>
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
        <Panel course={course} t={t} ui={ui} isLecturer={isLecturer} onPost={onPost} onCreate={onCreate} />
      </div>
    </div>
  );
}
