'use strict';
/* ═══════════════════════════════════════════
   MINT — Shared login code
   Used by index.html and every topic page. Expects these globals
   from the page: account, databases, DB_ID, COLLECTIONS, Query, ID,
   showToast(). A page can define onAuthChange() to react to log in/out.
   ═══════════════════════════════════════════ */

const MIN_PASSWORD = 8;   // Appwrite's own minimum
const PASSWORD_RULE = 'Use at least 8 characters, with an uppercase letter, a lowercase letter and a number.';
/* Same rules as Auth → Policies → Password strength in Appwrite */
function passwordProblem(p) {
  return (p.length < MIN_PASSWORD || !/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) ? PASSWORD_RULE : '';
}
const USERNAME_LOGIN_FN = 'username-login';   // Appwrite Function, see appwrite/functions/
let me = null, profile = null, authMode = 'login', isAdmin = false;
const ADMIN_TEAM = 'admins';   // Appwrite team whose members can moderate

/* Row permissions: only the author can edit or delete what they post */
function ownedBy(uid) { return [`update("user:${uid}")`, `delete("user:${uid}")`]; }
function mine() { return ownedBy(me.$id); }

/* Who really created a row. Appwrite only lets a user grant rights to
   themselves, so update("user:X") on a row proves X made it. */
function rowOwner(row) {
  for (const p of row.$permissions || []) {
    const m = /^update\("user:([^"]+)"\)$/.exec(p);
    if (m) return m[1];
  }
  return null;
}
function ownedRow(row, claimedId) { return !!claimedId && rowOwner(row) === claimedId; }

/* Only plain web links: blocks javascript:, data: and similar tricks */
function safeUrl(u) {
  try {
    const x = new URL(u);
    return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '';
  } catch { return ''; }
}

/* Usernames for a set of user ids, ignoring profiles someone else created */
async function fetchUsernames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))], names = {};
  for (let i = 0; i < uniq.length; i += 100) {
    try {
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.profiles, [
        Query.equal('$id', uniq.slice(i, i + 100)), Query.limit(100)
      ]);
      res.documents.forEach(p => { if (ownedRow(p, p.$id)) names[p.$id] = p.username; });
    } catch {}
  }
  return names;
}

/* Which topic page shows a question, worked out from its tags' category */
const CATEGORY_PAGES = {
  'Algebra': 'algebra.html', 'Combinatorics': 'combinatorics.html', 'Geometry': 'geometry.html',
  'Number Theory': 'number-theory.html', 'Problem Solving': 'problem-solving.html',
};
async function questionLinks(qIds) {
  const uniq = [...new Set(qIds.filter(Boolean))], links = {};
  uniq.forEach(id => { links[id] = 'problem-solving.html?q=' + id; });
  for (let i = 0; i < uniq.length; i += 100) {
    try {
      const qt = await databases.listDocuments(DB_ID, COLLECTIONS.question_tags, [
        Query.equal('question_id', uniq.slice(i, i + 100)), Query.limit(1000)
      ]);
      const tagIds = [...new Set(qt.documents.map(x => x.tag_id))];
      if (!tagIds.length) continue;
      const tags = await databases.listDocuments(DB_ID, COLLECTIONS.tags, [Query.equal('$id', tagIds.slice(0, 100)), Query.limit(100)]);
      const cat = Object.fromEntries(tags.documents.map(t => [t.$id, t.category]));
      qt.documents.forEach(x => {
        const page = CATEGORY_PAGES[cat[x.tag_id]];
        if (page) links[x.question_id] = page + '?q=' + x.question_id;
      });
    } catch {}
  }
  return links;
}

/* Vote totals, kept up to date on the server by the vote-tally function.
   Returns { itemId: { up, down } } for the ids asked for. */
async function fetchVoteTotals(ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    try {
      const res = await databases.listDocuments(DB_ID, 'vote_totals', [
        Query.equal('$id', uniq.slice(i, i + 100)), Query.limit(100)
      ]);
      res.documents.forEach(t => { out[t.$id] = { up: t.upvotes || 0, down: t.downvotes || 0 }; });
    } catch {}
  }
  return out;
}

/* Slow down accidental double posts and casual spam. Real limits live in Appwrite. */
const COMMENT_MAX = 2000;
const _lastAction = {};
function throttle(kind, ms = 3000) {
  const now = Date.now();
  if (now - (_lastAction[kind] || 0) < ms) {
    showToast('Please wait a few seconds before posting again.', 'error');
    return false;
  }
  _lastAction[kind] = now;
  return true;
}

/* ── SESSION ── */
async function initAuth() {
  await finishGoogleLogin();
  try {
    me = await account.get();
    await fetchProfile(me);
  } catch {
    me = null;   // 401 just means nobody is logged in
  }
  await checkAdmin();
  refreshHeader();
  promptUsernameIfMissing();
}

/* Admin = member of the "admins" team. The server enforces what admins can do;
   this only decides whether to show the Admin button. */
async function checkAdmin() {
  isAdmin = false;
  if (!me) return;
  try {
    const res = await new Appwrite.Teams(client).list();
    isAdmin = res.teams.some(t => t.$id === ADMIN_TEAM);
  } catch {}
}

/* profile = { username } when they have one, null when they still need to pick one */
async function fetchProfile(user) {
  profile = null;
  try {
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.profiles, user.$id);
    if (ownedRow(doc, user.$id)) profile = { username: doc.username };
  } catch (e) {
    if (e?.code !== 404) profile = { username: user.email.split('@')[0] };   // network hiccup: don't nag
  }
}

function refreshHeader() {
  const pill = document.getElementById('userPill'), btn = document.getElementById('authBtn');
  if (me) {
    document.getElementById('pillName').textContent = profile?.username || 'Choose a username';
    pill.classList.remove('hidden');
    pill.title = profile ? 'Your profile' : '';
    pill.style.cursor = profile ? 'pointer' : '';
    pill.onclick = () => { if (profile) location.href = 'profile.html?u=' + encodeURIComponent(profile.username); };
    btn.textContent = 'Log out';
    btn.onclick = logOut;
  } else {
    pill.classList.add('hidden');
    pill.onclick = null;
    btn.textContent = 'Log in';
    // Pages without a login box (admin, profile, reset) send people to the home page to log in
    btn.onclick = document.getElementById('authOverlay') ? openAuthModal : () => { location.href = 'index.html'; };
  }
  let adminLink = document.getElementById('adminLink');
  if (me && isAdmin && !adminLink) {
    adminLink = document.createElement('a');
    adminLink.id = 'adminLink'; adminLink.className = 'btn btn-ghost btn-sm'; adminLink.href = 'admin.html';
    adminLink.textContent = 'Admin';
    btn.before(adminLink);
  }
  if (adminLink) adminLink.classList.toggle('hidden', !(me && isAdmin));
  if (typeof onAuthChange === 'function') onAuthChange();
}

async function logOut() {
  try { await account.deleteSession('current'); } catch {}
  me = null; profile = null; isAdmin = false;
  closeUsernameModal();
  refreshHeader();
  showToast('Logged out', 'success');
}

/* ── CHOOSE A USERNAME (Google sign-ups, or anyone without a profile yet) ── */
function promptUsernameIfMissing() {
  if (me && !profile) openUsernameModal();
}
function openUsernameModal() {
  let ov = document.getElementById('usernameOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'modal-overlay'; ov.id = 'usernameOverlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-labelledby="unameTitle">
      <div class="modal-title" id="unameTitle">Choose a username</div>
      <div class="modal-sub">This is how other people will see you on MINT. Use 3–20 letters, numbers or underscores.</div>
      <div class="auth-msg err" id="unameErr"></div>
      <div class="form-group"><label class="form-label" for="unameInput">Username</label>
        <input class="form-input" id="unameInput" maxlength="20" autocomplete="username" spellcheck="false" placeholder="your_username" /></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="unameLogout">Log out</button>
        <button class="btn btn-primary" id="unameSave">Save username</button></div>
    </div>`;
    document.body.appendChild(ov);
    document.getElementById('unameSave').addEventListener('click', saveUsername);
    document.getElementById('unameLogout').addEventListener('click', logOut);
    document.getElementById('unameInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveUsername(); });
  }
  // Suggest something from their Google name
  const input = document.getElementById('unameInput');
  if (!input.value) input.value = (me.name || me.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 20);
  document.getElementById('unameErr').style.display = 'none';
  ov.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 80);
}
function closeUsernameModal() {
  document.getElementById('usernameOverlay')?.classList.remove('open');
}
async function saveUsername() {
  const input = document.getElementById('unameInput'), btn = document.getElementById('unameSave');
  const err = document.getElementById('unameErr');
  const fail = msg => { err.textContent = msg; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Save username'; };
  const username = input.value.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail('Use 3–20 letters, numbers or underscores.');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const taken = await databases.listDocuments(DB_ID, COLLECTIONS.profiles, [Query.equal('username', username), Query.limit(1)]);
    if (taken.documents.length) return fail('That username is taken. Try another.');
    await databases.createDocument(DB_ID, COLLECTIONS.profiles, me.$id, { username }, [`update("user:${me.$id}")`]);
  } catch (e) {
    if (e?.code === 409) return fail('That username is taken. Try another.');
    return fail(niceErr(e));
  }
  profile = { username };
  closeUsernameModal();
  refreshHeader();
  showToast(`Welcome to MINT, ${username}!`, 'success');
}

/* Logged out in another tab, or the session expired */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !me) return;
  try {
    await account.getSession('current');
  } catch {
    me = null; profile = null;
    closeUsernameModal();
    refreshHeader();
    showToast('Session expired. Please log in again.', 'error');
  }
});

/* ── MODAL ── */
function bindAuthModal() {
  document.getElementById('authOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeAuthModal(); });
  document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
  document.getElementById('loginTab').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('signupTab').addEventListener('click', () => switchAuthTab('signup'));
  document.getElementById('authCancelBtn').addEventListener('click', closeAuthModal);
  document.getElementById('authSubmitBtn').addEventListener('click', handleAuthSubmit);
  document.getElementById('forgotLink')?.addEventListener('click', () => switchAuthTab('forgot'));
}
const SUBMIT_LABEL = { login: 'Log in', signup: 'Create account', forgot: 'Send reset link' };

function openAuthModal() {
  document.getElementById('authOverlay').classList.add('open');
  switchAuthTab('login');
  setTimeout(() => document.getElementById('authIdent').focus(), 80);
}
function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
  ['authIdent','authEmail','authUser','authPass'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  setAuthMsg('err',''); setAuthMsg('ok','');
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = false;
  btn.textContent = SUBMIT_LABEL[authMode];
}
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('loginTab').classList.toggle('active', mode === 'login');
  document.getElementById('signupTab').classList.toggle('active', mode === 'signup');
  document.getElementById('authSubmitBtn').textContent = SUBMIT_LABEL[mode];
  document.getElementById('identWrap').classList.toggle('hidden', mode !== 'login');
  document.getElementById('emailWrap').classList.toggle('hidden', mode === 'login');
  document.getElementById('userWrap').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('passWrap')?.classList.toggle('hidden', mode === 'forgot');
  document.getElementById('forgotLink')?.classList.toggle('hidden', mode !== 'login');
  document.getElementById('authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  setAuthMsg('err',''); setAuthMsg('ok','');
}
function setAuthMsg(t, txt) {
  const el = document.getElementById(t === 'err' ? 'authErr' : 'authOk');
  el.textContent = txt; el.style.display = txt ? 'block' : 'none';
  document.getElementById(t === 'err' ? 'authOk' : 'authErr').style.display = 'none';
}

/* Google login uses a one-time token handed back in the URL instead of an
   Appwrite cookie, because browsers block cookies from appwrite.io on our site */
function handleGoogleSignIn() {
  const back = new URL(location.href);
  ['userId', 'secret', 'login'].forEach(k => back.searchParams.delete(k));
  const failed = new URL(back); failed.searchParams.set('login', 'failed');
  account.createOAuth2Token('google', back.href, failed.href);
}

/* Coming back from Google: swap the token for a session, then tidy the URL */
async function finishGoogleLogin() {
  const url = new URL(location.href);
  const userId = url.searchParams.get('userId'), secret = url.searchParams.get('secret');
  const failed = url.searchParams.get('login') === 'failed';
  if (!userId && !secret && !failed) return;
  ['userId', 'secret', 'login'].forEach(k => url.searchParams.delete(k));
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  if (failed) { showToast('Google sign-in was cancelled or failed.', 'error'); return; }
  try { await account.createSession(userId, secret); }
  catch (e) { showToast('Google sign-in failed: ' + niceErr(e), 'error'); }
}

/* Usernames are checked on the server so nobody's email is ever public */
async function loginWithUsername(username, password) {
  const fn = new Appwrite.Functions(client);
  const exec = await fn.createExecution(USERNAME_LOGIN_FN, JSON.stringify({ username, password }), false, '/', 'POST');
  let res = {};
  try { res = JSON.parse(exec.responseBody || '{}'); } catch {}
  if (res.secret) return account.createSession(res.userId, res.secret);
  const err = new Error(res.error || 'login_failed');
  err.type = res.error === 'invalid_credentials' ? 'user_invalid_credentials'
           : res.error === 'rate_limited' ? 'general_rate_limit_exceeded' : '';
  throw err;
}

async function handleAuthSubmit() {
  const pass = document.getElementById('authPass').value;
  const btn  = document.getElementById('authSubmitBtn');
  const idle = SUBMIT_LABEL[authMode];
  const fail = msg => { setAuthMsg('err', msg); btn.disabled = false; btn.textContent = idle; };

  if (authMode === 'forgot') {
    const email = document.getElementById('authEmail').value.trim();
    if (!email) return setAuthMsg('err', 'Please enter the email you signed up with.');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await account.createRecovery(email, location.origin + '/reset.html');
    } catch (e) {
      if (e?.type === 'general_rate_limit_exceeded') return fail(niceErr(e));
      // Any other error (e.g. no such account): say the same thing, so emails can't be probed
    }
    btn.disabled = false; btn.textContent = idle;
    setAuthMsg('ok', 'If an account uses that email, a reset link is on its way. Check your inbox.');
    return;
  }

  if (!pass || pass.length < MIN_PASSWORD) { setAuthMsg('err', `Password must be at least ${MIN_PASSWORD} characters.`); return; }
  btn.disabled = true;

  if (authMode === 'login') {
    const ident = document.getElementById('authIdent').value.trim();
    if (!ident) return fail('Please enter your email or username.');
    btn.textContent = 'Logging in…';
    try {
      if (ident.includes('@')) await account.createEmailPasswordSession(ident, pass);
      else await loginWithUsername(ident, pass);
      me = await account.get();
      await fetchProfile(me);
      await checkAdmin();
      refreshHeader();
      closeAuthModal();
      showToast('Welcome back!', 'success');
      promptUsernameIfMissing();
    } catch (e) { fail(niceErr(e)); }
    return;
  }

  const email    = document.getElementById('authEmail').value.trim();
  const username = document.getElementById('authUser').value.trim();
  if (!email)    return fail('Please enter your email.');
  if (!username) return fail('Please choose a username.');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail('Username: 3–20 chars, letters/numbers/underscores.');
  if (passwordProblem(pass)) return fail(passwordProblem(pass));
  btn.textContent = 'Creating account…';
  try {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.profiles, [
      Query.equal('username', username), Query.limit(1)
    ]);
    if (res.documents.length) return fail('Username already taken.');
  } catch {}
  try {
    await account.create(ID.unique(), email, pass, username);
    await account.createEmailPasswordSession(email, pass);
    me = await account.get();
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.profiles, me.$id, { username }, [`update("user:${me.$id}")`]);
      profile = { username };
    } catch {
      // Someone grabbed the name a moment ago: ask for another one
      profile = null;
    }
    refreshHeader();
    closeAuthModal();
    if (profile) showToast('Welcome to MINT!', 'success');
    else promptUsernameIfMissing();
  } catch (e) { fail(niceErr(e)); }
}

/* Turn Appwrite errors into plain messages; fall back to Appwrite's own text */
function niceErr(e) {
  const type = e?.type || '', m = e?.message || '';
  switch (type) {
    case 'user_invalid_credentials':     return 'Incorrect username, email or password.';
    case 'user_already_exists':
    case 'user_email_already_exists':    return 'An account with that email already exists.';
    case 'user_blocked':                 return 'This account has been blocked.';
    case 'user_session_already_exists':  return 'You are already logged in. Refresh the page.';
    case 'user_password_recently_used':  return 'Please choose a password you have not used recently.';
    case 'user_password_personal_data':  return 'Your password must not contain your name or email.';
    case 'general_rate_limit_exceeded':  return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/invalid `email`|valid email/i.test(m))   return 'Please enter a valid email address.';
  if (/commonly used password/i.test(m))         return 'That password is too common. Please choose another.';
  if (/password/i.test(m) && /characters|uppercase|lowercase|number/i.test(m)) return PASSWORD_RULE;
  return m || 'Something went wrong. Please try again.';
}
