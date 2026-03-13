import { useState, useCallback } from 'react';
import { setToken as setApiToken } from '../services/api';

const parseStoredUser = () => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    console.error('Failed to parse user data:', e);
    return null;
  }
};

export default function useAuth() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState(() => parseStoredUser());
  const userRole = currentUser?.role || null;

  const setUserRole = useCallback((role) => {
    setCurrentUser(prev => ({ ...(prev || {}), role }));
  }, []);

  const isUserAdmin = userRole === 'admin';

  const handleLogout = useCallback(() => {
    setApiToken(null);
    setCurrentUser(null);
    window.location.reload();
  }, []);

  const handleUnauthorized = useCallback(() => {
    setApiToken(null);
    setToken(null);
    setCurrentUser(null);
  }, []);

  return {
    token,
    setToken,
    currentUser,
    setCurrentUser,
    userRole,
    setUserRole,
    isUserAdmin,
    handleLogout,
    handleUnauthorized
  };
}
