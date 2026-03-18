import React, { useEffect, useState } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  details?: string;
  actions?: NotificationAction[];
  autoDismissMs?: number;
}

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

const typeStyles: Record<NotificationType, { bg: string; border: string; icon: string; color: string }> = {
  success: { bg: '#d4edda', border: '#c3e6cb', icon: '✅', color: '#155724' },
  error: { bg: '#f8d7da', border: '#f5c6cb', icon: '❌', color: '#721c24' },
  warning: { bg: '#fff3cd', border: '#ffeeba', icon: '⚠️', color: '#856404' },
  info: { bg: '#d1ecf1', border: '#bee5eb', icon: 'ℹ️', color: '#0c5460' },
};

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const style = typeStyles[notification.type];

  useEffect(() => {
    const dismissMs = notification.autoDismissMs ?? (notification.type === 'error' ? 8000 : 4000);
    if (dismissMs > 0) {
      const exitTimer = setTimeout(() => setIsExiting(true), dismissMs - 300);
      const removeTimer = setTimeout(() => onDismiss(notification.id), dismissMs);
      return () => {
        clearTimeout(exitTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [notification.id, notification.type, notification.autoDismissMs, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 16px',
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: '6px',
        color: style.color,
        fontSize: '13px',
        lineHeight: '1.5',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? 'translateX(100%)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        maxWidth: '420px',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{style.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{notification.message}</div>
        {notification.details && (
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.85 }}>
            {notification.details}
          </div>
        )}
        {notification.actions && notification.actions.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {notification.actions.map((action, i) => (
              <button
                key={i}
                onClick={action.onClick}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  backgroundColor: 'transparent',
                  color: style.color,
                  border: `1px solid ${style.color}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss notification"
        style={{
          background: 'none',
          border: 'none',
          color: style.color,
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 2px',
          opacity: 0.6,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
};

export default NotificationToast;
