// The superAdmin's billing tabs (step 6.13), shown in AdminArea when billing_enabled is on:
// the payment queue, colleges with their subscriptions, plans, and payment settings.
// Approving is the only thing that activates a plan, and only after the payment is found in the
// bank statement. Every decision is written to the audit log by the backend.
import React, { useCallback, useState } from 'react';
import { courseTheme } from '../courses/courseTheme';
import {
  formatDate,
  formatNu,
  planFormError,
  planPayload,
  reasonError,
  REQUEST_STATUS_TEXT,
  STATUS_TEXT,
} from './billingFormat';
import { cell, ErrorText, Field, Notice, SectionTitle, StatusPill, Table, useAction, useLoad } from './ui';

function Shell({ title, subtitle, ui, children }) {
  return (
    <div className={`grid gap-5 ${ui.txt}`}>
      <div>
        <h1 className="m-0 mb-1 text-[26px] font-bold tracking-tight">{title}</h1>
        <p className={`m-0 text-[13px] ${ui.sub}`}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Loading({ ui, text }) {
  return <p role="status" className={`m-0 text-sm ${ui.sub}`}>{text}</p>;
}

// ── Payments ──

function RequestCard({ request: r, ui, darkMode, api, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const [run, busy, error] = useAction();
  const interbank = !/mbob|bank of bhutan|bob/i.test(r.method.name);

  const approve = () => {
    if (!window.confirm(`Approve ${formatNu(r.amountNu)} from ${r.college.name}? Only do this once you have found journal number ${r.journalNumber} in the statement.`)) return;
    run(async () => onDone(await api.approvePaymentRequest(r.id), 'approved'));
  };
  const reject = (e) => {
    e.preventDefault();
    const message = reasonError(reason);
    setProblem(message);
    if (!message) run(async () => onDone(await api.rejectPaymentRequest(r.id, reason.trim()), 'rejected'));
  };

  return (
    <li className={`${ui.card} grid gap-3`} aria-label={`Payment ${r.referenceCode} from ${r.college.name}`}>
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-[15px]">{r.college.name}</strong>
        <StatusPill status={r.status} text={REQUEST_STATUS_TEXT[r.status]} darkMode={darkMode} />
        <span className={`text-xs ${ui.sub}`}>Sent {formatDate(r.createdAt)}</span>
      </div>
      <dl className="m-0 grid gap-x-6 gap-y-2 grid-cols-2 sm:grid-cols-4 text-[13px]">
        {[
          ['Amount', formatNu(r.amountNu)],
          ['Plan', r.plan.name],
          ['Method', r.method.name],
          ['Journal number', <span key="j" className="font-mono font-semibold">{r.journalNumber}</span>],
          ['Paid on', formatDate(r.paidOn)],
          ['Reference', <span key="r" className="font-mono">{r.referenceCode}</span>],
          ['Paid by', r.payer ? `${r.payer.name}${r.payer.email ? ` (${r.payer.email})` : ''}` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className={`text-xs font-semibold ${ui.sub}`}>{k}</dt>
            <dd className="m-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {r.status === 'pending' && interbank && (
        <p className={`m-0 text-xs ${ui.sub}`}>Payments from another bank can take a day or more to show in the statement. Leave it pending until then.</p>
      )}
      {r.rejectReason && <p className={`m-0 text-sm ${ui.error}`}>Reason: {r.rejectReason}</p>}
      <ErrorText error={error} ui={ui} />
      {r.status === 'pending' && !rejecting && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={approve} className={ui.primaryBtn}>Approve</button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={ui.ghostBtn}>Reject</button>
        </div>
      )}
      {r.status === 'pending' && rejecting && (
        <form onSubmit={reject} className="grid gap-2">
          <Field id={`reason-${r.id}`} label="Why is it rejected? The college admin sees this." ui={ui}>
            <textarea id={`reason-${r.id}`} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={ui.input} />
          </Field>
          <ErrorText error={problem} ui={ui} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={ui.primaryBtn}>Reject payment</button>
            <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={ui.ghostBtn}>Back</button>
          </div>
        </form>
      )}
    </li>
  );
}

export function PaymentsTab({ api, darkMode }) {
  const ui = courseTheme(darkMode);
  const [status, setStatus] = useState('pending');
  const load = useCallback(() => api.listPaymentRequests(status).then((r) => r.requests), [api, status]);
  const { loading, error, data, reload } = useLoad(load);
  const [note, setNote] = useState('');

  const done = (result, what) => {
    const r = result.request || result;
    setNote(what === 'approved' ? `Approved ${r.referenceCode}. ${r.college.name} is now covered until ${formatDate(result.subscription?.endsAt)}.` : `Rejected ${r.referenceCode}.`);
    reload();
  };

  return (
    <Shell title="Payments" subtitle="Check each journal number against the bank statement before approving. Approving starts or extends the college's plan." ui={ui}>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="payment-filter" label="Show" ui={ui}>
          <select id="payment-filter" value={status} onChange={(e) => setStatus(e.target.value)} className={ui.input}>
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </Field>
        <button type="button" onClick={reload} className={ui.ghostBtn}>Refresh</button>
      </div>
      {note && <Notice tone="good" darkMode={darkMode} role="status">{note}</Notice>}
      {loading && !data ? (
        <Loading ui={ui} text="Loading payments…" />
      ) : error ? (
        <ErrorText error={error} ui={ui} />
      ) : !data.length ? (
        <p className={`m-0 text-sm ${ui.sub}`}>{status === 'pending' ? 'No payments are waiting for review.' : 'Nothing to show.'}</p>
      ) : (
        <ul className="m-0 p-0 list-none grid gap-3">
          {data.map((r) => <RequestCard key={r.id} request={r} ui={ui} darkMode={darkMode} api={api} onDone={done} />)}
        </ul>
      )}
    </Shell>
  );
}

// ── Colleges and subscriptions ──

function SubscriptionActions({ college, plans, api, ui, onDone }) {
  const [mode, setMode] = useState(null); // 'grant' | 'extend' | 'revoke'
  const [form, setForm] = useState({ planId: '', days: '', reason: '' });
  const [problem, setProblem] = useState('');
  const [run, busy, error] = useAction();
  const latest = college.billing.subscriptions.find((s) => !s.revokedAt) || null;
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const prefix = `${mode}-${college.id}`;

  async function submit(e) {
    e.preventDefault();
    const message = reasonError(form.reason) || (mode === 'grant' && !form.planId ? 'Choose a plan.' : '') || (mode === 'extend' && !(Number(form.days) >= 1) ? 'Enter how many days to add.' : '');
    setProblem(message);
    if (message) return;
    const ok = await run(async () => {
      if (mode === 'grant') await api.grantSubscription(college.id, { planId: form.planId, days: form.days ? Number(form.days) : undefined, note: form.reason.trim() });
      if (mode === 'extend') await api.extendSubscription(latest.id, { days: Number(form.days), reason: form.reason.trim() });
      if (mode === 'revoke') await api.revokeSubscription(latest.id, form.reason.trim());
      return true;
    });
    if (ok) {
      setMode(null);
      setForm({ planId: '', days: '', reason: '' });
      onDone();
    }
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode('grant')} className={ui.ghostBtn} aria-label={`Grant a plan to ${college.name}`}>Grant</button>
        {latest && <button type="button" onClick={() => setMode('extend')} className={ui.ghostBtn} aria-label={`Extend ${college.name}'s plan`}>Extend</button>}
        {latest && <button type="button" onClick={() => setMode('revoke')} className={ui.ghostBtn} aria-label={`Revoke ${college.name}'s plan`}>Revoke</button>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`grid gap-3 border-t pt-3 ${ui.divider}`}>
      <strong className="text-sm">
        {mode === 'grant' ? 'Grant a plan without payment (for example a pilot)' : mode === 'extend' ? `Extend the plan ending ${formatDate(latest.endsAt)}` : 'Revoke the current plan'}
      </strong>
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === 'grant' && (
          <Field id={`${prefix}-plan`} label="Plan" ui={ui}>
            <select id={`${prefix}-plan`} value={form.planId} onChange={set('planId')} className={ui.input}>
              <option value="">Choose…</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.seats} seats, {p.durationDays} days)</option>)}
            </select>
          </Field>
        )}
        {mode !== 'revoke' && (
          <Field id={`${prefix}-days`} label={mode === 'grant' ? 'Days (empty: the plan’s length)' : 'Days to add'} ui={ui}>
            <input id={`${prefix}-days`} type="number" min="1" max="1100" value={form.days} onChange={set('days')} className={ui.input} />
          </Field>
        )}
        <div className={mode === 'revoke' ? 'sm:col-span-3' : ''}>
          <Field id={`${prefix}-reason`} label="Reason (kept in the audit log)" ui={ui}>
            <input id={`${prefix}-reason`} value={form.reason} maxLength={500} onChange={set('reason')} className={ui.input} />
          </Field>
        </div>
      </div>
      <ErrorText error={problem || error} ui={ui} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={ui.primaryBtn}>{mode === 'grant' ? 'Grant' : mode === 'extend' ? 'Extend' : 'Revoke'}</button>
        <button type="button" disabled={busy} onClick={() => setMode(null)} className={ui.ghostBtn}>Cancel</button>
      </div>
    </form>
  );
}

export function BillingCollegesTab({ api, darkMode, NewCollegeForm }) {
  const ui = courseTheme(darkMode);
  const load = useCallback(async () => {
    const [{ colleges }, { plans }] = await Promise.all([api.listBillingColleges(), api.listPlans()]);
    return { colleges, plans };
  }, [api]);
  const { loading, error, data, reload } = useLoad(load);

  return (
    <Shell title="Colleges and subscriptions" subtitle="Each college's plan, worked out from its subscriptions. Grants, extensions and revocations need a reason." ui={ui}>
      {NewCollegeForm && <NewCollegeForm onCreated={reload} />}
      {loading && !data ? (
        <Loading ui={ui} text="Loading colleges…" />
      ) : error ? (
        <ErrorText error={error} ui={ui} />
      ) : !data.colleges.length ? (
        <p className={`m-0 text-sm ${ui.sub}`}>There are no colleges yet.</p>
      ) : (
        <ul className="m-0 p-0 list-none grid gap-3">
          {data.colleges.map((c) => (
            <li key={c.id} className={`${ui.card} grid gap-3`}>
              <div className="flex flex-wrap items-center gap-3">
                <strong className="text-[15px]">{c.name}</strong>
                <StatusPill status={c.billing.status} text={STATUS_TEXT[c.billing.status]} darkMode={darkMode} />
              </div>
              <p className={`m-0 text-[13px] ${ui.sub}`}>
                {c.billing.plan ? `${c.billing.plan.name} · ` : ''}
                {c.billing.paidUntil ? `paid until ${formatDate(c.billing.paidUntil)} · ` : ''}
                {c.billing.seatsUsed} of {c.billing.seatLimit} seats in use
              </p>
              <SubscriptionActions college={c} plans={data.plans} api={api} ui={ui} onDone={reload} />
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// ── Plans ──

const EMPTY_PLAN = { name: '', priceNu: '', durationDays: '365', seats: '', maxCourses: '', monthlyAiAnalyses: '', manualOnly: false };

export function PlansTab({ api, darkMode }) {
  const ui = courseTheme(darkMode);
  const load = useCallback(() => api.listPlans().then((r) => r.plans), [api]);
  const { loading, error, data, reload } = useLoad(load);
  const [form, setForm] = useState(EMPTY_PLAN);
  const [problem, setProblem] = useState('');
  const [run, busy, actionError] = useAction();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function create(e) {
    e.preventDefault();
    const message = planFormError(form);
    setProblem(message);
    if (message) return;
    const created = await run(() => api.createPlan(planPayload(form)));
    if (created) {
      setForm(EMPTY_PLAN);
      reload();
    }
  }

  return (
    <Shell title="Plans" subtitle="What colleges can buy. A plan that has been used can be hidden but not deleted; prices already paid stay as they were." ui={ui}>
      <form onSubmit={create} aria-labelledby="new-plan-heading" className={`${ui.card} grid gap-3`} noValidate>
        <SectionTitle id="new-plan-heading" title="New plan" ui={ui} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="plan-name" label="Name" ui={ui}><input id="plan-name" value={form.name} maxLength={100} onChange={set('name')} className={ui.input} /></Field>
          <Field id="plan-price" label="Price (Nu.)" ui={ui}><input id="plan-price" type="number" min="1" step="0.01" value={form.priceNu} onChange={set('priceNu')} className={ui.input} /></Field>
          <Field id="plan-days" label="Length (days)" ui={ui}><input id="plan-days" type="number" min="1" max="1100" value={form.durationDays} onChange={set('durationDays')} className={ui.input} /></Field>
          <Field id="plan-seats" label="Lecturer seats" ui={ui}><input id="plan-seats" type="number" min="1" value={form.seats} onChange={set('seats')} className={ui.input} /></Field>
          <Field id="plan-courses" label="Courses per seat (empty: no limit)" ui={ui}><input id="plan-courses" type="number" min="1" value={form.maxCourses} onChange={set('maxCourses')} className={ui.input} /></Field>
          <Field id="plan-ai" label="AI analyses a month (empty: no limit)" ui={ui}><input id="plan-ai" type="number" min="0" value={form.monthlyAiAnalyses} onChange={set('monthlyAiAnalyses')} className={ui.input} /></Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.manualOnly} onChange={set('manualOnly')} className={ui.focus} />
          Only granted by a superAdmin (colleges can&apos;t buy it)
        </label>
        <ErrorText error={problem || actionError} ui={ui} />
        <div><button type="submit" disabled={busy} className={ui.primaryBtn}>{busy ? 'Saving…' : 'Add plan'}</button></div>
      </form>

      {loading && !data ? (
        <Loading ui={ui} text="Loading plans…" />
      ) : error ? (
        <ErrorText error={error} ui={ui} />
      ) : !data.length ? (
        <p className={`m-0 text-sm ${ui.sub}`}>No plans yet.</p>
      ) : (
        <Table caption="Plans" head={['Name', 'Price', 'Length', 'Seats', 'Courses per seat', 'AI a month', 'Shown', '']} ui={ui}>
          {data.map((p) => (
            <tr key={p.id} className={`border-t ${ui.divider}`}>
              <td className={`${cell} font-semibold`}>{p.name}{p.manualOnly && <span className={`block text-xs font-normal ${ui.sub}`}>Granted only</span>}</td>
              <td className={`${cell} whitespace-nowrap`}>{formatNu(p.priceNu)}</td>
              <td className={cell}>{p.durationDays} days</td>
              <td className={cell}>{p.seats}</td>
              <td className={cell}>{p.maxCourses ?? 'No limit'}</td>
              <td className={cell}>{p.monthlyAiAnalyses ?? 'No limit'}</td>
              <td className={cell}>{p.isActive ? 'Yes' : 'Hidden'}</td>
              <td className={cell}>
                <button
                  type="button"
                  disabled={busy}
                  className={ui.ghostBtn}
                  aria-label={`${p.isActive ? 'Hide' : 'Show'} the ${p.name} plan`}
                  onClick={() => run(async () => { await api.updatePlan(p.id, { isActive: !p.isActive }); reload(); })}
                >
                  {p.isActive ? 'Hide' : 'Show'}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Shell>
  );
}

// ── Payment settings and methods ──

const SETTINGS_FIELDS = [
  ['accountName', 'Account name', 200],
  ['accountNumber', 'Account number', 60],
  ['bank', 'Bank', 200],
];

function SettingsForm({ initial, api, ui, darkMode }) {
  const [form, setForm] = useState({ ...initial, graceDays: String(initial.graceDays) });
  const [saved, setSaved] = useState(false);
  const [run, busy, error] = useAction();
  const set = (field) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  async function save(e) {
    e.preventDefault();
    const body = {
      accountName: form.accountName || null,
      accountNumber: form.accountNumber || null,
      bank: form.bank || null,
      qrImagePath: form.qrImagePath || null,
      verificationMessage: form.verificationMessage || null,
      refundPolicy: form.refundPolicy || null,
      graceDays: Number(form.graceDays),
    };
    if (await run(() => api.savePaymentSettings(body))) setSaved(true);
  }

  return (
    <form onSubmit={save} aria-labelledby="settings-heading" className={`${ui.card} grid gap-3`}>
      <SectionTitle id="settings-heading" title="Where colleges pay" subtitle="Shown to college admins next to the payment form. Every change is audited." ui={ui} />
      <div className="grid gap-3 sm:grid-cols-3">
        {SETTINGS_FIELDS.map(([key, label, max]) => (
          <Field key={key} id={`settings-${key}`} label={label} ui={ui}>
            <input id={`settings-${key}`} value={form[key] || ''} maxLength={max} onChange={set(key)} className={ui.input} />
          </Field>
        ))}
      </div>
      <Field id="settings-verification" label="What happens after paying" hint="For example: we check payments every working day; payments from another bank can take longer." ui={ui}>
        <textarea id="settings-verification" rows={2} value={form.verificationMessage || ''} maxLength={2000} onChange={set('verificationMessage')} className={ui.input} />
      </Field>
      <Field id="settings-refund" label="Refund policy" ui={ui}>
        <textarea id="settings-refund" rows={2} value={form.refundPolicy || ''} maxLength={4000} onChange={set('refundPolicy')} className={ui.input} />
      </Field>
      <div className="max-w-[220px]">
        <Field id="settings-grace" label="Grace period (days)" hint="After a plan ends, work goes on this long before read-only." ui={ui}>
          <input id="settings-grace" type="number" min="0" max="60" value={form.graceDays} onChange={set('graceDays')} className={ui.input} />
        </Field>
      </div>
      <ErrorText error={error} ui={ui} />
      {saved && <Notice tone="good" darkMode={darkMode} role="status">Saved.</Notice>}
      <div><button type="submit" disabled={busy} className={ui.primaryBtn}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  );
}

function MethodsSection({ api, ui }) {
  const load = useCallback(() => api.listMethods().then((r) => r.methods), [api]);
  const { loading, error, data, reload } = useLoad(load);
  const [name, setName] = useState('');
  const [run, busy, actionError] = useAction();

  async function add(e) {
    e.preventDefault();
    if (await run(() => api.createMethod(name.trim()))) {
      setName('');
      reload();
    }
  }

  return (
    <section aria-labelledby="methods-heading" className={`${ui.card} grid gap-3`}>
      <SectionTitle id="methods-heading" title="Payment methods" subtitle="The ways a college can say it paid, for example mBoB, BNB mPay, TPay, DK Bank, BDBL or a bank transfer." ui={ui} />
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Field id="method-name" label="New method" ui={ui}>
            <input id="method-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={ui.input} />
          </Field>
        </div>
        <button type="submit" disabled={busy || name.trim().length < 2} className={ui.primaryBtn}>Add method</button>
      </form>
      <ErrorText error={error || actionError} ui={ui} />
      {loading && !data ? (
        <Loading ui={ui} text="Loading methods…" />
      ) : data?.length ? (
        <ul className="m-0 p-0 list-none grid gap-2">
          {data.map((m) => (
            <li key={m.id} className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm ${ui.divider}`}>
              <span>{m.name}{!m.isActive && <span className={`ml-2 text-xs ${ui.sub}`}>(hidden)</span>}</span>
              <button type="button" disabled={busy} className={ui.ghostBtn} aria-label={`${m.isActive ? 'Hide' : 'Show'} ${m.name}`} onClick={() => run(async () => { await api.updateMethod(m.id, !m.isActive); reload(); })}>
                {m.isActive ? 'Hide' : 'Show'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`m-0 text-sm ${ui.sub}`}>No methods yet. Colleges can&apos;t pay until there is at least one.</p>
      )}
    </section>
  );
}

export function PaymentSettingsTab({ api, darkMode }) {
  const ui = courseTheme(darkMode);
  const load = useCallback(() => api.getPaymentSettings(), [api]);
  const { loading, error, data } = useLoad(load);
  return (
    <Shell title="Payment settings" subtitle="Bank details, the grace period and the payment methods colleges choose from." ui={ui}>
      {loading && !data ? <Loading ui={ui} text="Loading settings…" /> : error ? <ErrorText error={error} ui={ui} /> : <SettingsForm initial={data} api={api} ui={ui} darkMode={darkMode} />}
      <MethodsSection api={api} ui={ui} />
    </Shell>
  );
}
