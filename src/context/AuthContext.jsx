import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { subscribeAuth } from '../firebase/authService';
import { getUserProfile } from '../firebase/firestoreService';

const AuthContext = createContext(null);

export function profileToUser(profile) {
  if (!profile) return null;
  return {
    uid: profile.uid || profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    groupId: profile.groupId,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyProfile = useCallback((profile) => {
    const next = profileToUser(profile);
    if (next) setUser(next);
    return next;
  }, []);

  const refreshProfile = useCallback(async (uid) => {
    const profile = await getUserProfile(uid);
    if (profile) {
      applyProfile(profile);
    }
    return profile;
  }, [applyProfile]);

  useEffect(() => {
    const unsub = subscribeAuth(async (fbUser) => {
      if (fbUser) {
        try {
          const profile = await getUserProfile(fbUser.uid);
          if (profile) {
            applyProfile(profile);
          } else {
            setUser({
              uid: fbUser.uid,
              email: fbUser.email || '',
              name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
              role: 'student',
              groupId: null,
            });
          }
        } catch {
          setUser({
            uid: fbUser.uid,
            email: fbUser.email || '',
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            role: 'student',
            groupId: null,
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [applyProfile]);

  const value = {
    user,
    loading,
    setUser,
    applyProfile,
    refreshProfile,
    isLecturer: user?.role === 'lecturer',
    isStudent: user?.role === 'student',
    // Admin (set manually as role:'admin' in Firestore) audits how lecturers grade.
    isAdmin: user?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
