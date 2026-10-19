import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAuthError } from './authErrors.js';

test('Google sign-in failures get a readable message', () => {
  assert.equal(mapAuthError({ code: 'auth/popup-closed-by-user' }), 'Google sign-in was closed before it finished.');
  assert.equal(mapAuthError({ code: 'auth/cancelled-popup-request' }), 'Google sign-in was closed before it finished.');
  assert.match(mapAuthError({ code: 'auth/popup-blocked' }), /blocked the Google sign-in window/);
  assert.match(mapAuthError({ code: 'auth/unauthorized-domain' }), /not allowed on this website address/);
  assert.match(mapAuthError({ code: 'auth/operation-not-allowed' }), /not enabled in Firebase Console/);
});

test('one account per email: a Google sign-in for a password account says how to recover', () => {
  assert.match(mapAuthError({ code: 'auth/account-exists-with-different-credential' }), /Sign in with your password first/);
});

test('unknown errors fall back to the error message, then a generic one', () => {
  assert.equal(mapAuthError(new Error('Boom')), 'Boom');
  assert.equal(mapAuthError(null), 'Something went wrong. Please try again.');
});
