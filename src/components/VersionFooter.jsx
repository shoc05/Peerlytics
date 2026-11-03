import React from 'react';
import { appVersion } from '../utils/appVersion';

const VERSION = appVersion(import.meta.env);

/** A small fixed "Version …" line on every page, so deploy screenshots show the live build. */
export default function VersionFooter() {
  return (
    <footer
      data-testid="app-version"
      aria-label="App version"
      style={{
        position: 'fixed',
        right: 8,
        bottom: 4,
        zIndex: 1,
        fontSize: 11,
        color: 'rgba(100, 116, 139, 0.85)',
        pointerEvents: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      Version {VERSION}
    </footer>
  );
}
