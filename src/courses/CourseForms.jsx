// Course site forms. Each one calls a courseApi method passed in as `onSubmit` and shows
// field errors next to the field and API errors under the form. `disabled` locks the form
// (the course API isn't available) and `describedBy` points at the notice that says why.
import React, { useId, useState } from 'react';
import { validateJoinCode, normalizeJoinCode } from './joinCode';
import { buildDeadline } from './deadline';
import { RUBRIC_CRITERIA, rubricFromPercents, toPercentInputs } from './rubric';
import { errorKey } from './viewState';

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

function useSubmit(t) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setFormError(t(errorKey(err)));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, formError, run };
}

function Field({ id, label, error, hint, ui, children }) {
  return (
    <div>
      <label htmlFor={id} className={ui.label}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className={`mt-1 text-xs ${ui.sub}`}>{hint}</p>}
      {error && <p id={`${id}-error`} className={`mt-1 text-xs font-medium ${ui.error}`}>{error}</p>}
    </div>
  );
}

// aria props for an input inside <Field>
const describe = (id, { error, hint, extra } = {}) => {
  const ids = [hint && `${id}-hint`, error && `${id}-error`, extra].filter(Boolean).join(' ');
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': ids || undefined };
};

function FormFooter({ ui, busy, disabled, label, busyLabel, formError, describedBy }) {
  return (
    <>
      {formError && <p role="alert" className={`text-sm font-medium ${ui.error}`}>{formError}</p>}
      <div>
        <button type="submit" className={ui.primaryBtn} disabled={disabled || busy} aria-describedby={describedBy}>
          {busy ? busyLabel : label}
        </button>
      </div>
    </>
  );
}

export function JoinCourseForm({ t, ui, disabled, describedBy, onSubmit }) {
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const { busy, formError, run } = useSubmit(t);

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateJoinCode(code);
    setError(problem && t(problem));
    if (problem || disabled) return;
    if (await run(() => onSubmit(normalizeJoinCode(code)))) setCode('');
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <h2 className="m-0 text-base font-bold">{t('joinCourse')}</h2>
      <Field id={`${id}-code`} label={t('joinCodeLabel')} hint={t('joinCodeHelp')} error={error} ui={ui}>
        <input
          {...describe(`${id}-code`, { error, hint: true, extra: describedBy })}
          className={ui.input}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          disabled={disabled}
        />
      </Field>
      <FormFooter ui={ui} busy={busy} disabled={disabled} label={t('joinButton')} busyLabel={t('joining')} formError={formError} describedBy={describedBy} />
    </form>
  );
}

export function CreateCourseForm({ t, ui, disabled, describedBy, onSubmit }) {
  const id = useId();
  const [values, setValues] = useState({ code: '', title: '', description: '' });
  const [errors, setErrors] = useState({});
  const { busy, formError, run } = useSubmit(t);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!values.code.trim()) next.code = t('fieldRequired');
    if (!values.title.trim()) next.title = t('fieldRequired');
    setErrors(next);
    if (Object.keys(next).length || disabled) return;
    const body = { code: values.code.trim(), title: values.title.trim(), description: values.description.trim() };
    if (await run(() => onSubmit(body))) setValues({ code: '', title: '', description: '' });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <h2 className="m-0 text-base font-bold">{t('createCourse')}</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field id={`${id}-code`} label={t('courseCode')} error={errors.code} ui={ui}>
          <input {...describe(`${id}-code`, { error: errors.code, extra: describedBy })} className={ui.input} value={values.code} onChange={set('code')} maxLength={32} disabled={disabled} />
        </Field>
        <Field id={`${id}-title`} label={t('courseTitle')} error={errors.title} ui={ui}>
          <input {...describe(`${id}-title`, { error: errors.title, extra: describedBy })} className={ui.input} value={values.title} onChange={set('title')} maxLength={200} disabled={disabled} />
        </Field>
      </div>
      <Field id={`${id}-desc`} label={t('courseDescription')} ui={ui}>
        <textarea {...describe(`${id}-desc`, { extra: describedBy })} className={ui.input} rows={3} value={values.description} onChange={set('description')} maxLength={5000} disabled={disabled} />
      </Field>
      <FormFooter ui={ui} busy={busy} disabled={disabled} label={t('createButton')} busyLabel={t('creating')} formError={formError} describedBy={describedBy} />
    </form>
  );
}

export function AnnouncementForm({ t, ui, onSubmit }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const { busy, formError, run } = useSubmit(t);

  const submit = async (e) => {
    e.preventDefault();
    const problem = body.trim() ? null : t('fieldRequired');
    setError(problem);
    if (problem) return;
    if (await run(() => onSubmit({ body: body.trim() }))) setBody('');
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <Field id={`${id}-body`} label={t('announcementLabel')} error={error} ui={ui}>
        <textarea {...describe(`${id}-body`, { error })} className={ui.input} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      </Field>
      <FormFooter ui={ui} busy={busy} label={t('postAnnouncement')} busyLabel={t('posting')} formError={formError} />
    </form>
  );
}

export function AssignmentForm({ t, ui, onSubmit }) {
  const id = useId();
  const empty = () => ({ title: '', date: '', time: '', weights: toPercentInputs() });
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const { busy, formError, run } = useSubmit(t);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const setWeight = (key) => (e) => setValues((v) => ({ ...v, weights: { ...v.weights, [key]: e.target.value } }));
  const { total } = rubricFromPercents(values.weights);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!values.title.trim()) next.title = t('fieldRequired');
    const { deadline, error } = buildDeadline(values.date, values.time);
    if (error === 'timeInvalid') next.time = t(error);
    else if (error) next.date = t(error);
    const { rubric, errors: rubricErrors } = rubricFromPercents(values.weights);
    for (const [k, v] of Object.entries(rubricErrors)) next[k] = t(v);
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = { title: values.title.trim(), deadline: deadline.toISOString(), rubric };
    if (await run(() => onSubmit(body))) setValues(empty());
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <h3 className="m-0 text-sm font-bold">{t('newAssignment')}</h3>
      <Field id={`${id}-title`} label={t('assignmentTitle')} error={errors.title} ui={ui}>
        <input {...describe(`${id}-title`, { error: errors.title })} className={ui.input} value={values.title} onChange={set('title')} maxLength={200} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-date`} label={t('deadlineDate')} error={errors.date} ui={ui}>
          <input {...describe(`${id}-date`, { error: errors.date })} className={ui.input} value={values.date} onChange={set('date')} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" maxLength={10} />
        </Field>
        <Field id={`${id}-time`} label={t('deadlineTime')} error={errors.time} ui={ui}>
          <input {...describe(`${id}-time`, { error: errors.time })} className={ui.input} value={values.time} onChange={set('time')} placeholder="hh:mm" inputMode="numeric" autoComplete="off" maxLength={5} />
        </Field>
      </div>
      <fieldset className="m-0 p-0 border-0 grid gap-2" aria-describedby={`${id}-rubric-help ${id}-rubric-total`}>
        <legend className={`${ui.label} mb-1`}>{t('rubricWeights')}</legend>
        <p id={`${id}-rubric-help`} className={`m-0 text-xs ${ui.sub}`}>{t('rubricHelp')}</p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {RUBRIC_CRITERIA.map((k) => (
            <Field key={k} id={`${id}-w-${k}`} label={t(`criterion${capitalise(k)}`)} error={errors[k]} ui={ui}>
              <input {...describe(`${id}-w-${k}`, { error: errors[k] })} className={ui.input} value={values.weights[k]} onChange={setWeight(k)} inputMode="decimal" autoComplete="off" maxLength={6} />
            </Field>
          ))}
        </div>
        <p id={`${id}-rubric-total`} aria-live="polite" className={`m-0 text-xs font-semibold ${errors.total ? ui.error : ui.sub}`}>
          {t('rubricTotal', { total })}{errors.total ? ` · ${errors.total}` : ''}
        </p>
      </fieldset>
      <FormFooter ui={ui} busy={busy} label={t('createAssignment')} busyLabel={t('creating')} formError={formError} />
    </form>
  );
}
