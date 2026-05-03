import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SettingsProvider, useSettings } from './state/SettingsContext.jsx';
import { AuthProvider, useAuth } from './state/AuthContext.jsx';
import { fontFamilyFor, buildTheme } from './ui/theme.js';
import { BoardsHomePage } from './pages/BoardsHomePage.jsx';
import { BoardPage } from './pages/BoardPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { DepartmentPage } from './pages/DepartmentPage.jsx';
import { MyWorkPage } from './pages/MyWorkPage.jsx';
import { UserProfilePage } from './pages/UserProfilePage.jsx';
import {
  SignInScreen, SignUpScreen, ForgotScreen, ResetScreen,
  OtpScreen, EmailVerifyScreen, WorkspacePickerScreen,
} from './pages/auth-screens.jsx';
import { AcceptInvitePage } from './pages/AcceptInvite.jsx';
import { activeMembership, canManageWorkspace } from './state/permissions.js';

function ThemedRoot({ children }) {
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  React.useEffect(() => {
    document.body.style.background = theme.bg;
    document.body.style.color = theme.text;
    document.body.style.fontFamily = fontFamilyFor(s.rtl);
    document.documentElement.dir = s.rtl ? 'rtl' : 'ltr';
  }, [theme.bg, theme.text, s.rtl]);
  return children;
}

function AuthRoute({ children }) {
  const s = useSettings();
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {React.cloneElement(children, { themeName: s.themeName, accent: s.accent, rtl: s.rtl })}
    </div>
  );
}

function AuthLoading() {
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: theme.bg, color: theme.muted, fontSize: 13,
    }}>
      <span>Loading…</span>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AuthLoading />;
  if (status === 'guest') {
    return <Navigate to="/auth/signin" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

function GuestOnlyRoute({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <AuthLoading />;
  if (status === 'authed') return <Navigate to="/boards" replace />;
  return children;
}

function AdminOnlyRoute({ children }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'guest') return <Navigate to="/auth/signin" replace />;
  if (!canManageWorkspace(activeMembership(auth))) return <Navigate to="/boards" replace />;
  return children;
}

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <AuthProvider>
          <ThemedRoot>
            <Routes>
              <Route path="/" element={<Navigate to="/boards" replace />} />

              <Route path="/auth/signin"     element={<GuestOnlyRoute><AuthRoute><SignInScreen /></AuthRoute></GuestOnlyRoute>} />
              <Route path="/auth/signup"     element={<GuestOnlyRoute><AuthRoute><SignUpScreen /></AuthRoute></GuestOnlyRoute>} />
              <Route path="/auth/forgot"     element={<AuthRoute><ForgotScreen /></AuthRoute>} />
              <Route path="/auth/reset"      element={<AuthRoute><ResetScreen /></AuthRoute>} />
              <Route path="/auth/2fa"        element={<AuthRoute><OtpScreen /></AuthRoute>} />
              <Route path="/auth/verify"     element={<AuthRoute><EmailVerifyScreen /></AuthRoute>} />
              <Route path="/auth/workspace"  element={<ProtectedRoute><AuthRoute><WorkspacePickerScreen /></AuthRoute></ProtectedRoute>} />

              <Route path="/invite/:token" element={<AcceptInvitePage />} />

              <Route path="/boards"   element={<ProtectedRoute><BoardsHomePage /></ProtectedRoute>} />
              <Route path="/b/:id"    element={<ProtectedRoute><BoardPage /></ProtectedRoute>} />
              <Route path="/admin"    element={<AdminOnlyRoute><AdminPage /></AdminOnlyRoute>} />
              <Route path="/dept/:id" element={<ProtectedRoute><DepartmentPage /></ProtectedRoute>} />
              <Route path="/me"       element={<ProtectedRoute><MyWorkPage /></ProtectedRoute>} />
              <Route path="/u/:id"    element={<ProtectedRoute><UserProfilePage /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/auth/signin" replace />} />
            </Routes>
          </ThemedRoot>
        </AuthProvider>
      </BrowserRouter>
    </SettingsProvider>
  );
}
