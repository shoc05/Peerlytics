import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import FirebaseGate from './components/FirebaseGate';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import GuestRoute from './components/GuestRoute';
import Login from './components/Login';
import Signup from './components/Signup';
import PeerlyticsDashboard from './components/peerlytics-app';

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseGate>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
            <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <PeerlyticsDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </FirebaseGate>
    </ErrorBoundary>
  );
}
