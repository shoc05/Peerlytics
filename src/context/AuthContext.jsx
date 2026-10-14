import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadSessionUser, subscribeAuth } from '../firebase/authService';
import { getFirebaseAuth } from '../firebase/config';
import { buildSessionUser, roleFlags } from '../utils/authRole';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Login/Signup/RolePicker pass the session user they already loaded.
  const applyProfile = useCallback((sessionUser) => {
    if (sessionUser) setUser(sessionUser);
    return sessionUser;
  }, []);

  // Re-read the profile (and the token, when forceRefresh) for the signed-in user.
  const refreshProfile = useCallback(async ({ forceRefresh = false } = {}) => {
    const fbUser = getFirebaseAuth()?.currentUser;
    if (!fbUser) return null;
    const next = await loadSessionUser(fbUser, { forceRefresh });
    setUser(next);
    return next;
  }, []);

  useEffect(() => {
    const unsub = subscribeAuth(async (fbUser) => {
      if (fbUser) {
        try {
          setUser(await loadSessionUser(fbUser));
        } catch {
          // Profile unreadable: keep the user signed in but never assume a role.
          setUser(buildSessionUser({ fbUser, claims: {}, profile: null }));
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const value = {
    user,
    loading,
    setUser,
    applyProfile,
    refreshProfile,
    ...roleFlags(user ? user.role : undefined),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
