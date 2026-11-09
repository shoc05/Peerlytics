// The collegeAdmin's page (step 6.14): their own college only. Overview, lecturers and courses
// always work; the subscription, paying and seats appear when billing_enabled is on.
// A payment is a claim until a Peerlytics superAdmin finds it in the bank statement (D2: no
// screenshots, only the journal number and method).
import React, { useCallback, useMemo, useState } from 'react';
import { courseTheme } from '../courses/courseTheme';
import {
  formatDate,
  formatNu,
  paymentFormError,
  paymentPayload,
  REQUEST_STATUS_TEXT,
  STATUS_TEXT,
  todayInBhutan,
} from './billingFormat';
import { cell, ErrorText, Field, Notice, SectionTitle, StatusPill, Table, Tabs, useAction, useLoad } from './ui';

function Stat({ label, value, ui }) {
  return (
    <div className={ui.card}>
      <div className={`text-xs font-semibold ${ui.sub}`}>{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function statusSentence(billing) {
  if (!billing) return '';
  switch (billing.status) {
    case 'active':
      return `Paid until ${formatDate(billing.paidUntil)}.`;
    case 'grace':
      return `The plan ended. Lecturers can keep working until ${formatDate(billing.graceEndsAt)}; renew before then.`;
    case 'read_only':
      return 'The plan has ended, so courses are read-only. Work can still be viewed and exported. Renew to continue.';
    case 'revoked':
      return 'The subscription was revoked. Contact the Peerlytics administrator.';
    default:
      return 'Your college has no subscription yet. Choose a plan and pay to give lecturers seats.';
  }
}

function Overview({ data, ui, darkMode }) {
  const { billing, billingEnabled, lecturers, courses } = data;
  return (
    <div className="grid gap-5">
      {billingEnabled && billing && (
        <section aria-labelledby="sub-heading" className={ui.card}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="sub-heading" className="m-0 text-base font-bold">Subscription</h2>
            <StatusPill status={billing.status} text={STATUS_TEXT[billing.status]} darkMode={darkMode} />
            {billing.plan && <span className={`text-[13px] ${ui.sub}`}>{billing.plan.name}</span>}
          </div>
          <p className={`m-0 mt-2 text-sm ${ui.sub}`}>{statusSentence(billing)}</p>
        </section>
      )}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="Lecturers" value={lecturers.length} ui={ui} />
        {billingEnabled && billing && <Stat label="Seats in use" value={`${billing.seatsUsed} of ${billing.seatLimit}`} ui={ui} />}
        <Stat label="Courses" value={courses.filter((c) => !c.archived).length} ui={ui} />
        <Stat label="Students enrolled" value={courses.reduce((n, c) => n + c.studentCount, 0)} ui={ui} />
      </div>
      {!billingEnabled && (
        <Notice darkMode={darkMode}>
          Subscriptions are not turned on yet. You can add your college&apos;s lecturers now; seats and payments will appear here when they are.
        </Notice>
      )}
    </div>
  );
}

function PayForm({ plans, methods, payTo, ui, darkMode, onPaid }) {
  const [form, setForm] = useState({ planId: plans[0]?.id || '', paymentMethodId: '', journalNumber: '', paidOn: todayInBhutan() });
  const [problem, setProblem] = useState('');
  const [run, busy, error] = useAction();
  const plan = plans.find((p) => p.id === form.planId);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const message = paymentFormError(form);
    setProblem(message);
    if (message) return;
    const created = await run(() => onPaid(paymentPayload(form, plan)));
    if (created) setForm((f) => ({ ...f, journalNumber: '' }));
  }

  if (!plans.length || !methods.length) {
    return <Notice darkMode={darkMode}>No plans or payment methods are available yet. The Peerlytics administrator has to add them first.</Notice>;
  }

  return (
    <form onSubmit={submit} aria-labelledby="pay-heading" className={`${ui.card} grid gap-4`} noValidate>
      <SectionTitle id="pay-heading" title="Pay for a plan" subtitle="Pay by bank transfer first, then send the journal number here. Nothing changes until Peerlytics finds the payment in its statement." ui={ui} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-plan" label="Plan" ui={ui}>
          <select id="pay-plan" value={form.planId} onChange={set('planId')} className={ui.input}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}: {formatNu(p.priceNu)} for {p.durationDays} days, {p.seats} {p.seats === 1 ? 'seat' : 'seats'}
              </option>
            ))}
          </select>
        </Field>
        <div className={`rounded-lg border px-3 py-2 text-sm ${ui.divider}`}>
          <div className={`text-xs font-semibold ${ui.sub}`}>Amount to pay</div>
          <div className="text-lg font-bold">{plan ? formatNu(plan.priceNu) : '—'}</div>
          {plan?.maxCourses && <div className={`text-xs ${ui.sub}`}>Up to {plan.maxCourses} courses per lecturer</div>}
        </div>
      </div>

      {(payTo.accountNumber || payTo.bank) && (
        <div className={`rounded-lg border px-3 py-3 text-sm grid gap-1 ${ui.divider}`}>
          <div className="font-semibold">Pay to</div>
          {payTo.accountName && <div>Account name: <strong>{payTo.accountName}</strong></div>}
          {payTo.accountNumber && <div>Account number: <strong>{payTo.accountNumber}</strong></div>}
          {payTo.bank && <div>Bank: <strong>{payTo.bank}</strong></div>}
          {payTo.verificationMessage && <p className={`m-0 mt-1 ${ui.sub}`}>{payTo.verificationMessage}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="pay-method" label="How you paid" ui={ui}>
          <select id="pay-method" value={form.paymentMethodId} onChange={set('paymentMethodId')} className={ui.input}>
            <option value="">Choose…</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field id="pay-journal" label="Journal number" hint="From your bank's confirmation, e.g. 89892938" ui={ui}>
          <input id="pay-journal" value={form.journalNumber} onChange={set('journalNumber')} autoComplete="off" maxLength={60} className={ui.input} />
        </Field>
        <Field id="pay-date" label="Date paid" ui={ui}>
          <input id="pay-date" type="date" value={form.paidOn} max={todayInBhutan()} onChange={set('paidOn')} className={ui.input} />
        </Field>
      </div>
      {payTo.refundPolicy && <p className={`m-0 text-xs ${ui.sub}`}>{payTo.refundPolicy}</p>}
      <ErrorText error={problem || error} ui={ui} />
      <div>
        <button type="submit" disabled={busy} className={ui.primaryBtn}>{busy ? 'Sending…' : 'Send for review'}</button>
      </div>
    </form>
  );
}

function RequestHistory({ requests, ui, darkMode, onCancel }) {
  const [run, busy, error] = useAction();
  if (!requests.length) return <p className={`m-0 text-sm ${ui.sub}`}>No payments sent yet.</p>;
  return (
    <div className="grid gap-2">
      <ErrorText error={error} ui={ui} />
      <Table caption="Payments sent" head={['Reference', 'Plan', 'Amount', 'Method and journal', 'Paid on', 'Status', '']} ui={ui}>
        {requests.map((r) => (
          <tr key={r.id} className={`border-t ${ui.divider}`}>
            <td className={`${cell} font-mono font-semibold`}>{r.referenceCode}</td>
            <td className={cell}>{r.plan.name}</td>
            <td className={`${cell} whitespace-nowrap`}>{formatNu(r.amountNu)}</td>
            <td className={cell}>{r.method.name} · <span className="font-mono">{r.journalNumber}</span></td>
            <td className={`${cell} whitespace-nowrap`}>{formatDate(r.paidOn)}</td>
            <td className={cell}>
              <StatusPill status={r.status} text={REQUEST_STATUS_TEXT[r.status]} darkMode={darkMode} />
              {r.rejectReason && <div className={`mt-1 text-xs ${ui.error}`}>Reason: {r.rejectReason}</div>}
            </td>
            <td className={cell}>
              {r.status === 'pending' && (
                <button type="button" disabled={busy} onClick={() => run(() => onCancel(r.id))} className={ui.ghostBtn} aria-label={`Cancel payment ${r.referenceCode}`}>
                  Cancel
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function SubscriptionTab({ api, data, ui, darkMode, onChanged }) {
  const load = useCallback(() => api.getCollegeBilling(), [api]);
  const billing = useLoad(load);
  const [lastSent, setLastSent] = useState(null);

  const paid = async (payload) => {
    const created = await api.createPaymentRequest(payload);
    setLastSent(created);
    billing.reload();
    return created;
  };
  const cancel = async (id) => {
    await api.cancelMyPaymentRequest(id);
    billing.reload();
  };

  return (
    <div className="grid gap-5">
      <section aria-labelledby="status-heading" className={ui.card}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="status-heading" className="m-0 text-base font-bold">Current plan</h2>
          <StatusPill status={data.billing.status} text={STATUS_TEXT[data.billing.status]} darkMode={darkMode} />
        </div>
        <p className={`m-0 mt-2 text-sm ${ui.sub}`}>{statusSentence(data.billing)}</p>
        {data.billing.plan && (
          <p className={`m-0 mt-1 text-sm ${ui.sub}`}>
            {data.billing.plan.name} · {data.billing.seatsUsed} of {data.billing.seatLimit} seats in use
          </p>
        )}
        <button type="button" onClick={onChanged} className={`${ui.ghostBtn} mt-3`}>Refresh</button>
      </section>

      {billing.loading && !billing.data ? (
        <p role="status" className={`m-0 text-sm ${ui.sub}`}>Loading plans…</p>
      ) : billing.error ? (
        <ErrorText error={billing.error} ui={ui} />
      ) : (
        <>
          {lastSent && (
            <Notice tone="good" darkMode={darkMode} role="status">
              Sent for review. Your reference is <strong className="font-mono">{lastSent.referenceCode}</strong>. Peerlytics checks the payment against its bank statement, which can take longer for payments from another bank.
            </Notice>
          )}
          <PayForm plans={billing.data.plans} methods={billing.data.methods} payTo={billing.data.payTo} ui={ui} darkMode={darkMode} onPaid={paid} />
          <section aria-labelledby="history-heading">
            <SectionTitle id="history-heading" title="Payments sent" ui={ui} />
            <RequestHistory requests={billing.data.requests} ui={ui} darkMode={darkMode} onCancel={cancel} />
          </section>
        </>
      )}
    </div>
  );
}

function LecturersTab({ api, data, ui, darkMode, onData }) {
  const [email, setEmail] = useState('');
  const [run, busy, error] = useAction();
  const [note, setNote] = useState('');
  const { billing, billingEnabled } = data;
  const covered = billing && (billing.status === 'active' || billing.status === 'grace');
  const seatsLeft = billing ? billing.seatLimit - billing.seatsUsed : 0;

  async function add(e) {
    e.preventDefault();
    const fresh = await run(() => api.addLecturer(email.trim()));
    if (fresh) {
      onData(fresh);
      setNote(`${email.trim()} was added. They will be signed out once and must sign in again.`);
      setEmail('');
    }
  }

  const act = (fn, message) => run(async () => {
    await fn();
    setNote(message);
    onData(await api.getCollege());
  });

  return (
    <div className="grid gap-5">
      <form onSubmit={add} aria-labelledby="add-lecturer-heading" className={`${ui.card} grid gap-3`}>
        <SectionTitle id="add-lecturer-heading" title="Add a lecturer" subtitle="They must already have a Peerlytics account as a lecturer. Their courses then appear under this college." ui={ui} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Field id="lecturer-email" label="Lecturer's email" ui={ui}>
              <input id="lecturer-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={ui.input} />
            </Field>
          </div>
          <button type="submit" disabled={busy || !email.trim()} className={ui.primaryBtn}>{busy ? 'Adding…' : 'Add lecturer'}</button>
        </div>
      </form>

      {note && <Notice tone="good" darkMode={darkMode} role="status">{note}</Notice>}
      <ErrorText error={error} ui={ui} />

      {billingEnabled && billing && (
        <p className={`m-0 text-sm ${ui.sub}`}>
          {covered ? `${billing.seatsUsed} of ${billing.seatLimit} seats in use.` : 'Seats can be given once the college has an active plan.'} A lecturer needs a seat to create courses and projects.
        </p>
      )}

      {!data.lecturers.length ? (
        <p className={`m-0 text-sm ${ui.sub}`}>No lecturers in your college yet.</p>
      ) : (
        <Table caption="Lecturers in your college" head={['Name', 'Email', 'Courses', ...(billingEnabled ? ['Seat'] : []), '']} ui={ui}>
          {data.lecturers.map((l) => (
            <tr key={l.uid} className={`border-t ${ui.divider}`}>
              <td className={`${cell} font-semibold`}>{l.name}</td>
              <td className={`${cell} ${ui.sub}`}>{l.email || '—'}</td>
              <td className={cell}>{l.courseCount}</td>
              {billingEnabled && (
                <td className={cell}>
                  {l.hasSeat ? (
                    <button type="button" disabled={busy} className={ui.ghostBtn} aria-label={`Remove the seat from ${l.name}`} onClick={() => act(() => api.removeSeat(l.uid), `${l.name}'s seat was removed. Their courses stay open for the grace period.`)}>
                      Remove seat
                    </button>
                  ) : (
                    <button type="button" disabled={busy || !covered || seatsLeft <= 0} className={ui.primaryBtn} aria-label={`Give ${l.name} a seat`} onClick={() => act(() => api.assignSeat(l.uid), `${l.name} now has a seat.`)}>
                      Give seat
                    </button>
                  )}
                </td>
              )}
              <td className={cell}>
                <button
                  type="button"
                  disabled={busy}
                  className={ui.ghostBtn}
                  aria-label={`Remove ${l.name} from the college`}
                  onClick={() => {
                    if (window.confirm(`Remove ${l.name} from your college? Their seat is removed and they are signed out once.`)) {
                      act(() => api.removeLecturer(l.uid), `${l.name} was removed from the college.`);
                    }
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function CoursesTab({ data, ui }) {
  if (!data.courses.length) return <p className={`m-0 text-sm ${ui.sub}`}>No courses in your college yet. They appear when your lecturers create them.</p>;
  return (
    <div className="grid gap-2">
      <p className={`m-0 text-[13px] ${ui.sub}`}>Names and counts only. Course content, groups and grades stay with the lecturer and students.</p>
      <Table caption="Courses in your college" head={['Code', 'Title', 'Lecturer', 'Students', 'Projects', '']} ui={ui}>
        {data.courses.map((c) => (
          <tr key={c.id} className={`border-t ${ui.divider}`}>
            <td className={`${cell} font-semibold`}>{c.code}</td>
            <td className={cell}>{c.title}</td>
            <td className={cell}>{c.lecturerName}</td>
            <td className={cell}>{c.studentCount}</td>
            <td className={cell}>{c.projectCount}</td>
            <td className={`${cell} ${ui.sub}`}>{c.archived ? 'Archived' : ''}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export default function CollegeAdminConsole({ api, darkMode = false }) {
  const ui = courseTheme(darkMode);
  const load = useCallback(() => api.getCollege(), [api]);
  const { loading, error, data, reload, setData } = useLoad(load);
  const [tab, setTab] = useState('overview');

  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      ...(data?.billingEnabled ? [{ id: 'subscription', label: 'Subscription and payments' }] : []),
      { id: 'lecturers', label: 'Lecturers and seats' },
      { id: 'courses', label: 'Courses' },
    ],
    [data?.billingEnabled]
  );

  return (
    <div data-testid="college-admin-console" className={`p-4 sm:p-8 ${ui.txt}`}>
      <h1 className="m-0 mb-1.5 text-[26px] font-bold tracking-tight">{data?.college?.name || 'Your college'}</h1>
      <p className={`m-0 mb-5 text-[13px] ${ui.sub}`}>College admin: lecturers, seats and your college&apos;s plan.</p>

      {loading && !data ? (
        <p role="status" className={`m-0 text-sm ${ui.sub}`}>Loading your college…</p>
      ) : error ? (
        <div className="grid gap-3">
          <ErrorText error={error} ui={ui} />
          <div><button type="button" onClick={reload} className={ui.ghostBtn}>Try again</button></div>
        </div>
      ) : (
        <>
          <Tabs tabs={tabs} active={tab} onChange={setTab} label="College admin sections" ui={ui} />
          <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'overview' && <Overview data={data} ui={ui} darkMode={darkMode} />}
            {tab === 'subscription' && data.billingEnabled && <SubscriptionTab api={api} data={data} ui={ui} darkMode={darkMode} onChanged={reload} />}
            {tab === 'lecturers' && <LecturersTab api={api} data={data} ui={ui} darkMode={darkMode} onData={(fresh) => setData(() => fresh)} />}
            {tab === 'courses' && <CoursesTab data={data} ui={ui} />}
          </div>
        </>
      )}
    </div>
  );
}
