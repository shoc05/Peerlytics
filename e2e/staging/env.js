// Environment for the staging smoke tests (see playwright.config.js). Missing BASE_URL or
// API_URL fails the run instead of silently passing.
import { collabUrl } from '../../src/collab/collab.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Set ${name} for the staging E2E tests (see playwright.config.js).`);
  return value;
}

/** The website root with a trailing slash, e.g. https://owner.github.io/peerlytics/. */
export const BASE_URL = required('BASE_URL').replace(/\/*$/, '/');

/** The backend server without a trailing slash; a trailing /api is accepted too. */
export const API_URL = required('API_URL').replace(/\/+$/, '');

export const HEALTH_URL = /\/api$/.test(API_URL) ? `${API_URL}/health` : `${API_URL}/api/health`;

/** Same rule as the website: COLLAB_URL, otherwise wss://<API_URL host>/collab. */
export const COLLAB_URL = collabUrl({ VITE_COLLAB_URL: process.env.COLLAB_URL, VITE_API_URL: API_URL });

/** A Firebase ID token for the signed-in tests; empty skips them. No test accounts are created. */
export const E2E_TOKEN = String(process.env.E2E_TOKEN || '').trim();

/** The path part of BASE_URL, e.g. /peerlytics/. */
export const BASE_PATH = new URL(BASE_URL).pathname;
