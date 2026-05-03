import React from 'react';
import { useNavigate } from 'react-router-dom';

// Reusable empty/loading/error state UI. Matches the rest of the app's
// design language: soft card, optional icon, title, body, action buttons.

export function StateScreen({ theme, icon, title, body, primary, secondary, tone = 'neutral' }) {
  // tone: 'neutral' | 'error' | 'warn' | 'info' | 'success'
  const toneColor = (
    tone === 'error'   ? '#DC2626' :
    tone === 'warn'    ? '#D97706' :
    tone === 'info'    ? theme.accent :
    tone === 'success' ? '#0E7C66' :
    theme.muted
  );
  const toneBg = (
    tone === 'error' ? '#FEE2E2' :
    tone === 'warn'  ? '#FEF3C7' :
    tone === 'info'  ? theme.accentSoft :
    tone === 'success' ? '#D7F1E9' :
    theme.surface2
  );

  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32, minHeight: 0,
    }}>
      <div style={{
        maxWidth: 440, width: '100%', textAlign: 'center',
        background: theme.surface, color: theme.text,
        border: `.5px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: '36px 32px',
        boxShadow: theme.shadow,
      }}>
        {icon && (
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: tone === 'neutral' ? theme.surface2 : toneBg,
            color: toneColor,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 18,
          }}>
            {icon}
          </div>
        )}
        <h2 style={{
          margin: 0, fontSize: 18, fontWeight: 700, color: theme.text,
          letterSpacing: '-.01em',
        }}>{title}</h2>
        {body && (
          <p style={{
            margin: '8px 0 0', fontSize: 13, lineHeight: 1.55,
            color: theme.muted, textWrap: 'balance',
          }}>{body}</p>
        )}
        {(primary || secondary) && (
          <div style={{
            display: 'flex', gap: 8, justifyContent: 'center',
            marginTop: 22, flexWrap: 'wrap',
          }}>
            {primary && (
              <button onClick={primary.onClick} style={{
                padding: '8px 16px', borderRadius: 7,
                background: theme.accent, color: theme.accentText, border: 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>{primary.label}</button>
            )}
            {secondary && (
              <button onClick={secondary.onClick} style={{
                padding: '8px 16px', borderRadius: 7,
                background: 'transparent', color: theme.muted,
                border: `.5px solid ${theme.border}`,
                fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}>{secondary.label}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Specialized error screen that picks the right icon + copy for common cases.
export function BoardError({ theme, rtl, error, onRetry }) {
  const navigate = useNavigate();
  const status = error?.status || 0;
  const code = error?.code || '';

  // Forbidden / no access
  if (status === 403 || code === 'forbidden') {
    return (
      <StateScreen
        theme={theme}
        tone="warn"
        icon={
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        }
        title={rtl ? 'لا تملك صلاحية الوصول' : 'No access to this board'}
        body={rtl
          ? 'هذه اللوحة مرئية لأعضاء قسم آخر. تواصل مع مسؤول المساحة لطلب الوصول.'
          : "This board belongs to another department. Contact your workspace admin if you need access."}
        primary={{
          label: rtl ? 'الرجوع للوحات' : 'Back to boards',
          onClick: () => navigate('/boards'),
        }}
      />
    );
  }

  // Not found
  if (status === 404 || code === 'not_found') {
    return (
      <StateScreen
        theme={theme}
        icon={
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5h.01" />
          </svg>
        }
        title={rtl ? 'اللوحة غير موجودة' : 'Board not found'}
        body={rtl
          ? 'ربما تم حذف هذه اللوحة أو الرابط غير صحيح.'
          : 'This board may have been deleted or the link is incorrect.'}
        primary={{
          label: rtl ? 'الرجوع للوحات' : 'Back to boards',
          onClick: () => navigate('/boards'),
        }}
      />
    );
  }

  // Network / server error — generic
  return (
    <StateScreen
      theme={theme}
      tone="error"
      icon={
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      }
      title={rtl ? 'تعذّر تحميل اللوحة' : "Couldn't load this board"}
      body={error?.message || (rtl ? 'حدث خطأ غير متوقع.' : 'Something went wrong.')}
      primary={onRetry ? {
        label: rtl ? 'إعادة المحاولة' : 'Try again',
        onClick: onRetry,
      } : undefined}
      secondary={{
        label: rtl ? 'الرجوع للوحات' : 'Back to boards',
        onClick: () => navigate('/boards'),
      }}
    />
  );
}

// Generic loading state — used when first opening a page.
export function LoadingScreen({ theme, rtl, label }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32, color: theme.muted, fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Spinner color={theme.muted} />
        <span>{label || (rtl ? 'جاري التحميل…' : 'Loading…')}</span>
      </div>
    </div>
  );
}

function Spinner({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'sarsync-spin 1s linear infinite' }}>
      <path d="M12 3a9 9 0 0 1 9 9" />
      <style>{`@keyframes sarsync-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
