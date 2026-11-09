// Billing and college calls (backend/src/billing/routes.js, docs/billing.md). No Firebase imports,
// so they run under `node --test` with a stubbed client.

const id = (value) => encodeURIComponent(value);

export function createBillingApi(client) {
  const get = (path) => client.request(path);
  const post = (path, body) => client.request(path, { method: 'POST', body });

  return {
    // ── Anyone ──
    /** { billingEnabled, coverage } — coverage is only set for a lecturer while billing is on. */
    getMyBilling: () => get('/api/billing/me'),

    // ── collegeAdmin ──
    /** { college, billingEnabled, billing, lecturers, courses } for the admin's own college. */
    getCollege: () => get('/api/college'),
    addLecturer: (email) => post('/api/college/lecturers', { email }),
    removeLecturer: (uid) => client.request(`/api/college/lecturers/${id(uid)}`, { method: 'DELETE' }),
    /** { plans, methods, payTo, requests } */
    getCollegeBilling: () => get('/api/college/billing'),
    createPaymentRequest: ({ planId, paymentMethodId, amountNu, journalNumber, paidOn }) =>
      post('/api/college/payment-requests', { planId, paymentMethodId, amountNu, journalNumber, paidOn }),
    cancelMyPaymentRequest: (requestId) => post(`/api/college/payment-requests/${id(requestId)}/cancel`),
    assignSeat: (uid) => post(`/api/college/seats/${id(uid)}`),
    removeSeat: (uid) => client.request(`/api/college/seats/${id(uid)}`, { method: 'DELETE' }),

    // ── superAdmin ──
    listPlans: () => get('/api/admin/billing/plans'),
    createPlan: (plan) => post('/api/admin/billing/plans', plan),
    updatePlan: (planId, changes) => client.request(`/api/admin/billing/plans/${id(planId)}`, { method: 'PATCH', body: changes }),
    listMethods: () => get('/api/admin/billing/methods'),
    createMethod: (name) => post('/api/admin/billing/methods', { name }),
    updateMethod: (methodId, isActive) => client.request(`/api/admin/billing/methods/${id(methodId)}`, { method: 'PATCH', body: { isActive } }),
    getPaymentSettings: () => get('/api/admin/billing/settings'),
    savePaymentSettings: (settings) => client.request('/api/admin/billing/settings', { method: 'PUT', body: settings }),
    listPaymentRequests: (status = 'pending') => get(`/api/admin/billing/requests?status=${id(status)}`),
    approvePaymentRequest: (requestId) => post(`/api/admin/billing/requests/${id(requestId)}/approve`),
    rejectPaymentRequest: (requestId, reason) => post(`/api/admin/billing/requests/${id(requestId)}/reject`, { reason }),
    listBillingColleges: () => get('/api/admin/billing/colleges'),
    grantSubscription: (collegeId, { planId, days, note }) => post(`/api/admin/billing/colleges/${id(collegeId)}/grants`, { planId, ...(days ? { days } : {}), note }),
    extendSubscription: (subscriptionId, { days, reason }) => post(`/api/admin/billing/subscriptions/${id(subscriptionId)}/extend`, { days, reason }),
    revokeSubscription: (subscriptionId, reason) => post(`/api/admin/billing/subscriptions/${id(subscriptionId)}/revoke`, { reason }),
  };
}
