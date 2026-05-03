import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useSettings } from '../state/SettingsContext.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { buildTheme } from '../ui/theme.js';
import { api, setAccessToken, setRefreshToken } from '../lib/api.js';

export function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const s = useSettings();
  const auth = useAuth();
  const theme = buildTheme(s.themeName, s.accent);
  const rtl = s.rtl;

  const [info, setInfo] = React.useState({ status: 'loading', data: null, error: null });
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [accepting, setAccepting] = React.useState(false);
  const [acceptError, setAcceptError] = React.useState(null);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/invites/${token}/info`);
        if (!cancelled) setInfo({ status: 'ready', data, error: null });
      } catch (err) {
        if (!cancelled) setInfo({ status: 'error', data: null, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    setAccepting(true); setAcceptError(null);
    try {
      const body = info.data?.userExists ? {} : { firstName, lastName, password };
      const resp = await api(`/invites/${token}/accept`, { method: 'POST', body });
      // Drop tokens from accept response into the API client
      setAccessToken(resp.accessToken);
      setRefreshToken(resp.refreshToken);
      // Soft refresh the auth context by reloading; simplest reliable path
      window.location.href = '/boards';
    } catch (err) {
      setAcceptError(err.message);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40,
    }}>
      <div style={{
        position: 'fixed', top: 16, insetInlineEnd: 16, zIndex: 30,
      }}>
        <div style={{
          display: 'flex', background: theme.surface,
          border: `.5px solid ${theme.border}`,
          borderRadius: 7, padding: 2, boxShadow: theme.shadow,
          direction: 'ltr',
        }}>
          {[{ v: false, l: 'EN' }, { v: true, l: 'ع' }].map((o) => {
            const active = s.rtl === o.v;
            return (
              <button key={o.l} onClick={() => s.set('rtl', o.v)} style={{
                padding: '5px 10px', minWidth: 32, border: 'none',
                cursor: active ? 'default' : 'pointer',
                background: active ? theme.accentSoft : 'transparent',
                color: active ? theme.accent : theme.muted,
                borderRadius: 5, fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}>{o.l}</button>
            );
          })}
        </div>
      </div>
      <div style={{
        background: theme.surface, color: theme.text,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius, padding: '32px 30px',
        boxShadow: theme.shadow, width: 460, maxWidth: '100%',
      }}>
        {info.status === 'loading' && (
          <div style={{ textAlign: 'center', color: theme.muted, padding: 40 }}>
            {rtl ? 'جاري التحقق من الدعوة…' : 'Verifying invite…'}
          </div>
        )}

        {info.status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 48,
              background: '#FEE2E2', color: '#DC2626',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, marginBottom: 14,
            }}>!</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
              {rtl ? 'الدعوة غير صالحة' : 'Invite invalid'}
            </h1>
            <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px' }}>
              {info.error?.message}
            </p>
            <Link to="/auth/signin" style={{
              display: 'inline-block', padding: '10px 18px', borderRadius: theme.cardRadius,
              background: theme.accent, color: theme.accentText, textDecoration: 'none',
              fontSize: 13, fontWeight: 600,
            }}>{rtl ? 'الرجوع للدخول' : 'Back to sign in'}</Link>
          </div>
        )}

        {info.status === 'ready' && info.data && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 12,
              background: `oklch(.86 .14 ${info.data.workspace.hue})`,
              color: `oklch(.32 .16 ${info.data.workspace.hue})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, marginBottom: 16,
            }}>{info.data.workspace.name[0]}</div>

            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
              {rtl ? `انضم إلى ${info.data.workspace.name}` : `Join ${info.data.workspace.name}`}
            </h1>
            <p style={{ fontSize: 13.5, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
              {info.data.invitedBy
                ? (rtl ? `${info.data.invitedBy} دعاك للانضمام كـ ` : `${info.data.invitedBy} invited you to join as `)
                : (rtl ? 'تمت دعوتك للانضمام كـ ' : 'You were invited to join as ')}
              <strong style={{ color: theme.text }}>{info.data.role}</strong>.
            </p>

            <div style={{
              padding: '10px 14px', marginBottom: 20,
              background: theme.bg, border: `.5px solid ${theme.border}`,
              borderRadius: theme.cardRadius, fontSize: 12.5, color: theme.muted,
            }}>
              <strong style={{ color: theme.text }}>{info.data.email}</strong>
            </div>

            {info.data.userExists ? (
              <>
                {auth.status === 'authed' && auth.user?.email !== info.data.email && (
                  <div style={{
                    padding: '10px 12px', marginBottom: 14,
                    background: '#FEF3C7', color: '#92400E', borderRadius: theme.cardRadius,
                    fontSize: 12,
                  }}>
                    {rtl ? `أنت مسجل دخول حاليًا بـ ${auth.user.email}. اقبل الدعوة لإضافة هذه المساحة.` : `You're signed in as ${auth.user.email}. Accepting will add this workspace.`}
                  </div>
                )}
                <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 18px' }}>
                  {rtl ? 'لديك حساب موجود بالفعل بهذا البريد. اقبل لإضافة المساحة لحسابك.' : 'You already have an account with this email. Accept to add the workspace.'}
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 0 12px' }}>
                  {rtl ? 'أكمل بياناتك لإنشاء حسابك:' : 'Complete your account:'}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    placeholder={rtl ? 'الاسم الأول' : 'First name'}
                    style={inputStyle(theme)} />
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)}
                    placeholder={rtl ? 'العائلة' : 'Last name'}
                    style={inputStyle(theme)} />
                </div>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={rtl ? 'كلمة المرور (٨ أحرف على الأقل)' : 'Password (min 8 chars)'}
                  style={{ ...inputStyle(theme), marginBottom: 16 }} />
              </>
            )}

            {acceptError && (
              <div style={{
                padding: '8px 12px', marginBottom: 14,
                background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
                fontSize: 12.5, fontWeight: 500,
              }}>{acceptError}</div>
            )}

            <button onClick={accept} disabled={accepting || (!info.data.userExists && (!firstName || !lastName || password.length < 8))}
              style={{
                width: '100%', padding: '11px 18px',
                background: theme.accent, color: theme.accentText, border: 'none',
                borderRadius: theme.cardRadius, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                opacity: accepting ? 0.7 : 1,
              }}>
              {accepting ? '…' : (rtl ? 'قبول الدعوة' : 'Accept invite')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function inputStyle(theme) {
  return {
    width: '100%', padding: '10px 12px',
    background: theme.bg, color: theme.text,
    border: `1px solid ${theme.border}`, borderRadius: theme.cardRadius,
    fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
  };
}
