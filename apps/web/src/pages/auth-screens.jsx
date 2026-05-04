import React from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Avatar } from '../ui/Avatar.jsx';
import { buildTheme } from '../ui/theme.js';
import { useAuth } from '../state/AuthContext.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { forgotPassword, checkResetToken, resetPassword, verifyEmail, verify2FA, fetchMe } from '../lib/api.js';

// Floating language + theme toggle for unauthenticated screens.
// Shows in the top end corner; mirrors what's available in the in-app SettingsMenu.
function AuthCorner({ theme, rtl }) {
  const s = useSettings();
  // Outer wrapper inherits page direction so insetInlineEnd lands on the
  // form side (away from the brand panel + logo). Inner toggles force LTR
  // so EN/ع buttons stay in fixed reading order.
  return (
    <div style={{
      position: 'fixed', top: 16, insetInlineEnd: 16, zIndex: 30,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        direction: 'ltr',
      }}>
        <ToggleGroup theme={theme}
          value={rtl ? 'ar' : 'en'}
          onChange={(v) => s.set('rtl', v === 'ar')}
          options={[{ value: 'en', label: 'EN' }, { value: 'ar', label: 'ع' }]} />
        <ToggleGroup theme={theme}
          value={s.themeName}
          onChange={(v) => s.set('themeName', v)}
          options={[
            { value: 'minimal', label: '☀' },
            { value: 'dark',    label: '☾' },
          ]} />
      </div>
    </div>
  );
}

function ToggleGroup({ theme, value, options, onChange }) {
  return (
    <div style={{
      display: 'flex',
      background: theme.surface,
      border: `.5px solid ${theme.border}`,
      borderRadius: 7, padding: 2,
      boxShadow: theme.shadow,
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: '5px 10px', minWidth: 32,
            border: 'none', cursor: active ? 'default' : 'pointer',
            background: active ? theme.accentSoft : 'transparent',
            color: active ? theme.accent : theme.muted,
            borderRadius: 5, fontSize: 12, fontWeight: 600,
            fontFamily: 'inherit',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Brand panel ─────────────────────────────────────────────────────────────

function AuthBrandPanel({ theme, themeName, rtl }) {
  if (themeName === 'playful') {
    return (
      <div style={{
        position: 'relative', height: '100%', overflow: 'hidden',
        background: `linear-gradient(135deg, oklch(.92 .12 28) 0%, oklch(.85 .18 320) 100%)`,
        padding: '40px 44px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        color: '#2A1A07',
      }}>
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'oklch(.95 .08 60 / .55)', top: -60, right: rtl ? 'auto' : -60, left: rtl ? -60 : 'auto' }} />
        <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: 30, background: 'oklch(.85 .14 200 / .35)', bottom: 80, right: rtl ? 'auto' : 60, left: rtl ? 60 : 'auto', transform: 'rotate(18deg)' }} />
        <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', background: 'oklch(.95 .14 140 / .55)', bottom: 200, right: rtl ? 'auto' : 220, left: rtl ? 220 : 'auto' }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#2A1A07', color: '#FBF7F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>S</div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>SarSync</span>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1.1, marginBottom: 14, textWrap: 'balance' }}>
            {rtl ? 'العمل أحلى لمّا يكون مرتّب.' : 'Work, but make it warm.'}
          </div>
          <div style={{ fontSize: 14.5, opacity: .75, maxWidth: 360, lineHeight: 1.5 }}>
            {rtl ? 'لوحات كانبان مرنة، تفاصيل مهام غنية، فرق سعيدة.' : 'Flexible kanban boards, rich card details, happy teams.'}
          </div>
        </div>
        <div style={{ position: 'relative', fontSize: 11.5, opacity: .65 }}>
          {rtl ? 'الإصدار ٢٠٢٦ · صنع بحب' : 'v2026 · made with care'}
        </div>
      </div>
    );
  }
  if (themeName === 'dark') {
    return (
      <div style={{
        position: 'relative', height: '100%', overflow: 'hidden',
        background: '#0A0C10',
        backgroundImage: `radial-gradient(circle at 30% 20%, ${theme.accent}22 0%, transparent 50%), linear-gradient(${theme.border} .5px, transparent .5px), linear-gradient(90deg, ${theme.border} .5px, transparent .5px)`,
        backgroundSize: 'auto, 32px 32px, 32px 32px',
        padding: '40px 44px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        color: theme.text,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: theme.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>S</div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>SarSync</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.accent, marginBottom: 14, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {rtl ? '٢٠٢٦ · النسخة الجديدة' : 'New for 2026'}
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1.15, marginBottom: 14, whiteSpace: 'pre-line' }}>
            {rtl ? 'سرعة بلا تنازلات.' : 'Move fast.\nStay organized.'}
          </div>
          <div style={{ fontSize: 14.5, color: theme.muted, maxWidth: 360, lineHeight: 1.55 }}>
            {rtl ? 'كانبان قوي للفرق التي تعمل بسرعة. صلاحيات دقيقة، اختصارات كاملة، أوضاع مظلمة وفاتحة.' : 'A serious kanban for serious teams. Granular roles, full keyboard control, light + dark.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, fontSize: 11.5, color: theme.muted }}>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>4.8★</div>{rtl ? 'تقييم المستخدمين' : 'User rating'}</div>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>180k+</div>{rtl ? 'فريق نشط' : 'Active teams'}</div>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>SOC 2</div>{rtl ? 'متوافق' : 'Compliant'}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{
      position: 'relative', height: '100%', overflow: 'hidden',
      background: theme.bg,
      padding: '40px 44px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      color: theme.text,
      borderInlineEnd: `.5px solid ${theme.border}`,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(${theme.border} 1px, transparent 1px)`,
        backgroundSize: '20px 20px', opacity: .6,
      }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: theme.text, color: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>S</div>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em' }}>SarSync</span>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-.025em', lineHeight: 1.2, color: theme.text, textWrap: 'balance', maxWidth: 420 }}>
          {rtl ? '"اختصرنا الاجتماعات إلى النصف. كل شيء على اللوحة."' : '"We cut our standups in half. Everything’s on the board."'}
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: theme.muted }}>
        <span>© 2026 SarSync</span>
        <span style={{ display: 'flex', gap: 16 }}>
          <span>{rtl ? 'الخصوصية' : 'Privacy'}</span>
          <span>{rtl ? 'الشروط' : 'Terms'}</span>
        </span>
      </div>
    </div>
  );
}

function AuthShell({ theme, themeName, rtl, layout, children }) {
  if (layout === 'centered') {
    return (
      <div style={{
        width: '100%', height: '100%', background: theme.bg, color: theme.text,
        direction: rtl ? 'rtl' : 'ltr',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, overflow: 'auto',
      }}>
        <AuthCorner theme={theme} rtl={rtl} />
        <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', height: '100%', background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr',
      display: 'grid', gridTemplateColumns: '1fr 1.05fr', overflow: 'hidden',
    }}>
      <AuthCorner theme={theme} rtl={rtl} />
      <div className="auth-brand-panel" style={{ height: '100%' }}>
        <AuthBrandPanel theme={theme} themeName={themeName} rtl={rtl} />
      </div>
      <div className="auth-form-panel" style={{
        background: theme.surface, padding: '40px 56px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        overflow: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 380, marginInline: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Form atoms ──────────────────────────────────────────────────────────────

function Field({ label, theme, hint, error, children, action }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{label}</span>
        {action}
      </div>
      {children}
      {hint && !error && <div style={{ fontSize: 11, color: theme.muted, marginTop: 5 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 700 }}>!</span> {error}
      </div>}
    </label>
  );
}

function Input({ theme, error, icon, suffix, rtl, ...props }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: theme.bg,
      border: `1px solid ${error ? '#DC2626' : theme.border}`,
      borderRadius: theme.cardRadius,
      transition: 'border-color .12s, box-shadow .12s', overflow: 'hidden',
    }}>
      {icon && <div style={{ paddingInline: 12, color: theme.muted, display: 'flex', alignItems: 'center' }}>{icon}</div>}
      <input {...props} style={{
        flex: 1, background: 'transparent',
        border: 'none', outline: 'none',
        padding: icon ? '11px 12px 11px 0' : '11px 13px',
        fontSize: 13.5, color: theme.text, fontFamily: 'inherit',
        direction: rtl ? 'rtl' : 'ltr',
      }} />
      {suffix && <div style={{ paddingInline: 10, color: theme.muted, display: 'flex', alignItems: 'center' }}>{suffix}</div>}
    </div>
  );
}

function PrimaryBtn({ theme, children, full, ...props }) {
  return (
    <button {...props} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: full ? '100%' : 'auto',
      padding: '11px 18px',
      background: theme.accent, color: theme.accentText,
      border: 'none', borderRadius: theme.cardRadius,
      fontSize: 13.5, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit',
      transition: 'transform .08s, opacity .12s',
    }}>{children}</button>
  );
}

function GhostBtn({ theme, children, full, icon, ...props }) {
  return (
    <button {...props} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      width: full ? '100%' : 'auto',
      padding: '10px 14px',
      background: theme.surface, color: theme.text,
      border: `.5px solid ${theme.border}`,
      borderRadius: theme.cardRadius,
      fontSize: 13, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit',
    }}>{icon}{children}</button>
  );
}

function Divider({ theme, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
      <div style={{ flex: 1, height: 1, background: theme.border }} />
      <span style={{ fontSize: 11, color: theme.muted, fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: theme.border }} />
    </div>
  );
}

function Check({ theme, label, checked, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: theme.text }}>
      <span onClick={() => onChange && onChange(!checked)} style={{
        width: 16, height: 16, borderRadius: 4,
        background: checked ? theme.accent : theme.bg,
        border: `1.5px solid ${checked ? theme.accent : theme.muted}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 11, fontWeight: 700,
      }}>{checked && '✓'}</span>
      <span onClick={() => onChange && onChange(!checked)}>{label}</span>
    </label>
  );
}

function SSOButtons({ theme, rtl }) {
  return (
    <button style={{
      width: '100%', padding: '11px 14px', borderRadius: theme.cardRadius,
      background: '#fff', color: '#1f1f1f', border: '.5px solid #dadce0',
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      fontFamily: 'inherit',
    }}>
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
      </svg>
      {rtl ? 'المتابعة بحساب قوقل' : 'Continue with Google'}
    </button>
  );
}

// ── Sign In ─────────────────────────────────────────────────────────────────

export function SignInScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await auth.signIn(email, password);
      // 2FA-protected account → step over to the OTP screen with the
      // challenge token in route state. The redirect-after-signin "from"
      // is preserved so we land on the right page after verifying.
      if (data?.requires2FA) {
        navigate('/auth/2fa', {
          replace: true,
          state: { challengeToken: data.challengeToken, from: location.state?.from },
        });
        return;
      }
      const next = location.state?.from || (data.memberships.length > 1 ? '/auth/workspace' : '/boards');
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || (rtl ? 'فشل تسجيل الدخول' : 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="split">
      <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
        {rtl ? 'مرحبًا بعودتك' : 'Welcome back'}
      </h1>
      <p style={{ fontSize: 13.5, color: theme.muted, margin: '0 0 26px' }}>
        {rtl ? 'سجّل دخولك للمتابعة إلى SarSync' : 'Sign in to continue to SarSync'}
      </p>
      <SSOButtons theme={theme} rtl={rtl} />
      <Divider theme={theme} label={rtl ? 'أو بالبريد الإلكتروني' : 'or with email'} />

      <form onSubmit={submit} noValidate>
        <Field label={rtl ? 'البريد الإلكتروني' : 'Email'} theme={theme}>
          <Input theme={theme} placeholder="you@company.com" type="email"
            value={email} onChange={(e) => setEmail(e.target.value)} rtl={rtl} required />
        </Field>
        <Field label={rtl ? 'كلمة المرور' : 'Password'} theme={theme}
          action={<Link to="/auth/forgot" style={{ fontSize: 11.5, color: theme.accent, textDecoration: 'none', fontWeight: 600 }}>{rtl ? 'نسيت كلمة المرور؟' : 'Forgot password?'}</Link>}>
          <Input theme={theme} placeholder="••••••••••" type={show ? 'text' : 'password'}
            value={password} onChange={(e) => setPassword(e.target.value)} rtl={rtl} required
            suffix={
              <button type="button" onClick={() => setShow(!show)} style={{ background: 'none', border: 'none', color: theme.muted, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                {show ? (rtl ? 'إخفاء' : 'Hide') : (rtl ? 'إظهار' : 'Show')}
              </button>
            } />
        </Field>

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 14,
            background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
            fontSize: 12.5, fontWeight: 500,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <Check theme={theme} label={rtl ? 'تذكّرني لـ ٣٠ يومًا' : 'Remember me for 30 days'} checked={true} onChange={() => {}} />
        </div>

        <PrimaryBtn theme={theme} full type="submit" disabled={loading}>
          {loading ? (rtl ? 'جاري…' : 'Signing in…') : (rtl ? 'تسجيل الدخول' : 'Sign in')} →
        </PrimaryBtn>
      </form>

      <p style={{ fontSize: 12.5, color: theme.muted, textAlign: 'center', margin: '22px 0 0' }}>
        {rtl ? 'لا تملك حسابًا؟' : "Don't have an account?"}{' '}
        <Link to="/auth/signup" style={{ color: theme.accent, fontWeight: 600, textDecoration: 'none' }}>{rtl ? 'أنشئ حسابًا' : 'Sign up free'}</Link>
      </p>
    </AuthShell>
  );
}

// ── Sign Up ─────────────────────────────────────────────────────────────────

export function SignUpScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const auth = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = React.useState('Sara');
  const [lastName, setLastName] = React.useState('Al-Mutairi');
  const [email, setEmail] = React.useState('');
  const [workspaceName, setWorkspaceName] = React.useState('Atlas Studio');
  const [pw, setPw] = React.useState('SarSync2026!');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const strength = pwStrength(pw);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await auth.signUp({ firstName, lastName, email, password: pw, workspaceName });
      navigate('/boards', { replace: true });
    } catch (err) {
      setError(err.message || (rtl ? 'فشل إنشاء الحساب' : 'Sign up failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="split">
      <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
        {rtl ? 'أنشئ حسابك' : 'Create your account'}
      </h1>
      <p style={{ fontSize: 13.5, color: theme.muted, margin: '0 0 22px' }}>
        {rtl ? 'مجاني للفرق حتى ١٠ أشخاص. لا توجد بطاقة ائتمان.' : 'Free for teams up to 10. No credit card.'}
      </p>
      <SSOButtons theme={theme} rtl={rtl} />
      <Divider theme={theme} label={rtl ? 'أو' : 'or'} />

      <form onSubmit={submit} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label={rtl ? 'الاسم الأول' : 'First name'} theme={theme}>
            <Input theme={theme} placeholder="Sara" value={firstName} onChange={(e) => setFirstName(e.target.value)} rtl={rtl} required />
          </Field>
          <Field label={rtl ? 'العائلة' : 'Last name'} theme={theme}>
            <Input theme={theme} placeholder="Al-Mutairi" value={lastName} onChange={(e) => setLastName(e.target.value)} rtl={rtl} required />
          </Field>
        </div>
        <Field label={rtl ? 'البريد الإلكتروني للعمل' : 'Work email'} theme={theme}>
          <Input theme={theme} placeholder="you@company.com" type="email"
            value={email} onChange={(e) => setEmail(e.target.value)} rtl={rtl} required />
        </Field>
        <Field label={rtl ? 'اسم مساحة العمل' : 'Workspace name'} theme={theme} hint={rtl ? 'يمكن تغييره لاحقًا' : 'You can change this later'}>
          <Input theme={theme} placeholder="Atlas Studio"
            value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} rtl={rtl} required
            suffix={<span style={{ fontSize: 11, color: theme.muted, fontWeight: 600 }}>.sarsync.com</span>} />
        </Field>
        <Field label={rtl ? 'كلمة المرور' : 'Password'} theme={theme}>
          <Input theme={theme} type="password" value={pw} onChange={(e) => setPw(e.target.value)} rtl={rtl} required />
          <PwStrength theme={theme} score={strength} rtl={rtl} />
        </Field>

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 14,
            background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
            fontSize: 12.5, fontWeight: 500,
          }}>{error}</div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Check theme={theme} label={rtl ? 'أوافق على الشروط وسياسة الخصوصية' : 'I agree to the Terms and Privacy Policy'} checked={true} onChange={() => {}} />
        </div>

        <PrimaryBtn theme={theme} full type="submit" disabled={loading}>
          {loading ? (rtl ? 'جاري الإنشاء…' : 'Creating…') : (rtl ? 'إنشاء الحساب' : 'Create account')} →
        </PrimaryBtn>
      </form>

      <p style={{ fontSize: 12.5, color: theme.muted, textAlign: 'center', margin: '20px 0 0' }}>
        {rtl ? 'لديك حساب؟' : 'Already have an account?'}{' '}
        <Link to="/auth/signin" style={{ color: theme.accent, fontWeight: 600, textDecoration: 'none' }}>{rtl ? 'سجّل الدخول' : 'Sign in'}</Link>
      </p>
    </AuthShell>
  );
}

function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

function PwStrength({ theme, score, rtl }) {
  const labels = rtl ? ['ضعيفة', 'مقبولة', 'جيدة', 'قوية', 'ممتازة'] : ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  const colors = ['#DC2626', '#D97706', '#D97706', '#0E7C66', '#0E7C66'];
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
        {[0,1,2,3].map((i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < score ? colors[score] : theme.border }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: theme.muted }}>
        <span>{rtl ? 'قوة كلمة المرور' : 'Password strength'}</span>
        <span style={{ color: colors[score], fontWeight: 600 }}>{labels[score]}</span>
      </div>
    </div>
  );
}

// ── Forgot password ─────────────────────────────────────────────────────────

export function ForgotScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [sentTo, setSentTo] = React.useState('');
  const [devUrl, setDevUrl] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await forgotPassword(email.trim());
      setSentTo(email.trim());
      setDevUrl(data?.devUrl || null);
      setSent(true);
    } catch (err) {
      setError(err.message || (rtl ? 'فشل الإرسال، حاول مجددًا' : 'Could not send the link, try again'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="centered">
      <div style={{
        background: theme.surface,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: '32px 30px', boxShadow: theme.shadow,
      }}>
        <Link to="/auth/signin" style={{ fontSize: 12, color: theme.muted, textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 18 }}>
          {rtl ? '→ رجوع لتسجيل الدخول' : '← Back to sign in'}
        </Link>
        {!sent ? (
          <form onSubmit={submit} noValidate>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
              {rtl ? 'هل نسيت كلمة المرور؟' : 'Forgot your password?'}
            </h1>
            <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
              {rtl ? 'أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة المرور.' : 'Enter the email associated with your account and we’ll send a reset link.'}
            </p>
            <Field label={rtl ? 'البريد الإلكتروني' : 'Email'} theme={theme}>
              <Input theme={theme} placeholder="you@company.com" type="email"
                value={email} onChange={(e) => setEmail(e.target.value)} rtl={rtl} required />
            </Field>
            {error && (
              <div style={{
                padding: '8px 12px', marginBottom: 14,
                background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
                fontSize: 12.5, fontWeight: 500,
              }}>{error}</div>
            )}
            <PrimaryBtn theme={theme} full type="submit" disabled={loading}>
              {loading ? (rtl ? 'جاري…' : 'Sending…') : (rtl ? 'إرسال رابط إعادة التعيين' : 'Send reset link')}
            </PrimaryBtn>
            <div style={{ marginTop: 18, padding: '11px 14px', background: theme.bg, border: `.5px solid ${theme.border}`, borderRadius: theme.cardRadius, fontSize: 11.5, color: theme.muted, lineHeight: 1.5 }}>
              {rtl ? 'لم تستلم البريد بعد ٥ دقائق؟ تحقق من مجلد البريد المهمل.' : 'Didn’t get an email after 5 min? Check your spam folder.'}
            </div>
          </form>
        ) : (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 48,
              background: theme.accentSoft, color: theme.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, marginBottom: 14,
            }}>✉</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
              {rtl ? 'تحقق من بريدك' : 'Check your email'}
            </h1>
            <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
              {rtl ? 'إذا كان هذا البريد مرتبطًا بحساب، فقد أرسلنا رابط إعادة التعيين إلى ' : 'If that email matches an account, we sent a reset link to '}
              <strong style={{ color: theme.text }}>{sentTo}</strong>.
              {rtl ? ' الرابط صالح لمدة ١٥ دقيقة.' : ' The link is valid for 15 minutes.'}
            </p>
            {devUrl && (
              <div style={{
                marginBottom: 14, padding: '10px 12px',
                background: theme.bg, border: `1px dashed ${theme.accent}`,
                borderRadius: theme.cardRadius, fontSize: 11, lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, color: theme.accent, marginBottom: 4 }}>
                  {rtl ? 'وضع التطوير' : 'Dev mode'}
                </div>
                <a href={devUrl} style={{ color: theme.text, wordBreak: 'break-all', textDecoration: 'underline' }}>
                  {devUrl}
                </a>
              </div>
            )}
            <p style={{ fontSize: 12, color: theme.muted, textAlign: 'center', margin: '0' }}>
              {rtl ? 'لم يصلك؟' : 'Didn’t get it?'}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setSent(false); }} style={{ color: theme.accent, fontWeight: 600, textDecoration: 'none' }}>{rtl ? 'إعادة الإرسال' : 'Resend'}</a>
            </p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

// ── Reset password ──────────────────────────────────────────────────────────

export function ResetScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  // status: 'checking' (verifying token), 'ready' (token good, show form),
  //         'invalid' (expired/used/missing), 'success' (just reset)
  const [status, setStatus] = React.useState(token ? 'checking' : 'invalid');
  const [accountEmail, setAccountEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState(null);
  const [serverError, setServerError] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await checkResetToken(token);
        if (!cancelled) {
          setAccountEmail(data.email);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('invalid');
          setServerError(err.code || 'invalid');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const score = pwStrength(pw);
  const match = pw === confirm && pw.length > 0;
  const rules = [
    { ok: pw.length >= 8,                       label: rtl ? 'الحد الأدنى ٨ أحرف' : 'At least 8 characters' },
    { ok: /[A-Z]/.test(pw) && /[a-z]/.test(pw), label: rtl ? 'حرف كبير وصغير' : 'Upper and lower case' },
    { ok: /\d/.test(pw),                        label: rtl ? 'رقم واحد على الأقل' : 'At least one number' },
    { ok: /[^A-Za-z0-9]/.test(pw),              label: rtl ? 'رمز خاص واحد' : 'One special character' },
  ];
  const baseValid = rules[0].ok && rules[1].ok && rules[2].ok;

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!match) {
      setError(rtl ? 'كلمتا المرور غير متطابقتين' : 'Passwords don’t match');
      return;
    }
    if (!baseValid) {
      setError(rtl ? 'كلمة المرور لا تستوفي المتطلبات' : 'Password does not meet requirements');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, pw);
      setStatus('success');
    } catch (err) {
      if (err.status === 410) {
        setStatus('invalid');
        setServerError(err.code || 'expired');
      } else {
        setError(err.message || (rtl ? 'فشل تحديث كلمة المرور' : 'Could not update password'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const card = (children) => (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="centered">
      <div style={{
        background: theme.surface,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: '32px 30px', boxShadow: theme.shadow,
      }}>{children}</div>
    </AuthShell>
  );

  if (status === 'checking') {
    return card(
      <div style={{ textAlign: 'center', color: theme.muted, fontSize: 13, padding: '20px 0' }}>
        {rtl ? 'جاري التحقق من الرابط…' : 'Verifying link…'}
      </div>
    );
  }

  if (status === 'invalid') {
    const reason = serverError;
    const heading =
      reason === 'used'    ? (rtl ? 'الرابط مستخدم سابقًا' : 'This link was already used')
    : reason === 'expired' ? (rtl ? 'انتهت صلاحية الرابط' : 'This link has expired')
    :                        (rtl ? 'الرابط غير صالح' : 'Invalid link');
    return card(
      <>
        <div style={{
          width: 48, height: 48, borderRadius: 48,
          background: '#FEE2E2', color: '#991B1B',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, marginBottom: 14,
        }}>!</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          {heading}
        </h1>
        <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
          {rtl
            ? 'اطلب رابطًا جديدًا لإعادة تعيين كلمة المرور.'
            : 'Request a fresh link to reset your password.'}
        </p>
        <Link to="/auth/forgot" style={{ textDecoration: 'none' }}>
          <PrimaryBtn theme={theme} full>
            {rtl ? 'طلب رابط جديد' : 'Request a new link'}
          </PrimaryBtn>
        </Link>
      </>
    );
  }

  if (status === 'success') {
    return card(
      <>
        <div style={{
          width: 48, height: 48, borderRadius: 48,
          background: theme.accentSoft, color: theme.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, marginBottom: 14,
        }}>✓</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          {rtl ? 'تم تحديث كلمة المرور' : 'Password updated'}
        </h1>
        <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
          {rtl
            ? 'سجّل دخولك بكلمة المرور الجديدة.'
            : 'Sign in with your new password to continue.'}
        </p>
        <PrimaryBtn theme={theme} full onClick={() => navigate('/auth/signin', { replace: true })}>
          {rtl ? 'تسجيل الدخول' : 'Go to sign in'} →
        </PrimaryBtn>
      </>
    );
  }

  return card(
    <form onSubmit={submit} noValidate>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
        {rtl ? 'إعادة تعيين كلمة المرور' : 'Set a new password'}
      </h1>
      <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px' }}>
        {accountEmail
          ? (rtl ? 'لحساب ' : 'For ') + accountEmail
          : (rtl ? 'كلمة مرور قوية تحفظك أنت وفريقك.' : 'Choose something strong — for you and your team.')}
      </p>

      <Field label={rtl ? 'كلمة المرور الجديدة' : 'New password'} theme={theme}>
        <Input theme={theme} type="password" value={pw} onChange={(e) => setPw(e.target.value)} rtl={rtl} required />
        <PwStrength theme={theme} score={score} rtl={rtl} />
      </Field>
      <Field label={rtl ? 'تأكيد كلمة المرور' : 'Confirm password'} theme={theme} error={!match && confirm.length > 0 ? (rtl ? 'كلمتا المرور غير متطابقتين' : 'Passwords don’t match') : null}>
        <Input theme={theme} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} rtl={rtl} required
          suffix={match && confirm.length > 0 ? <span style={{ color: '#0E7C66', fontWeight: 700 }}>✓</span> : null} />
      </Field>

      <div style={{
        padding: '10px 12px', background: theme.bg,
        border: `.5px solid ${theme.border}`, borderRadius: theme.cardRadius,
        marginBottom: 18,
      }}>
        {rules.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '2px 0', color: r.ok ? theme.text : theme.muted }}>
            <span style={{ width: 14, height: 14, borderRadius: 14, background: r.ok ? '#0E7C66' : 'transparent', border: `1.5px solid ${r.ok ? '#0E7C66' : theme.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
              {r.ok && '✓'}
            </span>
            {r.label}
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', marginBottom: 14,
          background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
          fontSize: 12.5, fontWeight: 500,
        }}>{error}</div>
      )}

      <PrimaryBtn theme={theme} full type="submit" disabled={submitting || !baseValid || !match}>
        {submitting ? (rtl ? 'جاري التحديث…' : 'Updating…') : (rtl ? 'تحديث كلمة المرور' : 'Update password')}
      </PrimaryBtn>
    </form>
  );
}

// ── 2FA / OTP verification ─────────────────────────────────────────────────

export function OtpScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const navigate = useNavigate();
  const location = useLocation();
  const challengeToken = location.state?.challengeToken;
  const fromPath = location.state?.from;

  const [code, setCode] = React.useState('');
  const [useBackup, setUseBackup] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef(null);

  // No challenge → user landed here directly (e.g. browser refresh).
  // Send them back to sign in.
  React.useEffect(() => {
    if (!challengeToken) navigate('/auth/signin', { replace: true });
  }, [challengeToken, navigate]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, [useBackup]);

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const data = await verify2FA(challengeToken, code.trim());
      // Hydrate auth context — cleanest is to reload /me so all the routes
      // see the new tokens and memberships.
      const me = await fetchMe();
      // Pop the next path from the original signin attempt
      const next = fromPath || (me.memberships.length > 1 ? '/auth/workspace' : '/boards');
      navigate(next, { replace: true });
      // Force a full reload so AuthContext picks up the new state cleanly
      // (fetchMe already updated tokens; AuthContext re-runs on mount).
      window.location.href = next;
      void data;
    } catch (err) {
      if (err.code === 'invalid_challenge') {
        setError(rtl ? 'انتهت الجلسة — سجّل دخولك مرة أخرى.' : 'Session expired — sign in again.');
        setTimeout(() => navigate('/auth/signin', { replace: true }), 1500);
      } else {
        setError(err.message || (rtl ? 'الرمز غير صحيح' : 'Invalid code'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="centered">
      <form onSubmit={submit} style={{
        background: theme.surface,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: '32px 30px', boxShadow: theme.shadow,
        textAlign: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 48,
          background: theme.accentSoft, color: theme.accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, marginBottom: 14,
        }}>🛡</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          {rtl ? 'التحقق بخطوتين' : 'Two-factor verification'}
        </h1>
        <p style={{ fontSize: 13, color: theme.muted, margin: '0 0 22px', lineHeight: 1.5 }}>
          {useBackup
            ? (rtl ? 'أدخل أحد رموز النسخ الاحتياطي.' : 'Enter one of your backup codes.')
            : (rtl ? 'أدخل الرمز المكوّن من ٦ أرقام من تطبيق المصادقة.' : 'Enter the 6-digit code from your authenticator app.')}
        </p>

        <input
          ref={inputRef}
          autoFocus
          value={code}
          onChange={(e) => setCode(useBackup
            ? e.target.value.toUpperCase()
            : e.target.value.replace(/\D+/g, '').slice(0, 6))}
          inputMode={useBackup ? 'text' : 'numeric'}
          placeholder={useBackup ? 'XXXXX-XXXXX' : '••••••'}
          style={{
            width: '100%', textAlign: 'center', direction: 'ltr',
            padding: '12px 14px', fontSize: useBackup ? 18 : 24, fontWeight: 700,
            letterSpacing: useBackup ? '.06em' : '.32em',
            background: theme.bg, color: theme.text,
            border: `1.5px solid ${theme.border}`, borderRadius: theme.cardRadius,
            outline: 'none', fontFamily: 'ui-monospace, monospace',
            marginBottom: 12,
          }} />

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 14,
            background: '#FEE2E2', color: '#991B1B', borderRadius: theme.cardRadius,
            fontSize: 12.5, fontWeight: 500,
          }}>{error}</div>
        )}

        <PrimaryBtn theme={theme} full type="submit" disabled={submitting || !code.trim()}>
          {submitting ? (rtl ? 'جاري التحقق…' : 'Verifying…') : (rtl ? 'تحقق' : 'Verify')} →
        </PrimaryBtn>

        <div style={{
          marginTop: 22, paddingTop: 18, borderTop: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'center', gap: 18, fontSize: 12,
        }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setUseBackup((v) => !v); setCode(''); setError(null); }}
            style={{ color: theme.text, textDecoration: 'none', fontWeight: 600 }}>
            {useBackup
              ? (rtl ? 'استخدم رمز التطبيق' : 'Use authenticator code')
              : (rtl ? 'استخدم رمز نسخ احتياطي' : 'Use a backup code')}
          </a>
          <Link to="/auth/signin" style={{ color: theme.muted, textDecoration: 'none' }}>
            {rtl ? 'إلغاء' : 'Cancel'}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

// ── Email verification ──────────────────────────────────────────────────────

export function EmailVerifyScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  // 'checking' (verifying) | 'ok' (verified, show CTA) | 'invalid'
  const [status, setStatus] = React.useState(token ? 'checking' : 'invalid');
  const [email, setEmail] = React.useState('');
  const [reason, setReason] = React.useState(null);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await verifyEmail(token);
        if (cancelled) return;
        setEmail(r.email || '');
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setReason(err.code || 'invalid');
        setStatus('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const heading = status === 'ok'
    ? (rtl ? 'تم تفعيل البريد ✓' : 'Email verified ✓')
    : status === 'checking'
      ? (rtl ? 'جاري التحقق…' : 'Verifying…')
      : reason === 'used'
        ? (rtl ? 'الرابط مستخدم سابقًا' : 'Link already used')
        : reason === 'expired'
          ? (rtl ? 'انتهت صلاحية الرابط' : 'Link expired')
          : (rtl ? 'الرابط غير صالح' : 'Invalid link');

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="centered">
      <div style={{
        background: theme.surface,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: '36px 30px', boxShadow: theme.shadow,
        textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 64, margin: '0 auto 18px',
          background: status === 'ok' ? '#0E7C66' : (status === 'invalid' ? '#FEE2E2' : theme.accentSoft),
          color: status === 'invalid' ? '#991B1B' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 700,
        }}>{status === 'ok' ? '✓' : status === 'invalid' ? '!' : '✉'}</div>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 8px' }}>
          {heading}
        </h1>

        {status === 'ok' && (
          <>
            <p style={{ fontSize: 13.5, color: theme.muted, margin: '0 0 22px', lineHeight: 1.55 }}>
              {rtl ? 'تم تأكيد ' : 'Verified '}
              <strong style={{ color: theme.text, fontSize: 14 }}>{email}</strong>.
              <br />
              {rtl ? 'يمكنك الآن استخدام كل ميزات SarSync.' : 'You can now use all SarSync features.'}
            </p>
            <Link to="/boards" style={{ textDecoration: 'none' }}>
              <PrimaryBtn theme={theme} full>{rtl ? 'انتقل للوحات' : 'Continue to boards'}</PrimaryBtn>
            </Link>
          </>
        )}

        {status === 'invalid' && (
          <>
            <p style={{ fontSize: 13.5, color: theme.muted, margin: '0 0 22px', lineHeight: 1.55 }}>
              {rtl
                ? 'سجّل الدخول واطلب رابطًا جديدًا من إعدادات الحساب.'
                : 'Sign in and request a new link from your account settings.'}
            </p>
            <Link to="/auth/signin" style={{ textDecoration: 'none' }}>
              <PrimaryBtn theme={theme} full>{rtl ? 'تسجيل الدخول' : 'Sign in'}</PrimaryBtn>
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}

// ── Workspace picker ───────────────────────────────────────────────────────

const ROLE_LABELS = {
  admin: 'Admin',
  dept_manager: 'Dept. Manager',
  team_lead: 'Team Lead',
  member: 'Member',
  guest: 'Guest',
};

export function WorkspacePickerScreen({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const auth = useAuth();
  const navigate = useNavigate();
  const workspaces = auth.memberships;

  const onPick = (m) => {
    // Future: persist active workspace. For now just go to boards.
    navigate('/boards');
  };

  const onSignOut = async () => {
    await auth.signOut();
    navigate('/auth/signin', { replace: true });
  };

  return (
    <AuthShell theme={theme} themeName={themeName} rtl={rtl} layout="centered">
      <div style={{
        background: theme.surface, border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius, padding: '28px 26px',
        boxShadow: theme.shadow,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: auth.user?.avatarColor || theme.accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14,
          }}>{(auth.user?.firstName?.[0] || '') + (auth.user?.lastName?.[0] || '')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: theme.muted }}>{rtl ? 'مسجّل الدخول كـ' : 'Signed in as'}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{auth.user?.email}</div>
          </div>
          <button onClick={onSignOut} style={{
            background: 'transparent', border: 'none',
            fontSize: 11.5, color: theme.muted, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{rtl ? 'خروج' : 'Sign out'}</button>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 4px' }}>
          {rtl ? 'اختر مساحة عمل' : 'Choose a workspace'}
        </h1>
        <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 0 18px' }}>
          {rtl
            ? `لديك صلاحية على ${workspaces.length} مساحات عمل.`
            : `You have access to ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}.`}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workspaces.map((w, i) => (
            <button key={w.id} onClick={() => onPick(w)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '11px 12px',
              background: i === 0 ? theme.accentSoft : theme.bg,
              border: `.5px solid ${i === 0 ? theme.accent + '55' : theme.border}`,
              borderRadius: theme.cardRadius, cursor: 'pointer',
              fontFamily: 'inherit', textAlign: rtl ? 'right' : 'left',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 7,
                background: `oklch(.86 .14 ${w.workspaceHue})`,
                color: `oklch(.32 .16 ${w.workspaceHue})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
              }}>{w.workspaceName[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>{w.workspaceName}</div>
                <div style={{ fontSize: 11, color: theme.muted, marginTop: 1 }}>
                  {ROLE_LABELS[w.role] || w.role} · {w.memberCount} {rtl ? 'عضوًا' : 'members'}
                </div>
              </div>
              <span style={{ fontSize: 16, color: theme.muted }}>{rtl ? '←' : '→'}</span>
            </button>
          ))}
        </div>

        <button style={{
          width: '100%', marginTop: 12, padding: '11px 12px',
          background: 'transparent', border: `1px dashed ${theme.border}`,
          borderRadius: theme.cardRadius, color: theme.text,
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>+ {rtl ? 'إنشاء مساحة عمل جديدة' : 'Create a new workspace'}</button>
      </div>
    </AuthShell>
  );
}
