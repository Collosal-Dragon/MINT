'use strict';
/* ═══════════════════════════════════════════
   MINT — Shared setup for the standalone pages (admin, profile, reset).
   Load after the Appwrite SDK and mint-auth.js. Each page puts
   <header id="siteHeader"></header> in its body and calls startPage().
   ═══════════════════════════════════════════ */

const PROJECT_ID = '69f87cc5001ba9cd97e5';
const DB_ID = 'public';
const client    = new Appwrite.Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject(PROJECT_ID);
const account   = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const { ID, Query } = Appwrite;
const COLLECTIONS = {
  profiles: 'profiles', questions: 'questions', question_tags: 'question_tags', tags: 'tags',
  intuitions: 'intuitions', takeaways: 'takeaways', votes: 'votes', links: 'links',
  comments: 'comments', reports: 'reports',
};

function esc(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : '';
}
function ago(ts) {
  const d = Date.now() - new Date(ts), m = ~~(d/6e4), h = ~~(d/36e5), dy = ~~(d/864e5);
  return m<1 ? 'just now' : m<60 ? `${m}m ago` : h<24 ? `${h}h ago` : dy<7 ? `${dy}d ago` : `${~~(dy/7)}w ago`;
}
function showToast(msg, type = 'success') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = `toast ${type}`; t.setAttribute('role', 'status');
  t.append(String(msg));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function renderMath(el) {
  if (window.renderMathInElement) renderMathInElement(el, {
    delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError: false
  });
}

const LOGO_SVG = `<svg class="logo-mark-svg" width="40" height="40" viewBox="0 0 500 500" aria-hidden="true">
  <defs><clipPath id="clipTriangle"><polygon points="250,30 475,420 25,420"/></clipPath></defs>
  <g clip-path="url(#clipTriangle)">
    <polygon points="250,30 475,420 25,420" fill="#7ec7b4"/><polygon points="250,30 362,225 250,160 138,225" fill="#9fd8c8"/>
    <polygon points="25,420 138,225 250,420" fill="#8ccbb9"/><polygon points="475,420 362,225 250,420" fill="#6fb3a3"/>
    <polygon points="250,160 362,225 250,290 138,225" fill="#c9efe3"/><polygon points="138,225 250,290 250,420 138,355" fill="#8fd0b6"/>
    <polygon points="362,225 250,290 250,420 362,355" fill="#76bca8"/><polygon points="25,420 138,355 250,420" fill="#5aa094"/>
    <polygon points="475,420 362,355 250,420" fill="#4f9186"/>
  </g></svg>`;

function applyTheme(t) { document.documentElement.className = t; }

async function startPage() {
  document.getElementById('siteHeader').innerHTML = `<div class="header-inner">
    <a class="logo" href="index.html">${LOGO_SVG}
      <div class="logo-text"><span class="logo-name">MINT</span><span class="logo-tagline">Math Olympiad Intuition</span></div></a>
    <div class="header-right">
      <button class="theme-btn" id="themeBtn" aria-label="Switch light or dark theme" title="Switch theme">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <div class="user-pill hidden" id="userPill"><span class="user-pill-dot"></span><span id="pillName"></span></div>
      <button class="btn btn-ghost btn-sm" id="authBtn">Log in</button>
    </div></div>`;
  document.getElementById('themeBtn').addEventListener('click', () => {
    const t = document.documentElement.className === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', t); } catch {}
    applyTheme(t);
  });
  await initAuth();
}
