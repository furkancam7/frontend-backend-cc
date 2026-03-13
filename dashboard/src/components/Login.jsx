import React, { useState } from 'react';
import { login, setToken as setApiToken } from '../services/api';
import LanguageThemeControls from './LanguageThemeControls';
import { useUiTranslation } from '../i18n/useUiTranslation';

const Login = ({ setToken, setUserRole, setCurrentUser }) => {
  const { t } = useUiTranslation(['common', 'login']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const data = await login(username, password);
      if (data.access_token) {
        setApiToken(data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setToken(data.access_token);
        if (setCurrentUser) setCurrentUser(data.user);
        if (setUserRole) setUserRole(data.user.role);
      } else {
        setError(data.message || t('login.authFailed'));
      }
    } catch (err) {
      setError(t('login.connectionError'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] relative overflow-hidden font-sans selection:bg-[var(--selection-bg)] selection:text-[var(--selection-text)]">
      <LanguageThemeControls className="absolute top-4 right-4 z-20 gap-2" languageId="login-language-select" compact={false} />

      { }
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,rgba(252,88,28,0.05),transparent_50%)]"></div>
        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_100%_100%,rgba(168,85,247,0.05),transparent_50%)]"></div>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%20256%20256%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.7%22%20numOctaves%3D%224%22%20stitchTiles%3D%22stitch%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23n)%22%20opacity%3D%221%22%2F%3E%3C%2Fsvg%3E')] opacity-[0.03]"></div>
      </div>

      <div className="w-full max-w-md p-1 z-10 relative animate-in fade-in zoom-in-95 duration-500">
        { }
        <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl blur-[1px] opacity-50"></div>

        <div className="relative bg-[var(--bg-panel)] rounded-2xl border border-[var(--border-color)] shadow-2xl shadow-black/50 p-8 md:p-10 backdrop-blur-xl">

          { }
          <div className="flex flex-col items-center mb-10 space-y-4">
            <div className="w-64 h-28 md:w-72 md:h-32 bg-gradient-to-br from-[#061318] via-black to-[#0a0a0a] rounded-3xl flex items-center justify-center border border-cyan-950/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_40px_rgba(0,0,0,0.45)] mb-4 group relative overflow-hidden px-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(252,88,28,0.14),transparent_55%)] opacity-80" />
              <img
                src="/assets/stopfires.png?v=2"
                alt="StopFires"
                className="relative w-52 md:w-60 h-auto object-contain opacity-95 drop-shadow-[0_0_18px_rgba(252,88,28,0.16)] group-hover:scale-[1.03] transition-all duration-500"
              />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">{t('login.title')}</h2>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-[0.2em] mt-2 font-medium">{t('login.subtitle')}</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 text-sm text-red-400 bg-red-950/20 border border-red-900/50 rounded-lg flex items-center gap-3 animate-in slide-in-from-top-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider ml-1">{t('login.operatorId')}</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-600 group-focus-within:text-cyan-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all duration-200 sm:text-sm"
                  placeholder={t('login.usernamePlaceholder')}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider ml-1">{t('login.accessKey')}</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-600 group-focus-within:text-cyan-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all duration-200 sm:text-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-black bg-cyan-500 hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-8 relative overflow-hidden group"
            >
              {isLoading ? (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span className="relative z-10">{t('login.authenticate')}</span>
              )}
              <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[var(--border-color)] text-center">
            <p className="text-[10px] text-[var(--text-muted)] font-mono">
              <br />{t('login.securityProtocol')}<br />
              <span className="text-green-900"></span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
