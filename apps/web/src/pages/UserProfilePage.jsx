import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { buildTheme } from '../ui/theme.js';
import { api, setup2FA, enable2FA, disable2FA, regenerateBackupCodes, resendVerificationEmail, changePassword } from '../lib/api.js';
import { localizedName } from '../lib/i18n.js';
import { formatRelative } from '../lib/normalize.js';
import { LoadingScreen, StateScreen } from '../ui/States.jsx';
import { RoleBadge } from './role-views.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export function UserProfilePage() {
  const { id } = useParams();
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  const rtl = s.rtl;

  return (
    <AppShell>
      <ProfileBody theme={theme} rtl={rtl} userId={id} />
    </AppShell>
  );
}

function ProfileBody({ theme, rtl, userId }) {
  const [profile, setProfile] = React.useState({ status: 'loading', data: null, error: null });
  const [kpis, setKpis] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setProfile({ status: 'loading', data: null, error: null });
    setKpis(null);
    (async () => {
      try {
        const [p, k] = await Promise.all([
          api(`/users/${userId}/profile`),
          api(`/users/${userId}/kpis`),
        ]);
        if (cancelled) return;
        setProfile({ status: 'ready', data: p, error: null });
        setKpis(k);
      } catch (err) {
        if (!cancelled) setProfile({ status: 'error', data: null, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (profile.status === 'loading') return <LoadingScreen theme={theme} rtl={rtl} />;
  if (profile.status === 'error') {
    const isForbidden = profile.error?.status === 403;
    return (
      <StateScreen
        theme={theme}
        title={isForbidden ? (rtl ? 'لا تملك صلاحية' : 'No access')
          : (rtl ? 'تعذّر تحميل الملف' : 'Could not load profile')}
        body={isForbidden
          ? (rtl ? 'هذا الملف خارج نطاق صلاحياتك.' : 'You don’t have permission to view this profile.')
          : (profile.error?.message || '')}
        accent="muted"
      />
    );
  }
  const data = profile.data;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr', overflow: 'auto',
    }}>
      <ProfileHeader theme={theme} rtl={rtl} data={data} />
      <KPIGrid theme={theme} rtl={rtl} kpis={kpis} />
      {data.isSelf && <SecurityPanel theme={theme} rtl={rtl} />}
      <TasksPanel theme={theme} rtl={rtl} userId={userId} isSelf={data.isSelf} />
    </div>
  );
}

function SecurityPanel({ theme, rtl }) {
  const auth = useAuth();
  const u = auth.user;
  // Re-fetched on changes so the panel reflects the latest server state.
  const [tick, setTick] = React.useState(0);
  const [me, setMe] = React.useState(u);
  React.useEffect(() => {
    let cancelled = false;
    api('/auth/me').then((r) => { if (!cancelled) setMe(r.user); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  return (
    <div style={{
      margin: '20px 32px 0',
      padding: '16px 18px',
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, marginBottom: 14 }}>
        {rtl ? 'الأمان' : 'Security'}
      </div>
      <EmailVerifyRow theme={theme} rtl={rtl} me={me} onChange={refresh} />
      <div style={{ height: 1, background: theme.border, margin: '12px -2px' }} />
      <ChangePasswordRow theme={theme} rtl={rtl} />
      <div style={{ height: 1, background: theme.border, margin: '12px -2px' }} />
      <TwoFactorRow theme={theme} rtl={rtl} me={me} onChange={refresh} />
    </div>
  );
}

function ChangePasswordRow({ theme, rtl }) {
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [done, setDone] = React.useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (next !== confirm) { setErr(rtl ? 'كلمتا المرور غير متطابقتين' : 'New passwords don’t match'); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => { setDone(false); setOpen(false); }, 2000);
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
            {rtl ? 'كلمة المرور' : 'Password'}
          </div>
          <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 2 }}>
            {rtl ? 'تغيير كلمة المرور سيُسجّل خروجك من جميع الأجهزة الأخرى.' : 'Changing your password signs you out everywhere else.'}
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} style={{
          padding: '6px 12px', borderRadius: 6,
          background: open ? theme.surface2 : theme.accent,
          color: open ? theme.text : theme.accentText,
          border: open ? `.5px solid ${theme.border}` : 'none',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>{open ? (rtl ? 'إلغاء' : 'Cancel') : (rtl ? 'تغيير' : 'Change')}</button>
      </div>

      {open && (
        <form onSubmit={submit} style={{
          marginTop: 12, padding: 14,
          background: theme.bg, border: `.5px solid ${theme.border}`,
          borderRadius: theme.cardRadius,
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380,
        }}>
          <PasswordInput theme={theme} rtl={rtl} value={current} onChange={setCurrent}
            placeholder={rtl ? 'كلمة المرور الحالية' : 'Current password'} autoFocus />
          <PasswordInput theme={theme} rtl={rtl} value={next} onChange={setNext}
            placeholder={rtl ? 'كلمة المرور الجديدة' : 'New password'} />
          <PasswordInput theme={theme} rtl={rtl} value={confirm} onChange={setConfirm}
            placeholder={rtl ? 'تأكيد كلمة المرور الجديدة' : 'Confirm new password'} />
          {err && (
            <div style={{ fontSize: 11.5, color: '#DC2626' }}>{err}</div>
          )}
          {done && (
            <div style={{ fontSize: 11.5, color: '#0E7C66' }}>
              {rtl ? '✓ تم تحديث كلمة المرور' : '✓ Password updated'}
            </div>
          )}
          <button type="submit" disabled={busy || !current || !next || !confirm} style={{
            padding: '7px 14px', borderRadius: 6,
            background: theme.accent, color: theme.accentText,
            border: 'none', fontSize: 12.5, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            // Inherited `direction: rtl` already mirrors flex-end to the inline
            // end — don't manually flip (that double-flips it to the wrong side).
            alignSelf: 'flex-end',
          }}>{busy ? '…' : (rtl ? 'تحديث' : 'Update')}</button>
        </form>
      )}
    </div>
  );
}

function PasswordInput({ theme, rtl, value, onChange, placeholder, autoFocus }) {
  return (
    <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} autoFocus={autoFocus}
      style={{
        padding: '8px 10px', fontSize: 13,
        background: theme.surface, color: theme.text,
        border: `1px solid ${theme.border}`, borderRadius: 6,
        outline: 'none', fontFamily: 'inherit',
        direction: rtl ? 'rtl' : 'ltr',
      }} />
  );
}

function EmailVerifyRow({ theme, rtl, me, onChange }) {
  const [busy, setBusy] = React.useState(false);
  const [sentNote, setSentNote] = React.useState(null);
  const verified = !!me?.emailVerified;
  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setSentNote(null);
    try {
      const r = await resendVerificationEmail();
      setSentNote(r.alreadyVerified
        ? (rtl ? 'البريد مفعّل بالفعل.' : 'Email is already verified.')
        : (rtl ? 'تم إرسال رابط جديد.' : 'A new link was sent.'));
      if (r.alreadyVerified) onChange?.();
    } catch (err) {
      alert(err.message);
    } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
          {rtl ? 'تفعيل البريد الإلكتروني' : 'Email verification'}
        </div>
        <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 2 }}>
          {verified
            ? (rtl ? `مفعّل · ${me.email}` : `Verified · ${me.email}`)
            : (rtl ? 'لم يتم تفعيل بريدك بعد.' : 'Your email is not verified yet.')}
          {sentNote && <span style={{ marginInlineStart: 8, color: theme.accent }}>· {sentNote}</span>}
        </div>
      </div>
      {verified ? (
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          background: '#0E7C66', color: '#fff', fontSize: 11, fontWeight: 700,
        }}>✓ {rtl ? 'مفعّل' : 'Verified'}</span>
      ) : (
        <button onClick={resend} disabled={busy} style={{
          padding: '6px 12px', borderRadius: 6,
          background: theme.accent, color: theme.accentText,
          border: 'none', fontSize: 12, fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
        }}>{busy ? '…' : (rtl ? 'إعادة الإرسال' : 'Resend link')}</button>
      )}
    </div>
  );
}

function TwoFactorRow({ theme, rtl, me, onChange }) {
  const enabled = !!me?.twoFactorEnabled;
  const [step, setStep] = React.useState('idle'); // 'idle'|'setup'|'enabling'|'showCodes'|'disabling'
  const [setupData, setSetupData] = React.useState(null); // { secret, otpauth, qrDataUrl }
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [backupCodes, setBackupCodes] = React.useState(null);

  const startSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await setup2FA();
      setSetupData(r);
      setCode('');
      setStep('setup');
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  const finishEnable = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await enable2FA(setupData.secret, code);
      setBackupCodes(r.backupCodes);
      setStep('showCodes');
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const startDisable = () => {
    setStep('disabling');
    setCode('');
    setError(null);
  };

  const finishDisable = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await disable2FA(code);
      setStep('idle');
      setCode('');
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await regenerateBackupCodes();
      setBackupCodes(r.backupCodes);
      setStep('showCodes');
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
            {rtl ? 'التحقق بخطوتين (2FA)' : 'Two-factor authentication'}
          </div>
          <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 2 }}>
            {enabled
              ? (rtl ? 'مفعّل · تطبيق المصادقة + رموز نسخ احتياطي' : 'Enabled · authenticator app + backup codes')
              : (rtl ? 'احمِ حسابك بطبقة إضافية باستخدام تطبيق المصادقة.' : 'Protect your account with an authenticator app.')}
          </div>
        </div>
        {enabled ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={regenerate} disabled={busy} style={{
              padding: '6px 12px', borderRadius: 6,
              background: theme.surface2, color: theme.text,
              border: `.5px solid ${theme.border}`, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'رموز جديدة' : 'New codes'}</button>
            <button onClick={startDisable} style={{
              padding: '6px 12px', borderRadius: 6,
              background: 'transparent', color: '#DC2626',
              border: `.5px solid #FCA5A5`, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'تعطيل' : 'Disable'}</button>
          </div>
        ) : (
          <button onClick={startSetup} disabled={busy} style={{
            padding: '6px 12px', borderRadius: 6,
            background: theme.accent, color: theme.accentText,
            border: 'none', fontSize: 12, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>{busy ? '…' : (rtl ? 'تفعيل' : 'Enable')}</button>
        )}
      </div>

      {step === 'setup' && setupData && (
        <div style={{
          marginTop: 14, padding: 14,
          background: theme.bg, border: `.5px solid ${theme.border}`,
          borderRadius: theme.cardRadius,
          display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'center',
        }}>
          <img src={setupData.qrDataUrl} alt="2FA QR" style={{ width: 180, height: 180, borderRadius: 6 }} />
          <div>
            <div style={{ fontSize: 12.5, color: theme.text, marginBottom: 6 }}>
              {rtl ? '١. امسح الرمز بتطبيق المصادقة (Google Authenticator، Authy، 1Password…)' : '1. Scan with your authenticator (Google Authenticator, Authy, 1Password…)'}
            </div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 10, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
              {rtl ? 'أو أدخل السرّ يدويًا: ' : 'Or enter the secret manually: '}
              <strong style={{ color: theme.text }}>{setupData.secret}</strong>
            </div>
            <div style={{ fontSize: 12.5, color: theme.text, marginBottom: 6 }}>
              {rtl ? '٢. أدخل الرمز المكوّن من ٦ أرقام:' : '2. Enter the 6-digit code:'}
            </div>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D+/g, '').slice(0, 6))}
              autoFocus inputMode="numeric" placeholder="••••••"
              style={{
                width: 160, padding: '8px 10px', fontSize: 18, fontWeight: 700,
                letterSpacing: '.3em', textAlign: 'center', direction: 'ltr',
                background: theme.surface, color: theme.text,
                border: `1.5px solid ${theme.border}`, borderRadius: 6,
                outline: 'none', fontFamily: 'ui-monospace, monospace',
              }} />
            {error && (
              <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 6 }}>{error}</div>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <button onClick={finishEnable} disabled={busy || code.length !== 6} style={{
                padding: '6px 14px', borderRadius: 5,
                background: theme.accent, color: theme.accentText,
                border: 'none', fontSize: 12, fontWeight: 600,
                cursor: code.length === 6 ? 'pointer' : 'default', opacity: code.length === 6 ? 1 : 0.5,
                fontFamily: 'inherit',
              }}>{rtl ? 'تفعيل' : 'Enable'}</button>
              <button onClick={() => setStep('idle')} style={{
                padding: '6px 14px', borderRadius: 5,
                background: 'transparent', color: theme.muted,
                border: `.5px solid ${theme.border}`, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      {step === 'showCodes' && backupCodes && (
        <div style={{
          marginTop: 14, padding: 14,
          background: theme.bg, border: `1px dashed ${theme.accent}`, borderRadius: theme.cardRadius,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
            {rtl ? 'احفظ رموز النسخ الاحتياطي' : 'Save your backup codes'}
          </div>
          <div style={{ fontSize: 11.5, color: theme.muted, marginBottom: 12 }}>
            {rtl
              ? 'هذه فرصتك الوحيدة لرؤيتها. كل رمز للاستخدام مرة واحدة فقط لو فقدت جهازك.'
              : 'This is the only time we’ll show them. Each code works once, in case you lose your device.'}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 600,
            padding: '8px 10px', background: theme.surface, borderRadius: 5,
            color: theme.text, marginBottom: 10,
          }}>
            {backupCodes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))} style={{
              padding: '5px 12px', borderRadius: 5,
              background: theme.surface2, color: theme.text,
              border: `.5px solid ${theme.border}`, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'نسخ' : 'Copy'}</button>
            <button onClick={() => { setStep('idle'); setBackupCodes(null); }} style={{
              padding: '5px 12px', borderRadius: 5,
              background: theme.accent, color: theme.accentText,
              border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'حفظتها' : 'I saved them'}</button>
          </div>
        </div>
      )}

      {step === 'disabling' && (
        <div style={{
          marginTop: 14, padding: 14,
          background: theme.bg, border: `.5px solid ${theme.border}`, borderRadius: theme.cardRadius,
        }}>
          <div style={{ fontSize: 12.5, color: theme.text, marginBottom: 8 }}>
            {rtl ? 'أدخل رمز التطبيق (أو رمز نسخ احتياطي) لتعطيل 2FA:' : 'Enter your authenticator code (or a backup code) to disable 2FA:'}
          </div>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 20))}
            autoFocus placeholder="••••••" style={{
              width: 200, padding: '8px 10px', fontSize: 16, fontWeight: 700,
              letterSpacing: '.16em', textAlign: 'center', direction: 'ltr',
              background: theme.surface, color: theme.text,
              border: `1.5px solid ${theme.border}`, borderRadius: 6,
              outline: 'none', fontFamily: 'ui-monospace, monospace',
            }} />
          {error && (
            <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 6 }}>{error}</div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button onClick={finishDisable} disabled={busy || !code.trim()} style={{
              padding: '6px 14px', borderRadius: 5,
              background: '#DC2626', color: '#fff',
              border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'تعطيل' : 'Disable'}</button>
            <button onClick={() => setStep('idle')} style={{
              padding: '6px 14px', borderRadius: 5,
              background: 'transparent', color: theme.muted,
              border: `.5px solid ${theme.border}`, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileHeader({ theme, rtl, data }) {
  const u = data.user;
  const accentBg = data.department ? `oklch(.96 .04 ${data.department.hue})` : theme.surface;
  return (
    <div style={{
      padding: '28px 32px 22px',
      background: `linear-gradient(135deg, ${accentBg} 0%, ${theme.bg} 75%)`,
      borderBottom: `.5px solid ${theme.border}`,
      display: 'flex', alignItems: 'center', gap: 18,
    }}>
      <Avatar id={u.id} size={72} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {rtl ? 'ملف العضو' : 'Member profile'}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: theme.text, letterSpacing: '-.02em', margin: 0 }}>{u.name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: 12.5, color: theme.muted }}>{u.email}</span>
          <span style={{ fontSize: 12.5, color: theme.muted }}>·</span>
          <RoleBadge role={data.role} />
          {data.department && (
            <>
              <span style={{ fontSize: 12.5, color: theme.muted }}>·</span>
              <span style={{ fontSize: 12.5, color: theme.text, fontWeight: 600 }}>
                {localizedName(data.department, rtl)}
              </span>
            </>
          )}
          {data.team && (
            <>
              <span style={{ fontSize: 12.5, color: theme.muted }}>·</span>
              <span style={{ fontSize: 12.5, color: theme.muted }}>
                {localizedName(data.team, rtl)}
              </span>
            </>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: theme.mutedDim }}>
          {rtl ? 'انضم في' : 'Joined'} {new Date(data.joinedAt).toLocaleDateString(rtl ? 'ar' : 'en')}
        </div>
      </div>
    </div>
  );
}

function KPIGrid({ theme, rtl, kpis }) {
  if (!kpis) return null;
  const items = [
    { label: rtl ? 'مهام نشطة' : 'Active tasks',         value: kpis.activeCount, accent: theme.accent },
    { label: rtl ? 'متأخرة' : 'Overdue',                 value: kpis.overdueCount, accent: kpis.overdueCount > 0 ? '#DC2626' : theme.muted },
    { label: rtl ? 'مكتملة (٧ أيام)' : 'Completed (7d)',  value: kpis.completedThisWeek, accent: '#0E7C66' },
    { label: rtl ? 'مكتملة (٣٠ يوم)' : 'Completed (30d)', value: kpis.completedThisMonth, accent: '#0E7C66' },
    { label: rtl ? 'متوسط زمن الإنجاز' : 'Avg cycle time', value: kpis.avgCycleDays != null ? `${kpis.avgCycleDays}${rtl ? ' يوم' : 'd'}` : '—', accent: theme.muted },
    { label: rtl ? 'تعليقات هذا الشهر' : 'Comments (30d)', value: kpis.commentsThisMonth, accent: theme.muted },
    { label: rtl ? 'كروت أنشأها (٣٠ يوم)' : 'Created (30d)', value: kpis.cardsCreatedThisMonth, accent: theme.muted },
    { label: rtl ? 'آخر نشاط' : 'Last active', value: kpis.lastActivityAt ? formatRelative(kpis.lastActivityAt) : '—', accent: theme.muted },
  ];
  return (
    <div style={{
      padding: '20px 32px 0',
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
    }}>
      {items.map((it) => (
        <div key={it.label} style={{
          padding: '14px 16px',
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {it.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: it.accent, fontVariantNumeric: 'tabular-nums' }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function TasksPanel({ theme, rtl, userId, isSelf }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'active';
  const setFilter = (f) => {
    const next = new URLSearchParams(searchParams);
    if (f === 'active') next.delete('filter'); else next.set('filter', f);
    setSearchParams(next, { replace: true });
  };
  const [state, setState] = React.useState({ status: 'loading', tasks: [], labelsById: {} });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', tasks: [], labelsById: {} });
    (async () => {
      try {
        const r = await api(`/users/${userId}/tasks?filter=${filter}`);
        if (!cancelled) setState({ status: 'ready', tasks: r.tasks, labelsById: r.labelsById });
      } catch {
        if (!cancelled) setState({ status: 'error', tasks: [], labelsById: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [userId, filter]);

  const filters = [
    { id: 'active',    label: rtl ? 'نشطة' : 'Active' },
    { id: 'overdue',   label: rtl ? 'متأخرة' : 'Overdue' },
    { id: 'completed', label: rtl ? 'مكتملة' : 'Completed' },
    { id: 'all',       label: rtl ? 'الكل' : 'All' },
  ];

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: 0 }}>
          {isSelf ? (rtl ? 'مهامي' : 'My tasks') : (rtl ? 'المهام' : 'Tasks')}
        </h2>
        <div style={{ display: 'flex', gap: 2, background: theme.surface, padding: 2, borderRadius: 7, border: `.5px solid ${theme.border}` }}>
          {filters.map((f) => {
            const active = f.id === filter;
            return (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                padding: '5px 12px', borderRadius: 5,
                background: active ? theme.accentSoft : 'transparent',
                color: active ? theme.accent : theme.muted,
                border: 'none', cursor: active ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}>{f.label}</button>
            );
          })}
        </div>
      </div>

      {state.status === 'loading' && (
        <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 12 }}>
          {rtl ? 'جاري التحميل…' : 'Loading…'}
        </div>
      )}
      {state.status === 'ready' && state.tasks.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: theme.muted, fontSize: 12.5,
          background: theme.surface, borderRadius: theme.cardRadius, border: `.5px dashed ${theme.border}` }}>
          {rtl ? 'لا توجد مهام بهذا الفلتر.' : 'No tasks match this filter.'}
        </div>
      )}
      {state.tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {state.tasks.map((t) => {
            const overdue = t.due && !t.completedAt && new Date(t.due) < new Date();
            return (
              <div key={t.id} onClick={() => navigate(`/b/${t.boardId}?card=${t.id}`)} style={{
                display: 'grid', gridTemplateColumns: '4px 1fr auto', gap: 12,
                alignItems: 'center', padding: '10px 14px',
                background: theme.surface, borderRadius: theme.cardRadius,
                border: `.5px solid ${theme.border}`, cursor: 'pointer',
              }}>
                <div style={{ width: 4, height: 28, borderRadius: 2,
                  background: `oklch(.72 .14 ${t.boardHue})` }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text,
                    textDecoration: t.completedAt ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                    {t.boardTitle} · {t.listTitle}
                    {t.checklistTotal > 0 && ` · ${t.checklistDone}/${t.checklistTotal}`}
                    {t.commentCount > 0 && ` · ${t.commentCount} ${rtl ? 'تعليق' : 'comments'}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {t.labelIds.slice(0, 3).map((lid) => {
                    const lbl = state.labelsById[lid];
                    if (!lbl) return null;
                    return (
                      <span key={lid} style={{
                        padding: '2px 7px', borderRadius: 3,
                        fontSize: 10, fontWeight: 600,
                        background: lbl.bg, color: lbl.color,
                      }}>{lbl.name}</span>
                    );
                  })}
                  {t.completedAt ? (
                    <span style={{ fontSize: 11, color: '#0E7C66', fontWeight: 600 }}>
                      ✓ {formatRelative(t.completedAt)}
                    </span>
                  ) : t.due ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: overdue ? '#DC2626' : theme.muted,
                    }}>
                      {new Date(t.due).toLocaleDateString(rtl ? 'ar' : 'en', { month: 'short', day: 'numeric' })}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
