// Courses tab (step 1.7). Students see "My courses" and "Join a course"; lecturers see
// "My courses" and "Create a course". Opening a course shows CoursePage.
//
// `api` is courseApi from src/api. While it is null (no course routes on the backend yet)
// the tab says "Not available yet", the forms are disabled and no course data is shown.
import React, { useCallback, useEffect, useState } from 'react';
import { isCourseApiReady } from './courseApi';
import { courseText } from './strings';
import { courseTheme } from './courseTheme';
import { errorKey, listViewState } from './viewState';
import { CreateCourseForm, JoinCourseForm } from './CourseForms';
import CoursePage from './CoursePage';

const NOTICE_ID = 'courses-unavailable';

export function UnavailableNotice({ t, ui }) {
  return (
    <div id={NOTICE_ID} role="status" className={`border border-l-4 border-l-amber-400 rounded-xl px-4 py-3 mb-5 ${ui.notice}`}>
      <span className={`inline-block text-[11px] font-bold uppercase tracking-[0.06em] rounded-full px-2 py-0.5 ${ui.noticeBadge}`}>
        {t('notAvailableYet')}
      </span>
      <p className="m-0 mt-2 text-sm">{t('unavailableBody')}</p>
    </div>
  );
}

function CourseList({ state, courses, error, isLecturer, t, ui, onOpen, onRetry }) {
  if (state === 'unavailable') return <p className={`m-0 text-sm ${ui.sub}`}>{t('myCoursesUnavailable')}</p>;
  if (state === 'loading') return <p role="status" className={`m-0 text-sm ${ui.sub}`}>{t('loading')}</p>;
  if (state === 'error') {
    return (
      <div role="alert" className="grid gap-3">
        <p className={`m-0 text-sm font-medium ${ui.error}`}>{t(errorKey(error))}</p>
        <div><button type="button" onClick={onRetry} className={ui.ghostBtn}>{t('retry')}</button></div>
      </div>
    );
  }
  if (state === 'empty') {
    return <p className={`m-0 text-sm ${ui.sub}`}>{isLecturer ? t('myCoursesEmptyLecturer') : t('myCoursesEmptyStudent')}</p>;
  }
  return (
    <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2">
      {courses.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpen(c.id)}
            aria-label={t('openCourse', { title: c.title })}
            className={`w-full text-left border border-l-4 border-l-brand-500 rounded-xl px-4 py-3 transition hover:shadow-soft active:scale-[0.99] ${ui.tabBar} ${ui.focus}`}
          >
            <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${ui.sub}`}>{c.code}</span>
            <span className={`block text-sm font-bold mt-0.5 truncate ${ui.txt}`}>{c.title}</span>
            <span className={`block text-xs mt-1 truncate ${ui.sub}`}>
              {t('lecturer')}: {c.lecturerName || t('noLecturer')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function CoursesPanel({ api = null, language = 'en', darkMode = false, isLecturer = false, pushToast = () => {} }) {
  const t = courseText(language);
  const ui = courseTheme(darkMode);
  const ready = isCourseApiReady(api);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(ready);
  const [error, setError] = useState(null);
  const [openCourseId, setOpenCourseId] = useState(null);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      setCourses(await api.listMyCourses());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { load(); }, [load]);

  if (ready && openCourseId) {
    return (
      <CoursePage
        api={api}
        courseId={openCourseId}
        t={t}
        ui={ui}
        isLecturer={isLecturer}
        pushToast={pushToast}
        onBack={() => setOpenCourseId(null)}
      />
    );
  }

  const addCourse = (course) => setCourses((list) => (list.some((c) => c.id === course.id) ? list : [...list, course]));

  const onJoin = async (code) => {
    const course = await api.joinCourse(code);
    addCourse(course);
    pushToast(t('joined', { title: course.title }));
  };

  const onCreate = async (body) => {
    addCourse(await api.createCourse(body));
    pushToast(t('created'));
  };

  const formProps = { t, ui, disabled: !ready, describedBy: ready ? undefined : NOTICE_ID };

  return (
    <div className={`p-4 sm:p-8 overflow-auto ${ui.txt}`}>
      <h1 className="m-0 mb-1.5 text-[26px] font-bold tracking-tight">{t('title')}</h1>
      <p className={`m-0 mb-5 text-[13px] ${ui.sub}`}>{isLecturer ? t('subtitleLecturer') : t('subtitleStudent')}</p>

      {!ready && <UnavailableNotice t={t} ui={ui} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <section aria-labelledby="my-courses-heading" className={ui.card}>
          <h2 id="my-courses-heading" className="m-0 mb-3 text-base font-bold">{t('myCourses')}</h2>
          <CourseList
            state={listViewState({ ready, loading, error, items: courses })}
            courses={courses}
            error={error}
            isLecturer={isLecturer}
            t={t}
            ui={ui}
            onOpen={setOpenCourseId}
            onRetry={load}
          />
        </section>
        <section className={ui.card}>
          {isLecturer
            ? <CreateCourseForm {...formProps} onSubmit={onCreate} />
            : <JoinCourseForm {...formProps} onSubmit={onJoin} />}
        </section>
      </div>
    </div>
  );
}
