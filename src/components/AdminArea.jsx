import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { addLicence, createCollege, listColleges, setUserRole } from '../api';
import { useAuth } from '../context/AuthContext';
import { getAllGroups, getAllUsers } from '../firebase/firestoreService';
import { useFlag } from '../flags/FlagsProvider';
import {
  collegeFormError,
  filterUsers,
  isSubmitted,
  licenceFormError,
  licencePayload,
  licenceStatus,
  namesFor,
  slugFromName,
} from '../utils/adminArea';
import { ROLES } from '../utils/authRole';
import AdminPanel from './AdminPanel';

const GREEN = '#1D9E75';
const STATUS_LABELS = {
  none: { text: 'No licence', color: '#9a9a9a' },
  upcoming: { text: 'Not started', color: '#4facfe' },
  active: { text: 'Active', color: GREEN },
  expired: { text: 'Expired', color: '#e74c3c' },
};
const EMPTY_LICENCE = { plan: 'trial', seats: '', monthlyAiBudgetUsd: '0', startsOn: '', endsOn: '' };

function palette(darkMode) {
  return {
    card: darkMode ? '#1a1a1a' : '#fff',
    border: darkMode ? '#2e2e2e' : '#e0e0e0',
    text: darkMode ? '#ededed' : '#1a1a1a',
    sub: darkMode ? '#9a9a9a' : '#666',
    input: darkMode ? '#111' : '#fff',
  };
}

function Heading({ title, subtitle, colors }) {
  return (
    <>
      <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 700 }}>{title}</h1>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: colors.sub }}>{subtitle}</p>
    </>
  );
}

function ErrorBox({ children }) {
  return (
    <div role="alert" style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c', fontSize: 13 }}>
      {children}
    </div>
  );
}

function Message({ children, colors }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: colors.sub, background: colors.card, borderRadius: 12, border: `1px solid ${colors.border}` }}>
      {children}
    </div>
  );
}

function Field({ label, colors, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.sub, flex: '1 1 150px' }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle = (colors) => ({
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: colors.input,
  color: colors.text,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
});

const primaryButton = (disabled) => ({
  padding: '9px 16px',
  borderRadius: 8,
  border: 'none',
  background: GREEN,
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

/** Loads Firestore data for a tab: { loading, error, data, setData }. */
function useLoad(load) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: '', data });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message || 'Could not load this page.', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);
  const setData = useCallback((update) => setState((s) => ({ ...s, data: update(s.data) })), []);
  return { ...state, setData };
}

function UsersTab({ colors }) {
  const { user: me } = useAuth();
  const { loading, error, data: users, setData } = useLoad(getAllUsers);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const visible = useMemo(() => filterUsers(users || [], search), [users, search]);

  async function changeRole(target, role) {
    const uid = target.uid || target.id;
    if (role === target.role) return;
    const name = target.name || target.email || uid;
    if (!window.confirm(`Change ${name} to ${role}? They will be signed out and must sign in again.`)) return;
    setBusyId(uid);
    setActionError('');
    try {
      await setUserRole(uid, role);
      setData((list) => list.map((u) => ((u.uid || u.id) === uid ? { ...u, role } : u)));
    } catch (err) {
      setActionError(err.message || 'Could not change the role.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Heading title="Users and roles" subtitle="Everyone with an account. Changing a role signs that person out. You cannot change your own role." colors={colors} />
      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {loading ? (
        <Message colors={colors}>Loading users…</Message>
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : (
        <>
          <input
            type="search"
            aria-label="Search users by name or email"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle(colors), marginBottom: 16, maxWidth: 360 }}
          />
          {!visible.length ? (
            <Message colors={colors}>No users match.</Message>
          ) : (
            <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: colors.sub, textAlign: 'left' }}>
                    <th style={{ padding: '10px 18px', fontWeight: 600 }}>Name</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 18px', fontWeight: 600 }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => {
                    const uid = u.uid || u.id;
                    const isMe = uid === me?.uid;
                    return (
                      <tr key={uid} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '10px 18px' }}>{u.name || '—'}{isMe && <span style={{ color: colors.sub }}> (you)</span>}</td>
                        <td style={{ padding: '10px 12px', color: colors.sub }}>{u.email || '—'}</td>
                        <td style={{ padding: '10px 18px' }}>
                          <select
                            aria-label={`Role for ${u.name || u.email || uid}`}
                            value={ROLES.includes(u.role) ? u.role : ''}
                            disabled={isMe || busyId === uid}
                            onChange={(e) => changeRole(u, e.target.value)}
                            style={{ ...inputStyle(colors), width: 'auto' }}
                          >
                            {!ROLES.includes(u.role) && <option value="" disabled>No role</option>}
                            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

const loadWorkspaces = async () => {
  const [groups, users] = await Promise.all([getAllGroups(), getAllUsers()]);
  return { groups, users };
};

function WorkspacesTab({ colors }) {
  const { loading, error, data } = useLoad(loadWorkspaces);
  const userById = useMemo(() => Object.fromEntries((data?.users || []).map((u) => [u.uid || u.id, u])), [data]);

  return (
    <>
      <Heading title="Workspaces" subtitle="Every group and its people. Read-only: admins do not change workspaces or their contents." colors={colors} />
      {loading ? (
        <Message colors={colors}>Loading workspaces…</Message>
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : !data.groups.length ? (
        <Message colors={colors}>There are no workspaces yet.</Message>
      ) : (
        <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: colors.sub, textAlign: 'left' }}>
                <th style={{ padding: '10px 18px', fontWeight: 600 }}>Workspace</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Students</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Lecturers</th>
                <th style={{ padding: '10px 18px', fontWeight: 600 }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '10px 18px', fontWeight: 600 }}>{g.name || g.id}</td>
                  <td style={{ padding: '10px 12px', color: colors.sub }}>{namesFor(g.memberIds, userById).join(', ') || '—'}</td>
                  <td style={{ padding: '10px 12px', color: colors.sub }}>{namesFor(g.lecturerIds, userById).join(', ') || '—'}</td>
                  <td style={{ padding: '10px 18px' }}>{isSubmitted(g) ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewCollegeForm({ colors, onCreated }) {
  const [form, setForm] = useState({ name: '', slug: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const problem = collegeFormError(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      onCreated(await createCollege({ name: form.name.trim(), slug: form.slug }));
      setForm({ name: '', slug: '' });
      setSlugEdited(false);
    } catch (err) {
      setError(err.message || 'Could not add the college.');
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <form onSubmit={submit} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <strong style={{ fontSize: 15 }}>Add a college</strong>
      {error && <div style={{ marginTop: 12 }}><ErrorBox>{error}</ErrorBox></div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <Field label="College name" colors={colors}>
          <input
            value={form.name}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ name: e.target.value, slug: slugEdited ? f.slug : slugFromName(e.target.value) }))}
            style={inputStyle(colors)}
          />
        </Field>
        <Field label="Short name" colors={colors}>
          <input
            value={form.slug}
            maxLength={40}
            onChange={(e) => {
              setSlugEdited(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
            }}
            style={inputStyle(colors)}
          />
        </Field>
        <button type="submit" disabled={busy} style={primaryButton(busy)}>{busy ? 'Adding…' : 'Add college'}</button>
      </div>
    </form>
  );
}

function LicenceForm({ college, colors, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_LICENCE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problem = licenceFormError(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      onSaved(await addLicence(college.id, licencePayload(form)));
    } catch (err) {
      setError(err.message || 'Could not save the licence.');
      setBusy(false);
    }
    return undefined;
  }

  return (
    <form onSubmit={submit} style={{ borderTop: `1px solid ${colors.border}`, padding: 18 }}>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Plan" colors={colors}>
          <select value={form.plan} onChange={set('plan')} style={inputStyle(colors)}>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
          </select>
        </Field>
        <Field label="Seats" colors={colors}>
          <input type="number" min="1" step="1" value={form.seats} onChange={set('seats')} style={inputStyle(colors)} />
        </Field>
        <Field label="Monthly AI budget (US$)" colors={colors}>
          <input type="number" min="0" step="0.01" value={form.monthlyAiBudgetUsd} onChange={set('monthlyAiBudgetUsd')} style={inputStyle(colors)} />
        </Field>
        <Field label="Starts" colors={colors}>
          <input type="date" value={form.startsOn} onChange={set('startsOn')} style={inputStyle(colors)} />
        </Field>
        <Field label="Ends (optional)" colors={colors}>
          <input type="date" value={form.endsOn} onChange={set('endsOn')} style={inputStyle(colors)} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" disabled={busy} style={primaryButton(busy)}>{busy ? 'Saving…' : 'Save licence'}</button>
        <button type="button" onClick={onCancel} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.text, fontSize: 13, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const loadColleges = () => listColleges().then((r) => r.colleges);

function LicencesTab({ colors }) {
  const { loading, error, data: colleges, setData } = useLoad(loadColleges);
  const [editingId, setEditingId] = useState(null);

  return (
    <>
      <Heading
        title="Colleges and licences"
        subtitle="A licence records a college's plan, seats, AI budget and dates. It does not limit anything yet, and there are no online payments."
        colors={colors}
      />
      {loading ? (
        <Message colors={colors}>Loading colleges…</Message>
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : (
        <>
          <NewCollegeForm colors={colors} onCreated={(college) => setData((list) => [...list, college].sort((a, b) => a.name.localeCompare(b.name)))} />
          {!colleges.length ? (
            <Message colors={colors}>There are no colleges yet.</Message>
          ) : colleges.map((college) => {
            const { licence } = college;
            const status = STATUS_LABELS[licenceStatus(licence)];
            return (
              <div key={college.id} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 18px' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{college.name}</strong>
                    <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: status.color }}>{status.text}</span>
                    <div style={{ fontSize: 12, color: colors.sub, marginTop: 4 }}>
                      {licence
                        ? `${licence.plan === 'standard' ? 'Standard' : 'Trial'} · ${licence.seats} seats · US$${licence.monthlyAiBudgetUsd} a month · ${licence.startsOn} to ${licence.endsOn || 'no end date'}`
                        : college.slug}
                    </div>
                  </div>
                  {editingId !== college.id && (
                    <button type="button" onClick={() => setEditingId(college.id)} style={primaryButton(false)}>
                      {licence ? 'New licence' : 'Add licence'}
                    </button>
                  )}
                </div>
                {editingId === college.id && (
                  <LicenceForm
                    college={college}
                    colors={colors}
                    onCancel={() => setEditingId(null)}
                    onSaved={(saved) => {
                      setEditingId(null);
                      // The latest start date is the current licence, the same rule as the backend.
                      setData((list) => list.map((c) => (
                        c.id === college.id && (!c.licence || saved.startsOn >= c.licence.startsOn) ? { ...c, licence: saved } : c
                      )));
                    }}
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

// The superAdmin's page: the grading audit plus users, workspaces and, behind licensing_enabled,
// colleges and licences.
export default function AdminArea({ darkMode }) {
  const licensingOn = useFlag('licensing_enabled');
  const [tab, setTab] = useState('grading');
  const colors = palette(darkMode);

  const tabs = [
    { id: 'grading', label: 'Grading oversight' },
    { id: 'users', label: 'Users and roles' },
    { id: 'workspaces', label: 'Workspaces' },
    ...(licensingOn ? [{ id: 'licences', label: 'Colleges and licences' }] : []),
  ];

  return (
    <div style={{ color: colors.text }}>
      <div role="tablist" aria-label="Admin sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24, borderBottom: `1px solid ${colors.border}` }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              padding: '10px 14px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === id ? GREEN : 'transparent'}`,
              color: tab === id ? colors.text : colors.sub,
              fontWeight: tab === id ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'grading' && <AdminPanel darkMode={darkMode} />}
      {tab === 'users' && <UsersTab colors={colors} />}
      {tab === 'workspaces' && <WorkspacesTab colors={colors} />}
      {tab === 'licences' && licensingOn && <LicencesTab colors={colors} />}
    </div>
  );
}
