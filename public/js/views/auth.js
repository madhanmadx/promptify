import { api, getMeta, store } from '../api.js';
import { esc, toast, setLoading } from '../ui.js';

/**
 * Renders a login card and resolves once the given role is authenticated.
 * Returns { user, token } or null if the user navigates away (never resolves).
 *
 * The caller may pass `demoHint`, but it is only rendered when the server says
 * hints are allowed (`LOGIN_HINTS`) so live events never publish a password.
 */
export async function requireAuth(root, { role, heading, sub, demoHint }) {
  let hintsOn = false;
  try {
    hintsOn = Boolean((await getMeta()).loginHints);
  } catch {
    hintsOn = false;
  }
  const showHint = hintsOn && demoHint;
  const userPlaceholder = hintsOn ? (role === 'admin' ? 'admin' : 'judge1') : 'Your username';

  return new Promise((resolve) => {
    const onNav = () => { resolve(null); window.removeEventListener('hashchange', onNav); };
    window.addEventListener('hashchange', onNav, { once: true });
    const done = (value) => { window.removeEventListener('hashchange', onNav); resolve(value); };
    root.innerHTML = `
      <div class="page">
        <div class="container">
          <div class="login-wrap">
            <div class="login-brand">
              <span class="brand-mark">P</span>
              <h1 class="display">${esc(heading)}</h1>
              <p>${esc(sub)}</p>
            </div>

            <div class="card card-pad">
              <form id="loginForm" novalidate>
                <div class="field">
                  <label for="username">Username</label>
                  <input class="input" id="username" autocomplete="username" placeholder="${esc(userPlaceholder)}" />
                </div>
                <div class="field">
                  <label for="password">Password</label>
                  <input class="input" id="password" type="password" autocomplete="current-password" placeholder="••••••••" />
                </div>
                <div id="loginError" class="error-text" style="display:none"></div>
                <button class="btn btn-primary btn-lg btn-block mt-1" id="loginBtn" type="submit">Sign in</button>
              </form>
            </div>

            ${showHint ? `<div class="notice mt-2" style="text-align:center">${demoHint}</div>` : ''}

            <p class="center muted small mt-2">
              ${role === 'admin'
                ? 'Participants do not need an account — <a class="link" href="#/submit">submit an entry</a>.'
                : 'Judges receive credentials from the organizers.'}
            </p>
          </div>
        </div>
      </div>`;

    const form = root.querySelector('#loginForm');
    const btn = root.querySelector('#loginBtn');
    const err = root.querySelector('#loginError');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.style.display = 'none';
      const username = root.querySelector('#username').value.trim();
      const password = root.querySelector('#password').value;

      if (!username || !password) {
        err.textContent = 'Enter your username and password.';
        err.style.display = 'block';
        return;
      }

      setLoading(btn, true, 'Signing in…');
      try {
        const res = await api.post('/auth/login', { username, password });
        if (res.user.role !== role) {
          throw new Error(
            res.user.role === 'admin'
              ? 'That account is an organizer account — use the Organizer dashboard.'
              : 'That account is a judge account — use the Judge dashboard.'
          );
        }
        store.setSession(res.token, res.user);
        toast(`Welcome back, ${res.user.name}.`, 'success');
        done(res);
      } catch (ex) {
        err.textContent = ex.message;
        err.style.display = 'block';
      } finally {
        setLoading(btn, false);
      }
    });
  });
}
