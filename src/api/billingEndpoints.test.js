import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBillingApi } from './billingEndpoints.js';
import { createApi } from './endpoints.js';

function stubClient() {
  const calls = [];
  return {
    calls,
    request: async (url, { method = 'GET', body } = {}) => {
      calls.push({ method, url, body });
      return {};
    },
  };
}

test('each billing call goes to its route with the right method and body', async () => {
  const client = stubClient();
  const api = createBillingApi(client);
  await api.getMyBilling();
  await api.getCollege();
  await api.addLecturer('pema@rub.edu.bt');
  await api.removeLecturer('lect/1');
  await api.createPaymentRequest({ planId: 'p', paymentMethodId: 'm', amountNu: 10, journalNumber: 'J1234', paidOn: '2026-11-09', extra: 'dropped' });
  await api.assignSeat('lect-1');
  await api.removeSeat('lect-1');
  await api.listPaymentRequests('all');
  await api.rejectPaymentRequest('r1', 'Not in the statement');
  await api.grantSubscription('c1', { planId: 'p', note: 'Pilot term' });
  await api.extendSubscription('s1', { days: 10, reason: 'Bank delay' });
  await api.updateMethod('m1', false);
  assert.deepEqual(client.calls, [
    { method: 'GET', url: '/api/billing/me', body: undefined },
    { method: 'GET', url: '/api/college', body: undefined },
    { method: 'POST', url: '/api/college/lecturers', body: { email: 'pema@rub.edu.bt' } },
    { method: 'DELETE', url: '/api/college/lecturers/lect%2F1', body: undefined },
    { method: 'POST', url: '/api/college/payment-requests', body: { planId: 'p', paymentMethodId: 'm', amountNu: 10, journalNumber: 'J1234', paidOn: '2026-11-09' } },
    { method: 'POST', url: '/api/college/seats/lect-1', body: undefined },
    { method: 'DELETE', url: '/api/college/seats/lect-1', body: undefined },
    { method: 'GET', url: '/api/admin/billing/requests?status=all', body: undefined },
    { method: 'POST', url: '/api/admin/billing/requests/r1/reject', body: { reason: 'Not in the statement' } },
    { method: 'POST', url: '/api/admin/billing/colleges/c1/grants', body: { planId: 'p', note: 'Pilot term' } },
    { method: 'POST', url: '/api/admin/billing/subscriptions/s1/extend', body: { days: 10, reason: 'Bank delay' } },
    { method: 'PATCH', url: '/api/admin/billing/methods/m1', body: { isActive: false } },
  ]);
});

test('setUserRole sends a college only when there is one and the role can have it', async () => {
  const client = stubClient();
  const api = createApi(client);
  await api.setUserRole('u1', 'collegeAdmin', 'c1');
  await api.setUserRole('u1', 'lecturer');
  await api.setUserRole('u1', 'superAdmin', 'c1');
  assert.deepEqual(
    client.calls.map((c) => c.body),
    [{ role: 'collegeAdmin', collegeId: 'c1' }, { role: 'lecturer' }, { role: 'superAdmin' }]
  );
});
