import React from 'react';
import NotificationToast, { Notification } from './NotificationToast';

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const NotificationContainer: React.FC<NotificationContainerProps> = ({ notifications, onDismiss }) => {
  if (notifications.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
};

export default NotificationContainer;
