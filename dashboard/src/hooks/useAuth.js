import { useState, useCallback } from 'react';

const clearAuthData = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

export default function useAuth() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [userRole, setUserRole] = useState(() => {
    const userStr = localStorage.getItem('user');
    try {
      return userStr ? JSON.parse(userStr).role : null;
    } catch (e) {
      console.error('Failed to parse user data:', e);
      return null;
    }
  });

  const isUserAdmin = userRole === 'admin';
  const handleLogout = useCallback(() => {
    clearAuthData();
    setToken(null);
    setUserRole(null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    clearAuthData();
    setToken(null);
    setUserRole(null);
  }, []);

  return {
    token,
    setToken,
    userRole,
    setUserRole,
    isUserAdmin,
    handleLogout,
    handleUnauthorized
  };
}
