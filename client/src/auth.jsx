import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const handleAuth = (d) => {
    setToken(d.token);
    setUser(d.user);
  };

  const value = {
    user,
    loading,
    login: (username, password, portal = 'user') =>
      api('/auth/login', { method: 'POST', body: { username, password, portal } }).then((d) => {
        handleAuth(d);
        return d.user;
      }),
    register: (form) => api('/auth/register', { method: 'POST', body: form }).then(handleAuth),
    logout: () => {
      setToken(null);
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
