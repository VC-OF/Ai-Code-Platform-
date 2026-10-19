'use client';

import { useState } from 'react';
import type { SafeUser } from '@/lib/auth';

interface AuthModalProps {
  user: SafeUser | null;
  onClose: () => void;
  onUserChange: (user: SafeUser | null) => void;
}

export default function AuthModal({ user, onClose, onUserChange }: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = tab === 'login' ? { email, password } : { email, name, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onUserChange(data.user);
      window.dispatchEvent(new CustomEvent('oc-auth-changed', { detail: { user: data.user } }));
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      onUserChange(null);
      window.dispatchEvent(new CustomEvent('oc-auth-changed', { detail: { user: null } }));
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-header">
          <div className="auth-title-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={20} height={20}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <h3>{user ? 'Account Profile' : 'Developer Authentication'}</h3>
          </div>
          <button type="button" className="auth-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {error && <div className="auth-error-banner">{error}</div>}

        {user ? (
          <div className="auth-profile-view">
            <div className="profile-badge-row">
              <div className="profile-large-avatar">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="profile-info">
                <h4>{user.name}</h4>
                <p className="profile-email">{user.email}</p>
                <span className="role-tag">{user.role}</span>
              </div>
            </div>

            <div className="profile-meta">
              <div className="meta-item">
                <span className="meta-label">Member Since</span>
                <span className="meta-val">{new Date(user.created_at).toLocaleDateString()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">User ID</span>
                <span className="meta-val font-mono">{user.id}</span>
              </div>
            </div>

            <div className="auth-actions">
              <button
                type="button"
                className="btn-danger"
                onClick={handleLogout}
                disabled={loading}
              >
                {loading ? 'Signing out…' : 'Sign Out'}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-form-container">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
                onClick={() => { setTab('login'); setError(null); }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
                onClick={() => { setTab('register'); setError(null); }}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              {tab === 'register' && (
                <div className="form-group">
                  <label htmlFor="auth-name">Full Name</label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Morgan"
                    disabled={loading}
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="auth-email">Email Address</label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === 'register' ? 'At least 6 characters' : 'Enter password'}
                  disabled={loading}
                  minLength={6}
                />
              </div>

              <div className="auth-actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading
                    ? 'Processing…'
                    : tab === 'login'
                    ? 'Sign In'
                    : 'Create Account'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <style jsx>{`
          .auth-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }
          .auth-modal {
            background: var(--bg-surface, #1e1e24);
            border: 1px solid var(--border-subtle, #333);
            border-radius: 12px;
            width: 420px;
            max-width: 92vw;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            color: var(--text-primary, #f3f4f6);
          }
          .auth-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border-subtle, #333);
            background: var(--bg-elevated, #25252d);
          }
          .auth-title-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
          }
          .auth-title-row h3 {
            margin: 0;
            font-size: 15px;
          }
          .auth-close-btn {
            background: none;
            border: none;
            color: var(--text-muted, #9ca3af);
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
          }
          .auth-close-btn:hover {
            color: #fff;
          }
          .auth-error-banner {
            padding: 8px 16px;
            background: rgba(239, 68, 68, 0.15);
            border-left: 3px solid #ef4444;
            color: #fca5a5;
            font-size: 12px;
            margin: 12px 18px 0;
            border-radius: 4px;
          }
          .auth-tabs {
            display: flex;
            border-bottom: 1px solid var(--border-subtle, #333);
            margin-bottom: 16px;
          }
          .auth-tab {
            flex: 1;
            padding: 12px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-muted, #9ca3af);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
          }
          .auth-tab.active {
            color: var(--accent-primary, #3b82f6);
            border-bottom-color: var(--accent-primary, #3b82f6);
            font-weight: 600;
          }
          .auth-form-container {
            padding: 0 18px 18px;
          }
          .auth-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .form-group label {
            font-size: 12px;
            color: var(--text-muted, #9ca3af);
          }
          .form-group input {
            background: var(--bg-base, #141418);
            border: 1px solid var(--border-subtle, #3a3a46);
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 13px;
            color: #fff;
            outline: none;
          }
          .form-group input:focus {
            border-color: var(--accent-primary, #3b82f6);
          }
          .auth-actions {
            display: flex;
            gap: 10px;
            margin-top: 16px;
          }
          .btn-primary {
            flex: 1;
            padding: 9px 14px;
            border-radius: 6px;
            background: var(--accent-primary, #3b82f6);
            color: #fff;
            font-weight: 500;
            font-size: 13px;
            border: none;
            cursor: pointer;
            transition: opacity 0.15s;
          }
          .btn-primary:hover:not(:disabled) {
            opacity: 0.9;
          }
          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .btn-secondary {
            padding: 9px 14px;
            border-radius: 6px;
            background: var(--bg-elevated, #2c2c36);
            border: 1px solid var(--border-subtle, #444);
            color: var(--text-primary, #f3f4f6);
            font-size: 13px;
            cursor: pointer;
          }
          .btn-danger {
            flex: 1;
            padding: 9px 14px;
            border-radius: 6px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #ef4444;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
          }
          .btn-danger:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.25);
          }
          .auth-profile-view {
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .profile-badge-row {
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .profile-large-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 700;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          }
          .profile-info h4 {
            margin: 0;
            font-size: 16px;
          }
          .profile-email {
            margin: 2px 0 6px;
            font-size: 12px;
            color: var(--text-muted, #9ca3af);
          }
          .role-tag {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(59, 130, 246, 0.15);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
          }
          .profile-meta {
            background: var(--bg-base, #141418);
            border: 1px solid var(--border-subtle, #333);
            border-radius: 8px;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .meta-item {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }
          .meta-label {
            color: var(--text-muted, #9ca3af);
          }
          .font-mono {
            font-family: var(--font-mono, monospace);
          }
        `}</style>
      </div>
    </div>
  );
}
