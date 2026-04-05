import React, { createContext, useContext, useMemo, useState } from 'react';

type NotificationBadgeContextValue = {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
};

const NotificationBadgeContext = createContext<NotificationBadgeContextValue | null>(null);

export function NotificationBadgeProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCountState] = useState(0);

  const setUnreadCount = (count: number) => {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    setUnreadCountState(safeCount);
  };

  const value = useMemo(
    () => ({
      unreadCount,
      setUnreadCount,
    }),
    [unreadCount],
  );

  return <NotificationBadgeContext.Provider value={value}>{children}</NotificationBadgeContext.Provider>;
}

export function useNotificationBadge(): NotificationBadgeContextValue {
  const context = useContext(NotificationBadgeContext);

  if (!context) {
    return {
      unreadCount: 0,
      setUnreadCount: () => {
        return;
      },
    };
  }

  return context;
}
