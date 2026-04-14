
'use strict';

/* ── SUPABASE ─────────────────────────────────────────── */
const SUPABASE_URL = 'https://idlrmpecdvsofaykphfe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbHJtcGVjZHZzb2ZheWtwaGZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzk5NTAsImV4cCI6MjA4OTgxNTk1MH0.FWSllmspL4twQ1aF2q20---HmoLxBM1NqFnQ2OPOoUg';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── STATE ────────────────────────────────────────────── */
let me = null, profile = null, authMode = 'login';
let questions = [], intuitions = {}, takeaways = {};
let questionVotes = {}, intuitionVotes = {}, takeawayVotes = {};
let selectedQuestion = null, activeSubtopic = null, activeSsc = null, activeSscType = null;
let currentSort = 'relevance', currentDetailTab = 'intuitions', currentDetailSort = 'relevance';
let idCounter = 9000;
const formState = {
  statement:'', explanation:'', explanationLinks:[], exampleLink:'',
  exampleExplanation:'', takeawayContent:'', takeawayLinks:[],
  intImageFile: null, takImageFile: null
};
const gIntState = { selectedQIds: new Set(), links: [], imageFile: null };
const gTakState = { selectedQIds: new Set(), links: [], imageFile: null };
let selectedSubTopics = new Set();
let selectedNewQTags = new Set();

/* ── TAG HELPERS ──────────────────────────────────────── */
function sscTagName(sub, sscName, type) { return `${sub}::${sscName}::${type}`; }
function parseSscTag(tag) {
  const p = tag.split('::');
  return p.length === 3 ? { sub: p[0], name: p[1], type: p[2] } : null;
}

/* ── GENERAL HELPERS ──────────────────────────────────── */
function ago(ts) {
  const d=Date.now()-new Date(ts),m=~~(d/6e4),h=~~(d/36e5),dy=~~(d/864e5);
  return m<1?'just now':m<60?`${m}m ago`:h<24?`${h}h ago`:dy<7?`${dy}d ago`:`${~~(dy/7)}w ago`;
}
function esc(s) {
  return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
}
function processText(raw) {
  if (!raw) return '';
  return esc(raw).replace(/\|\|([^|]+)\|\|/g, (_,c) => `<span class="spoiler" onclick="this.classList.toggle('revealed')">${c}</span>`);
}
function renderMath(el) {
  if (window.renderMathInElement) renderMathInElement(el, {
    delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],
    throwOnError:false
  });
}
function isValidURL(s) { try { new URL(s); return true; } catch { return false; } }
function getParam(n) { return new URLSearchParams(window.location.search).get(n); }
function showToast(msg, type='success') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = `toast ${type}`;
  const icon = type==='success'
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
  t.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${icon}</svg> ${msg}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function highlightText(text, query) {
  if (!query || !text) return esc(text || '');
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return esc(text).replace(re, '<span class="hl">$1</span>');
}
async function fetchVoteCounts(ids, type) {
  if (!ids.length) return {};
  try {
    const { data } = await db.from('vote_counts').select('target_id,upvotes,downvotes')
      .eq('target_type',type).in('target_id',ids);
    const m = {};
    (data||[]).forEach(v => { m[v.target_id] = { upvotes:+v.upvotes, downvotes:+v.downvotes }; });
    return m;
  } catch { return {}; }
}
async function uploadImage(file) {
  const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const { error } = await db.storage.from('post-images').upload(fileName, file, { cacheControl:'3600', upsert:false });
  if (error) throw error;
  const { data: urlData } = db.storage.from('post-images').getPublicUrl(fileName);
  return urlData.publicUrl;
}

/* ── THEME ────────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.className = t;
  document.getElementById('iconDark').classList.toggle('hidden', t==='dark');
  document.getElementById('iconLight').classList.toggle('hidden', t==='light');
}

/* ── AUTH ─────────────────────────────────────────────── */
db.auth.onAuthStateChange(async (ev, session) => {
  me = session?.user ?? null;
  if (me) {
    if (!profile) profile = { username: me.user_metadata?.username || me.user_metadata?.full_name || me.email.split('@')[0] };
    refreshHeader();
    fetchProfile(me);
  } else { profile = null; refreshHeader(); }
  if (ev === 'SIGNED_IN' && document.getElementById('authOverlay').classList.contains('open')) {
    closeAuthModal(); showToast('Welcome back!', 'success');
  }
  if (selectedQuestion) renderPostForm();
});

async function fetchProfile(user) {
  const { data } = await db.from('profiles').select('username,email').eq('id', user.id).maybeSingle();
  if (data) { profile = data; refreshHeader(); return; }
  const base = (user.user_metadata?.full_name || user.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,16);
  const username = base + '_' + Math.random().toString(36).slice(2,5);
  const { data: ins } = await db.from('profiles').insert({ id:user.id, username, email:user.email }).select('username,email').maybeSingle();
  profile = ins ?? null; refreshHeader();
}

function refreshHeader() {
  const pill = document.getElementById('userPill'), btn = document.getElementById('authBtn');
  if (me) {
    document.getElementById('pillName').textContent = profile?.username || me.email.split('@')[0];
    pill.classList.remove('hidden');
    btn.textContent = 'Log out';
    btn.onclick = () => { profile = null; db.auth.signOut().then(() => showToast('Logged out','success')); };
  } else {
    pill.classList.add('hidden');
    btn.textContent = 'Log in'; btn.onclick = openAuthModal;
  }
}

async function handleGoogleSignIn() {
  const { error } = await db.auth.signInWithOAuth({
    provider:'google',
    options:{ redirectTo: location.origin + location.pathname, queryParams:{ access_type:'offline', prompt:'consent' } }
  });
  if (error) showToast('Google sign-in failed: ' + error.message, 'error');
}

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
  if (btn) { btn.disabled = false; btn.textContent = authMode==='login' ? 'Log in' : 'Create account'; }
}
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('loginTab').classList.toggle('active', mode==='login');
  document.getElementById('signupTab').classList.toggle('active', mode==='signup');
  document.getElementById('authSubmitBtn').textContent = mode==='login' ? 'Log in' : 'Create account';
  document.getElementById('identWrap').classList.toggle('hidden', mode==='signup');
  document.getElementById('emailWrap').classList.toggle('hidden', mode==='login');
  document.getElementById('userWrap').classList.toggle('hidden', mode==='login');
  document.getElementById('authPass').autocomplete = mode==='login' ? 'current-password' : 'new-password';
  setAuthMsg('err',''); setAuthMsg('ok','');
}
function setAuthMsg(t, txt) {
  const el = document.getElementById(t==='err' ? 'authErr' : 'authOk'); if (!el) return;
  el.textContent = txt; el.style.display = txt ? 'block' : 'none';
  const other = document.getElementById(t==='err' ? 'authOk' : 'authErr');
  if (other) other.style.display = 'none';
}
async function resolveEmail(ident) {
  if (ident.includes('@')) return { email: ident };
  const { data } = await db.from('profiles').select('email').eq('username', ident).maybeSingle();
  return data?.email ? { email: data.email } : { err: 'No account found with that username.' };
}
async function handleAuthSubmit() {
  const pass = document.getElementById('authPass').value;
  const btn  = document.getElementById('authSubmitBtn');
  if (!pass || pass.length < 6) { setAuthMsg('err','Password must be at least 6 characters.'); return; }
  btn.disabled = true;
  if (authMode === 'login') {
    const ident = document.getElementById('authIdent').value.trim();
    if (!ident) { setAuthMsg('err','Please enter your email or username.'); btn.disabled=false; return; }
    btn.textContent = 'Logging in…';
    const { email, err } = await resolveEmail(ident);
    if (err) { setAuthMsg('err', err); btn.disabled=false; btn.textContent='Log in'; return; }
    const { error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) { setAuthMsg('err', niceErr(error.message)); btn.disabled=false; btn.textContent='Log in'; return; }
  } else {
    const email    = document.getElementById('authEmail').value.trim();
    const username = document.getElementById('authUser').value.trim();
    if (!email)    { setAuthMsg('err','Please enter your email.'); btn.disabled=false; btn.textContent='Create account'; return; }
    if (!username) { setAuthMsg('err','Please choose a username.'); btn.disabled=false; btn.textContent='Create account'; return; }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { setAuthMsg('err','Username: 3–20 chars, letters/numbers/underscores.'); btn.disabled=false; btn.textContent='Create account'; return; }
    btn.textContent = 'Creating account…';
    const { data: ex } = await db.from('profiles').select('id').eq('username', username).maybeSingle();
    if (ex) { setAuthMsg('err','Username already taken.'); btn.disabled=false; btn.textContent='Create account'; return; }
    const { data: sd, error } = await db.auth.signUp({ email, password:pass, options:{ data:{ username } } });
    if (error) { setAuthMsg('err', niceErr(error.message)); btn.disabled=false; btn.textContent='Create account'; return; }
    if (sd?.user) await db.from('profiles').upsert({ id:sd.user.id, username, email }, { onConflict:'id' });
    if (sd?.session) { closeAuthModal(); showToast('Welcome to MINT!','success'); }
    else { setAuthMsg('ok','Check your email to confirm, then log in.'); btn.disabled=false; btn.textContent='Create account'; }
  }
}
function niceErr(m) {
  if (!m) return 'Something went wrong.';
  if (m.includes('Invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('Email not confirmed'))       return 'Please confirm your email first.';
  if (m.includes('User already registered'))   return 'An account with that email already exists.';
  if (m.includes('Password should be'))        return 'Password must be at least 6 characters.';
  return m;
}

/* ── IMAGE PREVIEW ────────────────────────────────────── */
function wireImagePreview(inputId, previewBoxId, previewImgId, removeId, stateObj, key) {
  const input = document.getElementById(inputId);
  const box   = document.getElementById(previewBoxId);
  const img   = document.getElementById(previewImgId);
  const rem   = document.getElementById(removeId);
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files[0]; if (!file) return;
    stateObj[key] = file;
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; box.style.display = 'inline-block'; };
    reader.readAsDataURL(file);
  });
  if (rem) rem.addEventListener('click', () => {
    stateObj[key] = null; input.value = ''; img.src = ''; box.style.display = 'none';
  });
}

/* ── POST DROPDOWN ────────────────────────────────────── */
function initPostDropdown() {
  const btn  = document.getElementById('postDropdownBtn');
  const menu = document.getElementById('postDropdownMenu');
  btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => menu.classList.remove('open'));

  document.getElementById('menuPostIntuition').addEventListener('click', () => {
    menu.classList.remove('open');
    if (!me) { openAuthModal(); return; }
    openGlobalIntModal();
  });
  document.getElementById('menuPostTakeaway').addEventListener('click', () => {
    menu.classList.remove('open');
    if (!me) { openAuthModal(); return; }
    openGlobalTakModal();
  });
  document.getElementById('menuPostSubtopic').addEventListener('click', () => {
    menu.classList.remove('open');
    if (!me) { openAuthModal(); return; }
    openSubModal();
  });
}

/* ── SUBTOPIC / POST-QUESTION MODAL ───────────────────── */
function openSubModal(preselectedTopic) {
  selectedSubTopics = new Set(preselectedTopic ? [preselectedTopic] : []);
  selectedNewQTags  = new Set();
  document.getElementById('newQTitle').value = '';
  document.getElementById('newQAbout').value = '';
  document.getElementById('postSubError').innerHTML = '';
  ['qTitle','qAbout'].forEach(k => {
    document.getElementById(`${k}WriteTab`).classList.add('active');
    document.getElementById(`${k}PreviewTab`).classList.remove('active');
    document.getElementById(`${k}WritePane`).classList.add('active');
    document.getElementById(`${k}PreviewPane`).classList.remove('active');
  });
  renderTopicPickerGrid();
  renderNewQSscTags();
  document.getElementById('postSubModal').classList.add('open');
  setTimeout(() => document.getElementById('newQTitle').focus(), 80);
}
function closeSubModal() { document.getElementById('postSubModal').classList.remove('open'); }

function renderTopicPickerGrid() {
  const grid = document.getElementById('topicPickerGrid'); if (!grid) return;
  grid.innerHTML = SUBS.map(sub => {
    const count = questions.filter(q => q.tags.includes(sub)).length;
    const sel   = selectedSubTopics.has(sub);
    return `<button class="topic-pill-option${sel?' selected':''}" data-subtopic="${esc(sub)}">
      <span class="check-icon">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      ${esc(sub)} <span class="topic-count">${count}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.topic-pill-option').forEach(pill => {
    pill.addEventListener('click', () => {
      const sub = pill.dataset.subtopic;
      if (selectedSubTopics.has(sub)) {
        selectedSubTopics.delete(sub);
        for (const tag of [...selectedNewQTags]) {
          const p = parseSscTag(tag); if (p && p.sub===sub) selectedNewQTags.delete(tag);
        }
      } else { selectedSubTopics.add(sub); }
      renderTopicPickerGrid(); renderNewQSscTags();
    });
  });
}

function renderNewQSscTags() {
  const wrap      = document.getElementById('newQSscWrap');
  const accordion = document.getElementById('sscAccordion');
  if (selectedSubTopics.size === 0) { wrap.style.display='none'; accordion.innerHTML=''; return; }
  wrap.style.display = 'block';
  const makeTagBtn = (sub, name, type) => {
    const tagKey = sscTagName(sub, name, type), sel = selectedNewQTags.has(tagKey);
    const tc = type==='technique' ? 'var(--gold)' : 'var(--blue)';
    const bg = sel ? (type==='technique'?'rgba(240,192,96,.25)':'rgba(122,176,245,.25)') : (type==='technique'?'rgba(240,192,96,.1)':'rgba(122,176,245,.1)');
    const border = sel ? (type==='technique'?'rgba(240,192,96,.5)':'rgba(122,176,245,.5)') : (type==='technique'?'rgba(240,192,96,.2)':'rgba(122,176,245,.2)');
    return `<span class="sub-preview-tag ${type}" style="cursor:pointer;background:${bg};border-color:${border};color:${tc};outline:${sel?`2px solid ${tc}`:'none'};outline-offset:1px" data-tagkey="${tagKey}">${esc(name)}</span>`;
  };
  accordion.innerHTML = [...selectedSubTopics].map(sub => {
    const sscData = SSC[sub]; if (!sscData) return '';
    return `<div class="ssc-accordion-item">
      <div class="ssc-accordion-header"><span>${esc(sub)}</span></div>
      <div class="ssc-accordion-body">
        <div class="sub-preview-label">Structure</div>
        <div class="sub-preview-tags">${sscData.structure.map(n=>makeTagBtn(sub,n,'structure')).join('')}</div>
        <div class="sub-preview-label" style="margin-top:8px">Technique</div>
        <div class="sub-preview-tags">${sscData.technique.map(n=>makeTagBtn(sub,n,'technique')).join('')}</div>
      </div>
    </div>`;
  }).join('');
  accordion.querySelectorAll('[data-tagkey]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.tagkey;
      if (selectedNewQTags.has(key)) selectedNewQTags.delete(key); else selectedNewQTags.add(key);
      renderNewQSscTags();
    });
  });
  const selectedEl = document.getElementById('newQSelectedTags');
  if (selectedNewQTags.size === 0) { selectedEl.innerHTML=''; return; }
  selectedEl.innerHTML = [...selectedNewQTags].map(key => {
    const p = parseSscTag(key); if (!p) return '';
    const tc = p.type==='technique' ? 'var(--gold)' : 'var(--blue)';
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;background:${p.type==='technique'?'rgba(240,192,96,.12)':'rgba(122,176,245,.12)'};color:${tc};border:1px solid ${p.type==='technique'?'rgba(240,192,96,.25)':'rgba(122,176,245,.25)'}">
      ${esc(p.name)}
      <button style="background:none;border:none;cursor:pointer;color:${tc};opacity:.7;padding:0;display:flex;align-items:center" data-rmtag="${key}">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>`;
  }).join('');
  selectedEl.querySelectorAll('[data-rmtag]').forEach(btn => {
    btn.addEventListener('click', () => { selectedNewQTags.delete(btn.dataset.rmtag); renderNewQSscTags(); });
  });
}

async function submitSubtopic() {
  if (!me) { openAuthModal(); return; }
  const title = document.getElementById('newQTitle').value.trim();
  const about = document.getElementById('newQAbout').value.trim();
  if (!title) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please enter a topic title.</div>'; return; }
  if (!about) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please add a brief description.</div>'; return; }
  if (selectedSubTopics.size === 0) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please select at least one topic.</div>'; return; }
  const btn = document.getElementById('postSubSubmitBtn');
  btn.disabled=true; btn.textContent='Posting…';
  try {
    const { data: qData, error: qErr } = await db.from('questions').insert({ title, about }).select('id').single();
    if (qErr) throw qErr;
    const qid = qData.id;
    for (const tagName of [...selectedSubTopics, ...selectedNewQTags]) {
      let { data: tagRow } = await db.from('tags').select('id').eq('name',tagName).eq('category',TOPIC_NAME).maybeSingle();
      if (!tagRow) {
        const { data: newTag } = await db.from('tags').insert({ name:tagName, category:TOPIC_NAME }).select('id').single();
        tagRow = newTag;
      }
      if (tagRow?.id) await db.from('question_tags').insert({ question_id:qid, tag_id:tagRow.id });
    }
    showToast('Topic posted!','success');
    closeSubModal();
    await loadQuestions();
    const newQ = questions.find(q => q.id === qid);
    if (newQ) openQuestion(qid);
  } catch(e) {
    document.getElementById('postSubError').innerHTML=`<div class="err-box">Error: ${e.message}</div>`;
  }
  btn.disabled=false; btn.textContent='Post Topic';
}

/* ── GLOBAL INT MODAL ─────────────────────────────────── */
function openGlobalIntModal(preselectedQId) {
  // reset write/preview tabs if they exist
  ['intExpWriteTabModal','intExpWritePaneModal'].forEach(id => document.getElementById(id)?.classList.add('active'));
  ['intExpPreviewTabModal','intExpPreviewPaneModal'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const prevEl = document.getElementById('intExpPreviewContentModal');
  if (prevEl) prevEl.innerHTML = '';

  gIntState.selectedQIds = new Set(preselectedQId ? [preselectedQId] : []);
  gIntState.links = []; gIntState.imageFile = null;
  ['intStatement','intExplanation','intLinkInput','intExampleLink','intExampleExp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const imgInput = document.getElementById('intImage'); if (imgInput) imgInput.value = '';
  const imgBox   = document.getElementById('intImagePreviewBox'); if (imgBox) imgBox.style.display = 'none';
  document.getElementById('intWordCount').textContent = '0 / 1500 words';
  document.getElementById('postIntError').innerHTML = '';
  document.getElementById('intQSearch').value = '';
  const intList = document.getElementById('intQList'); if (intList) intList.style.display = 'none';
  renderQChips('int'); renderIntLinks();
  document.getElementById('postIntModal').classList.add('open');
  setTimeout(() => {
    document.getElementById('intQSearch').focus();
    wireImagePreview('intImage','intImagePreviewBox','intImagePreview','intImageRemove',gIntState,'imageFile');
  }, 80);
}
function closeGlobalIntModal() { document.getElementById('postIntModal').classList.remove('open'); }

/* ── GLOBAL TAK MODAL ─────────────────────────────────── */
function openGlobalTakModal(preselectedQId) {
  ['takExpWriteTabModal','takExpWritePaneModal'].forEach(id => document.getElementById(id)?.classList.add('active'));
  ['takExpPreviewTabModal','takExpPreviewPaneModal'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const prevEl = document.getElementById('takExpPreviewContentModal');
  if (prevEl) prevEl.innerHTML = '';

  gTakState.selectedQIds = new Set(preselectedQId ? [preselectedQId] : []);
  gTakState.links = []; gTakState.imageFile = null;
  ['takContent','takLinkInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  const imgInput = document.getElementById('takImage'); if (imgInput) imgInput.value = '';
  const imgBox   = document.getElementById('takImagePreviewBox'); if (imgBox) imgBox.style.display = 'none';
  document.getElementById('postTakError').innerHTML = '';
  document.getElementById('takQSearch').value = '';
  const takList = document.getElementById('takQList'); if (takList) takList.style.display = 'none';
  renderQChips('tak'); renderTakLinks();
  document.getElementById('postTakModal').classList.add('open');
  setTimeout(() => {
    document.getElementById('takQSearch').focus();
    wireImagePreview('takImage','takImagePreviewBox','takImagePreview','takImageRemove',gTakState,'imageFile');
  }, 80);
}
function closeGlobalTakModal() { document.getElementById('postTakModal').classList.remove('open'); }

/* ── QUESTION PICKER ──────────────────────────────────── */
function renderQPicker(prefix) {
  const searchEl = document.getElementById(`${prefix}QSearch`);
  const listEl   = document.getElementById(`${prefix}QList`);
  const state    = prefix==='int' ? gIntState : gTakState;
  const q        = (searchEl?.value || '').trim().toLowerCase();
  if (!q) { listEl.style.display='none'; listEl.innerHTML=''; }
  else {
    const filtered = questions.filter(x =>
      !state.selectedQIds.has(x.id) &&
      (x.title.toLowerCase().includes(q) || (x.about||'').toLowerCase().includes(q))
    ).slice(0, 8);
    if (!filtered.length) { listEl.style.display='none'; listEl.innerHTML=''; }
    else {
      listEl.style.display = 'block';
      listEl.innerHTML = filtered.map(x => {
        const sub = x.tags.find(t => SUBS.includes(t)) || '';
        return `<div class="q-picker-item" data-qid="${x.id}">
          <span class="q-picker-text">
            <span class="q-picker-title">${esc(x.title)}</span>
            ${sub ? `<span class="q-picker-sub">${esc(sub)}</span>` : ''}
          </span>
        </div>`;
      }).join('');
      listEl.querySelectorAll('.q-picker-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          state.selectedQIds.add(item.dataset.qid);
          searchEl.value = ''; listEl.style.display='none'; listEl.innerHTML='';
          renderQChips(prefix);
        });
      });
    }
  }
  renderQChips(prefix);
}
function renderQChips(prefix) {
  const chipsEl = document.getElementById(`${prefix}QChips`);
  const state   = prefix==='int' ? gIntState : gTakState;
  chipsEl.innerHTML = questions.filter(x => state.selectedQIds.has(x.id)).map(x =>
    `<span class="q-chip">${esc(x.title.length>40 ? x.title.substring(0,40)+'…' : x.title)}
      <button class="q-chip-remove" data-qid="${x.id}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>`
  ).join('');
  chipsEl.querySelectorAll('.q-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => { state.selectedQIds.delete(btn.dataset.qid); renderQChips(prefix); });
  });
}
function wireQPickers() {
  ['int','tak'].forEach(prefix => {
    const searchEl = document.getElementById(`${prefix}QSearch`);
    const listEl   = document.getElementById(`${prefix}QList`);
    if (!searchEl) return;
    searchEl.addEventListener('input',  () => renderQPicker(prefix));
    searchEl.addEventListener('focus',  () => { if (searchEl.value.trim()) renderQPicker(prefix); });
    searchEl.addEventListener('blur',   () => { setTimeout(() => { if (listEl) listEl.style.display='none'; }, 150); });
  });
}

/* ── LINKS ────────────────────────────────────────────── */
function renderIntLinks() {
  const c = document.getElementById('intLinkList'); if (!c) return;
  c.innerHTML = gIntState.links.map((l,i) =>
    `<div class="link-item"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>
     <button class="remove-link-btn" onclick="removeGIntLink(${i})">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
     </button></div>`
  ).join('');
}
function removeGIntLink(i) { gIntState.links.splice(i,1); renderIntLinks(); }
function renderTakLinks() {
  const c = document.getElementById('takLinkList'); if (!c) return;
  c.innerHTML = gTakState.links.map((l,i) =>
    `<div class="link-item"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>
     <button class="remove-link-btn" onclick="removeGTakLink(${i})">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
     </button></div>`
  ).join('');
}
function removeGTakLink(i) { gTakState.links.splice(i,1); renderTakLinks(); }

/* ── SUBMIT INT (global modal) ────────────────────────── */
async function submitGlobalIntuition() {
  if (!me) { openAuthModal(); return; }
  let imageUrl = null;
  if (gIntState.imageFile) {
    try { imageUrl = await uploadImage(gIntState.imageFile); }
    catch(e) { showToast('Image upload failed: '+e.message,'error'); return; }
  }
  const stmt = document.getElementById('intStatement').value.trim();
  const exp  = document.getElementById('intExplanation').value.trim();
  if (!gIntState.selectedQIds.size) { document.getElementById('postIntError').innerHTML='<div class="err-box">Please select at least one topic.</div>'; return; }
  if (!stmt || !exp) { document.getElementById('postIntError').innerHTML='<div class="err-box">Please fill in the statement and explanation.</div>'; return; }
  if (exp.split(/\s+/).filter(Boolean).length > 1500) { document.getElementById('postIntError').innerHTML='<div class="err-box">Explanation exceeds 1500 words.</div>'; return; }
  const btn = document.getElementById('postIntSubmitBtn');
  btn.disabled=true; btn.textContent='Posting…';
  const exLink = document.getElementById('intExampleLink').value.trim() || null;
  const exExp  = document.getElementById('intExampleExp').value.trim() || null;
  let posted=0, failed=0;
  for (const qid of [...gIntState.selectedQIds]) {
    const { data:d, error:e } = await db.from('intuitions').insert({ question_id:qid, statement:stmt, explanation:exp, example_link:exLink, example_explanation:exExp, author_id:me.id, image_url:imageUrl }).select('id').single();
    if (e) { failed++; continue; }
    posted++;
    if (gIntState.links.length && d) await db.from('links').insert(gIntState.links.map(url => ({ parent_id:d.id, parent_type:'intuition', url })));
  }
  btn.disabled=false; btn.textContent='Post Intuition';
  if (failed) showToast(`${posted} posted, ${failed} failed.`, failed===gIntState.selectedQIds.size?'error':'success');
  else showToast(`Intuition posted to ${posted} question${posted!==1?'s':''}!`,'success');
  closeGlobalIntModal();
  if (selectedQuestion && gIntState.selectedQIds.has(selectedQuestion.id)) { await loadDetailItems(selectedQuestion.id); renderDetailItems(); }
  await loadQuestions();
}

/* ── SUBMIT TAK (global modal) ────────────────────────── */
async function submitGlobalTakeaway() {
  if (!me) { openAuthModal(); return; }
  let imageUrl = null;
  if (gTakState.imageFile) {
    try { imageUrl = await uploadImage(gTakState.imageFile); }
    catch(e) { showToast('Image upload failed: '+e.message,'error'); return; }
  }
  const content = document.getElementById('takContent').value.trim();
  if (!gTakState.selectedQIds.size) { document.getElementById('postTakError').innerHTML='<div class="err-box">Please select at least one question.</div>'; return; }
  if (!content) { document.getElementById('postTakError').innerHTML='<div class="err-box">Please write your takeaway.</div>'; return; }
  const btn = document.getElementById('postTakSubmitBtn');
  btn.disabled=true; btn.textContent='Posting…';
  let posted=0, failed=0;
  for (const qid of [...gTakState.selectedQIds]) {
    const { data:d, error:e } = await db.from('takeaways').insert({ question_id:qid, image_url:imageUrl, content, author_id:me.id }).select('id').single();
    if (e) { failed++; continue; }
    posted++;
    if (gTakState.links.length && d) await db.from('links').insert(gTakState.links.map(url => ({ parent_id:d.id, parent_type:'takeaway', url })));
  }
  btn.disabled=false; btn.textContent='Post Takeaway';
  if (failed) showToast(`${posted} posted, ${failed} failed.`, failed===gTakState.selectedQIds.size?'error':'success');
  else showToast(`Takeaway posted to ${posted} question${posted!==1?'s':''}!`,'success');
  closeGlobalTakModal();
  if (selectedQuestion && gTakState.selectedQIds.has(selectedQuestion.id)) { await loadDetailItems(selectedQuestion.id); renderDetailItems(); }
  await loadQuestions();
}

/* ── BOOT ─────────────────────────────────────────────── */
let _katexReady = false, _domReady = false;
function tryBoot() { if (_katexReady && _domReady) boot(); }
function onKatexReady() { _katexReady = true; tryBoot(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { _domReady=true; tryBoot(); });
} else {
  _domReady = true;
  if (window.renderMathInElement) _katexReady = true;
  tryBoot();
}

async function boot() {
  applyTheme(localStorage.getItem('theme') || 'dark');
  document.getElementById('themeBtn').addEventListener('click', () => {
    const t = document.documentElement.className === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', t); applyTheme(t);
  });
  bindEvents();
  buildSidebar();
  initPostDropdown();
  wireQPickers();
  await loadQuestions();
  const qp = getParam('q');
  if (qp) { const q = questions.find(x => x.id===qp); if (q) openQuestion(q.id); }
  document.body.classList.add('ready');
}

/* ── SIDEBAR ──────────────────────────────────────────── */
function buildSidebar() {
  const list = document.getElementById('subtopicList');
  list.innerHTML = `<button class="subtopic-btn active" data-sub="" data-ssc="" data-ssctype="">All Questions
    <svg class="subtopic-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;
  SUBS.forEach(sub => {
    const sscData = SSC[sub] || { structure:[], technique:[] };
    const row = document.createElement('div');
    row.innerHTML = `<button class="subtopic-btn" data-sub="${sub}" data-ssc="" data-ssctype="">
      <span>${sub}</span>
      <svg class="subtopic-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="ssc-panel" id="ssc-panel-${sub.replace(/[^a-z0-9]/gi,'-')}">
      <div class="ssc-group-label"><span class="ssc-type-dot structure"></span>Structure</div>
      ${sscData.structure.map(n=>`<button class="ssc-btn" data-sub="${sub}" data-ssc="${n}" data-ssctype="structure">${n}</button>`).join('')}
      <div class="ssc-group-label" style="margin-top:6px"><span class="ssc-type-dot technique"></span>Technique</div>
      ${sscData.technique.map(n=>`<button class="ssc-btn" data-sub="${sub}" data-ssc="${n}" data-ssctype="technique">${n}</button>`).join('')}
    </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.subtopic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub, isAll = !sub;
      const panel = sub ? document.getElementById(`ssc-panel-${sub.replace(/[^a-z0-9]/gi,'-')}`) : null;
      const wasOpen = btn.classList.contains('open');
      if (btn.classList.contains('active') && !isAll) {
        btn.classList.toggle('open', !wasOpen); if (panel) panel.classList.toggle('open', !wasOpen); return;
      }
      list.querySelectorAll('.subtopic-btn').forEach(b => b.classList.remove('active','open'));
      list.querySelectorAll('.ssc-panel').forEach(p => p.classList.remove('open'));
      list.querySelectorAll('.ssc-btn').forEach(b => b.classList.remove('active','active-technique'));
      btn.classList.add('active');
      activeSubtopic = sub || null; activeSsc = null; activeSscType = null;
      if (!isAll && panel) { btn.classList.add('open'); panel.classList.add('open'); }
      renderQuestions();
    });
  });
  list.querySelectorAll('.ssc-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sub=btn.dataset.sub, ssc=btn.dataset.ssc, type=btn.dataset.ssctype;
      const isSame = activeSsc===ssc && activeSscType===type;
      list.querySelectorAll('.ssc-btn').forEach(b => b.classList.remove('active','active-technique'));
      list.querySelectorAll('.subtopic-btn').forEach(b => b.classList.remove('active'));
      const parentBtn = list.querySelector(`.subtopic-btn[data-sub="${sub}"]`);
      if (parentBtn) parentBtn.classList.add('active','open');
      if (isSame) { activeSsc=null; activeSscType=null; }
      else { btn.classList.add(type==='technique'?'active-technique':'active'); activeSubtopic=sub; activeSsc=ssc; activeSscType=type; }
      renderQuestions();
    });
  });
}

/* ── BIND EVENTS ──────────────────────────────────────── */
function bindEvents() {
  // Auth
  document.getElementById('authOverlay').addEventListener('click', e => { if (e.target===e.currentTarget) closeAuthModal(); });
  document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
  document.getElementById('loginTab').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('signupTab').addEventListener('click', () => switchAuthTab('signup'));
  document.getElementById('authCancelBtn').addEventListener('click', closeAuthModal);
  document.getElementById('authSubmitBtn').addEventListener('click', handleAuthSubmit);

  // Intuition modal
  document.getElementById('postIntModal').addEventListener('click', e => { if (e.target===e.currentTarget) closeGlobalIntModal(); });
  document.getElementById('postIntCancelBtn').addEventListener('click', closeGlobalIntModal);
  document.getElementById('postIntSubmitBtn').addEventListener('click', submitGlobalIntuition);
  document.getElementById('intExplanation').addEventListener('input', () => {
    const c = document.getElementById('intExplanation').value.trim().split(/\s+/).filter(Boolean).length;
    const wc = document.getElementById('intWordCount');
    wc.textContent=`${c} / 1500 words`; wc.classList.toggle('over', c>1500);
  });
  document.getElementById('intAddLink').addEventListener('click', () => {
    const i=document.getElementById('intLinkInput'), v=i?.value.trim(); if (!v) return;
    if (!isValidURL(v)) { showToast('Please enter a valid URL','error'); return; }
    if (gIntState.links.length>=3) { showToast('Max 3 links allowed','error'); return; }
    gIntState.links.push(v); i.value=''; renderIntLinks();
  });

  // Optional preview tabs in int modal (Algebra has them, Problem Solving doesn't)
  const intWriteTabModal   = document.getElementById('intExpWriteTabModal');
  const intPreviewTabModal = document.getElementById('intExpPreviewTabModal');
  if (intWriteTabModal) {
    intWriteTabModal.addEventListener('click', () => {
      intWriteTabModal.classList.add('active'); intPreviewTabModal.classList.remove('active');
      document.getElementById('intExpWritePaneModal').classList.add('active');
      document.getElementById('intExpPreviewPaneModal').classList.remove('active');
    });
    intPreviewTabModal.addEventListener('click', () => {
      intPreviewTabModal.classList.add('active'); intWriteTabModal.classList.remove('active');
      document.getElementById('intExpPreviewPaneModal').classList.add('active');
      document.getElementById('intExpWritePaneModal').classList.remove('active');
      const raw = document.getElementById('intExplanation').value || '';
      const el  = document.getElementById('intExpPreviewContentModal');
      el.innerHTML = raw.trim() ? processText(raw) : '<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>';
      renderMath(el);
    });
  }

  // Takeaway modal
  document.getElementById('postTakModal').addEventListener('click', e => { if (e.target===e.currentTarget) closeGlobalTakModal(); });
  document.getElementById('postTakCancelBtn').addEventListener('click', closeGlobalTakModal);
  document.getElementById('postTakSubmitBtn').addEventListener('click', submitGlobalTakeaway);
  document.getElementById('takAddLink').addEventListener('click', () => {
    const i=document.getElementById('takLinkInput'), v=i?.value.trim(); if (!v) return;
    if (!isValidURL(v)) { showToast('Please enter a valid URL','error'); return; }
    gTakState.links.push(v); i.value=''; renderTakLinks();
  });

  // Optional preview tabs in tak modal
  const takWriteTabModal   = document.getElementById('takExpWriteTabModal');
  const takPreviewTabModal = document.getElementById('takExpPreviewTabModal');
  if (takWriteTabModal) {
    takWriteTabModal.addEventListener('click', () => {
      takWriteTabModal.classList.add('active'); takPreviewTabModal.classList.remove('active');
      document.getElementById('takExpWritePaneModal').classList.add('active');
      document.getElementById('takExpPreviewPaneModal').classList.remove('active');
    });
    takPreviewTabModal.addEventListener('click', () => {
      takPreviewTabModal.classList.add('active'); takWriteTabModal.classList.remove('active');
      document.getElementById('takExpPreviewPaneModal').classList.add('active');
      document.getElementById('takExpWritePaneModal').classList.remove('active');
      const raw = document.getElementById('takContent').value || '';
      const el  = document.getElementById('takExpPreviewContentModal');
      el.innerHTML = raw.trim() ? processText(raw) : '<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>';
      renderMath(el);
    });
  }

  // Subtopic modal
  document.getElementById('postSubModal').addEventListener('click', e => { if (e.target===e.currentTarget) closeSubModal(); });
  document.getElementById('postSubCancelBtn').addEventListener('click', closeSubModal);
  document.getElementById('postSubSubmitBtn').addEventListener('click', submitSubtopic);

  // Title + about preview toggles in post-topic modal
  const makePreviewToggle = (key, getVal) => {
    document.getElementById(`${key}WriteTab`).addEventListener('click', () => {
      document.getElementById(`${key}WriteTab`).classList.add('active');
      document.getElementById(`${key}PreviewTab`).classList.remove('active');
      document.getElementById(`${key}WritePane`).classList.add('active');
      document.getElementById(`${key}PreviewPane`).classList.remove('active');
    });
    document.getElementById(`${key}PreviewTab`).addEventListener('click', () => {
      document.getElementById(`${key}PreviewTab`).classList.add('active');
      document.getElementById(`${key}WriteTab`).classList.remove('active');
      document.getElementById(`${key}PreviewPane`).classList.add('active');
      document.getElementById(`${key}WritePane`).classList.remove('active');
      const raw = getVal().trim();
      const el  = document.getElementById(`${key}PreviewContent`);
      el.innerHTML = raw
        ? (el.className='preview-rendered kr', processText(raw))
        : '<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>';
      renderMath(el);
    });
  };
  makePreviewToggle('qTitle', () => document.getElementById('newQTitle').value);
  makePreviewToggle('qAbout', () => document.getElementById('newQAbout').value);

  // List-view controls
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.querySelectorAll('.tab-btn[data-sort]').forEach(btn => btn.addEventListener('click', () => switchSort(btn)));
  document.querySelectorAll('.tab-btn[data-dtab]').forEach(btn => btn.addEventListener('click', () => switchDetailTab(btn)));
  document.querySelectorAll('.sort-btn[data-dsort]').forEach(btn => btn.addEventListener('click', () => switchDetailSort(btn)));

  // Search
  const si = document.getElementById('questionSearch'), sc = document.getElementById('searchClear');
  si.addEventListener('input', () => { sc.classList.toggle('hidden', !si.value); renderQuestions(); });
  sc.addEventListener('click', () => { si.value=''; sc.classList.add('hidden'); renderQuestions(); si.focus(); });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('postSubModal').classList.contains('open')) { closeSubModal(); return; }
      if (document.getElementById('postIntModal').classList.contains('open')) { closeGlobalIntModal(); return; }
      if (document.getElementById('postTakModal').classList.contains('open')) { closeGlobalTakModal(); return; }
      if (document.getElementById('authOverlay').classList.contains('open')) closeAuthModal();
    }
    if (e.key==='Enter' && document.getElementById('authOverlay').classList.contains('open')) {
      const b = document.getElementById('authSubmitBtn'); if (!b.disabled) handleAuthSubmit();
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', () => {
    if (!getParam('q')) {
      selectedQuestion=null;
      document.getElementById('detailView').style.display='none';
      document.getElementById('listView').style.display='block';
    }
  });

  // Fade page transitions on internal links
  document.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript') || a.target==='_blank') return;
    a.addEventListener('click', e => {
      e.preventDefault();
      document.body.style.opacity='0';
      setTimeout(() => { window.location.href = a.href; }, 180);
    });
  });
}

/* ── LOAD QUESTIONS ───────────────────────────────────── */
async function loadQuestions() {
  document.getElementById('questionsList').innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading questions…</div>';
  try {
    const { data: tagData } = await db.from('tags').select('id,name').eq('category', TOPIC_NAME);
    if (!tagData?.length) { questions=[]; renderQuestions(); return; }
    const { data: qtData } = await db.from('question_tags').select('question_id').in('tag_id', tagData.map(t=>t.id));
    if (!qtData?.length) { questions=[]; renderQuestions(); return; }
    const qIds = [...new Set(qtData.map(qt=>qt.question_id))];
    const { data, error } = await db.from('questions')
      .select('id,title,about,created_at,question_tags(tags(name)),intuitions(id),takeaways(id)')
      .in('id', qIds).order('created_at', { ascending:false });
    if (error) throw error;
    questions = (data||[]).map(q => ({
      id:q.id, title:q.title, about:q.about,
      createdAt:ago(q.created_at), createdAtRaw:q.created_at,
      tags:(q.question_tags||[]).map(qt=>qt.tags?.name).filter(Boolean),
      intuitionCount:(q.intuitions||[]).length, takeawayCount:(q.takeaways||[]).length,
      upvotes:0, downvotes:0,
    }));
    const vc = await fetchVoteCounts(qIds,'question');
    questions.forEach(q => { const v=vc[q.id]||{}; q.upvotes=+v.upvotes||0; q.downvotes=+v.downvotes||0; });
    if (me) {
      const { data:vd } = await db.from('votes').select('target_id,direction').eq('user_id',me.id).eq('target_type','question').in('target_id',qIds);
      (vd||[]).forEach(v => { questionVotes[v.target_id]=v.direction; });
    }
    renderQuestions();
  } catch(e) {
    document.getElementById('questionsList').innerHTML=`<div class="err-box">Failed to load: ${e.message}</div>`;
  }
}

/* ── SORT & RENDER ────────────────────────────────────── */
function switchSort(btn) {
  document.querySelectorAll('.tab-btn[data-sort]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); currentSort=btn.dataset.sort; renderQuestions();
}
function calcScore(q) {
  const net    = q.upvotes - q.downvotes;
  const hours  = (Date.now()-new Date(q.createdAtRaw)) / 3600000;
  const recent = Math.max(0, 48-hours) / 48 * 8;
  return net*0.7 + recent + (q.intuitionCount+q.takeawayCount)*0.5;
}
function sortItems(items, type) {
  const arr = [...items];
  if (type==='top')    return arr.sort((a,b)=>(b.upvotes-b.downvotes)-(a.upvotes-a.downvotes));
  if (type==='recent') return arr.sort((a,b)=>new Date(b.createdAtRaw)-new Date(a.createdAtRaw));
  return arr.sort((a,b)=>calcScore(b)-calcScore(a));
}
function searchScore(q, lq) {
  if (!lq) return 1;
  const t=(q.title||'').toLowerCase(), ab=(q.about||'').toLowerCase(), tg=q.tags.map(x=>x.toLowerCase()).join(' ');
  if (t.includes(lq)) return 3;
  if (ab.includes(lq)) return 2;
  if (tg.includes(lq)) return 1.5;
  const words = lq.split(/\s+/).filter(Boolean);
  if (words.length>1) {
    if (words.every(w=>t.includes(w))) return 2.5;
    if (words.some(w=>t.includes(w)))  return 1.2;
  }
  return 0;
}

function renderQuestions() {
  const query = document.getElementById('questionSearch').value.trim();
  const lq    = query.toLowerCase();
  const filtered = questions.filter(x => {
    const ms   = !activeSubtopic || x.tags.includes(activeSubtopic);
    const mssc = !activeSsc || x.tags.includes(sscTagName(activeSubtopic,activeSsc,activeSscType));
    return ms && mssc && searchScore(x,lq)>0;
  });
  let sorted;
  if (query) {
    sorted = [...filtered].sort((a,b) => {
      const sd = searchScore(b,lq)-searchScore(a,lq);
      return Math.abs(sd)>0.1 ? sd : calcScore(b)-calcScore(a);
    });
    if (currentSort==='top')    sorted.sort((a,b)=>searchScore(b,lq)===searchScore(a,lq)?(b.upvotes-b.downvotes)-(a.upvotes-a.downvotes):searchScore(b,lq)-searchScore(a,lq));
    if (currentSort==='recent') sorted.sort((a,b)=>searchScore(b,lq)===searchScore(a,lq)?new Date(b.createdAtRaw)-new Date(a.createdAtRaw):searchScore(b,lq)-searchScore(a,lq));
  } else { sorted = sortItems(filtered, currentSort); }

  const scopeLabel = activeSsc ? `${activeSsc} (${activeSscType})` : activeSubtopic||'';
  document.getElementById('qCount').textContent = `${sorted.length} question${sorted.length!==1?'s':''}${scopeLabel?` · ${scopeLabel}`:''}`;

  const pillEl = document.getElementById('activeFilterPill');
  if (query) {
    pillEl.innerHTML = `<span class="active-filter-pill" id="clearSearchPill" title="Click to clear">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      "${esc(query)}"
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </span>`;
    document.getElementById('clearSearchPill')?.addEventListener('click', () => {
      document.getElementById('questionSearch').value='';
      document.getElementById('searchClear').classList.add('hidden');
      renderQuestions();
    });
  } else { pillEl.innerHTML=''; }

  const container = document.getElementById('questionsList');
  if (!sorted.length) {
    container.innerHTML = query
      ? `<div class="empty-state"><span class="empty-icon">🔍</span>No questions found for "<strong>${esc(query)}</strong>".<br><span style="font-size:12px;opacity:.7">Try a different keyword or browse by topic.</span></div>`
      : `<div class="empty-state"><span class="empty-icon">💬</span>No questions yet${activeSubtopic?` in ${activeSubtopic}`:''}. Be the first!</div>`;
    return;
  }
  container.innerHTML = sorted.map((q,i)=>questionCardHTML(q,i,query)).join('');
  container.querySelectorAll('.kr').forEach(renderMath);
  container.querySelectorAll('.question-card').forEach(card => card.addEventListener('click', ()=>openQuestion(card.dataset.qid)));
  container.querySelectorAll('.vote-btn[data-vid]').forEach(btn => btn.addEventListener('click', e=>{e.stopPropagation();handleVote(btn.dataset.vid,btn.dataset.vdir,'q');}));
  container.querySelectorAll('.btn-report[data-reportid]').forEach(btn => btn.addEventListener('click', e=>{e.stopPropagation();handleReport(btn.dataset.reportid,btn.dataset.reporttype);}));
}

function questionCardHTML(q, i=0, searchQuery='') {
  const score=q.upvotes-q.downvotes, vu=questionVotes[q.id], sc=score>0?'positive':score<0?'negative':'';
  const titleHTML = searchQuery ? highlightText(q.title,searchQuery) : esc(q.title);
  const aboutHTML = searchQuery ? highlightText(q.about||'',searchQuery) : esc(q.about||'');
  return `<div class="question-card" data-qid="${q.id}" style="animation-delay:${i*35}ms">
    <div class="vote-col">
      <button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${q.id}" data-vdir="up">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg>
      </button>
      <span class="vote-score ${sc}">${score}</span>
      <button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${q.id}" data-vdir="down">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg>
      </button>
      <div class="bulb-count"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6l-.7.6V18H9v-2.4l-.7-.6A7 7 0 0 1 12 2z"/></svg>${q.intuitionCount}</div>
    </div>
    <div class="card-content">
      <div class="card-title kr">${titleHTML}</div>
      <div class="card-about"><span class="lbl">About </span><span class="kr">${aboutHTML}</span></div>
      <div class="tags">${q.tags.map((t,idx)=>{
        const ssc=parseSscTag(t);
        if (ssc) {
          const col=ssc.type==='technique'?'rgba(240,192,96,.15)':'rgba(122,176,245,.15)';
          const bdr=ssc.type==='technique'?'rgba(240,192,96,.3)':'rgba(122,176,245,.3)';
          const tc =ssc.type==='technique'?'var(--gold)':'var(--blue)';
          return `<span style="padding:2px 9px;border-radius:10px;font-size:10.5px;font-weight:600;background:${col};color:${tc};border:1px solid ${bdr};cursor:pointer" onclick="event.stopPropagation();setSearchQuery('${t.split('::')[1]}')">${ssc.name}</span>`;
        }
        return `<span class="${idx===0?'tag-primary':'tag-secondary'}">${searchQuery?highlightText(t,searchQuery):esc(t)}</span>`;
      }).join('')}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div class="card-meta">${q.createdAt}</div>
        <button class="btn-report" data-reportid="${q.id}" data-reporttype="question" title="Report this question">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Report
        </button>
      </div>
    </div>
  </div>`;
}

function setSearchQuery(val) {
  const si=document.getElementById('questionSearch'), sc=document.getElementById('searchClear');
  si.value=val; sc.classList.remove('hidden'); renderQuestions();
}

/* ── REPORT ───────────────────────────────────────────── */
async function handleReport(id, type) {
  if (!me) { openAuthModal(); return; }
  const label = type==='question'?'question':type==='intuition'?'intuition':'takeaway';
  const reason = prompt(`Why are you reporting this ${label}?`);
  if (!reason?.trim()) return;
  const { error } = await db.from('reports').insert({ target_id:id, target_type:type, reason:reason.trim(), user_id:me.id });
  if (error) showToast('Report failed: '+error.message,'error');
  else showToast('Reported — thanks for keeping MINT clean.','success');
}

/* ── DETAIL VIEW ──────────────────────────────────────── */
async function openQuestion(id) {
  selectedQuestion = questions.find(q=>q.id===id);
  document.getElementById('listView').style.display='none';
  document.getElementById('detailView').style.display='block';
  renderDetailHeader();
  document.getElementById('dtab-intuitions').innerHTML='<div class="loading-state"><div class="spinner"></div>Loading…</div>';
  document.getElementById('dtab-takeaways').innerHTML ='<div class="loading-state"><div class="spinner"></div>Loading…</div>';
  history.pushState({ q:id }, '', `?q=${id}`);
  await loadDetailItems(id);
  renderDetailItems(); renderPostForm(); window.scrollTo(0,0);
}
function goBack() {
  selectedQuestion=null;
  document.getElementById('detailView').style.display='none';
  document.getElementById('listView').style.display='block';
  history.pushState({}, '', window.location.pathname);
  loadQuestions();
}

async function loadDetailItems(qid) {
  const [{ data:intData }, { data:takData }] = await Promise.all([
    db.from('intuitions').select('id,statement,explanation,example_link,example_explanation,image_url,created_at,author_id,profiles(username)').eq('question_id',qid).order('created_at',{ascending:false}),
    db.from('takeaways').select('id,content,image_url,created_at,author_id,profiles(username)').eq('question_id',qid).order('created_at',{ascending:false}),
  ]);
  intuitions[qid] = (intData||[]).map(i=>({ id:i.id, statement:i.statement, explanation:i.explanation, exampleLink:i.example_link||'', exampleExplanation:i.example_explanation||'', image_url:i.image_url||'', author:i.profiles?.username||'Anonymous', author_id:i.author_id, createdAt:ago(i.created_at), createdAtRaw:i.created_at, upvotes:0, downvotes:0, explanationLinks:[], comments:[], edited:false }));
  takeaways[qid]  = (takData||[]).map(t=>({ id:t.id, content:t.content, image_url:t.image_url||'', author:t.profiles?.username||'Anonymous', author_id:t.author_id, createdAt:ago(t.created_at), createdAtRaw:t.created_at, upvotes:0, downvotes:0, links:[], comments:[], edited:false }));
  const intIds = intuitions[qid].map(i=>i.id), takIds = takeaways[qid].map(t=>t.id);
  const allIds = [...intIds,...takIds];
  if (allIds.length) {
    try {
      const { data:linkData } = await db.from('links').select('parent_id,parent_type,url').in('parent_id',allIds);
      (linkData||[]).forEach(l => {
        if (l.parent_type==='intuition') { const item=intuitions[qid].find(i=>i.id===l.parent_id); if(item) item.explanationLinks.push(l.url); }
        else if (l.parent_type==='takeaway') { const item=takeaways[qid].find(t=>t.id===l.parent_id); if(item) item.links.push(l.url); }
      });
    } catch {}
  }
  const [ivc,tvc] = await Promise.all([fetchVoteCounts(intIds,'intuition'),fetchVoteCounts(takIds,'takeaway')]);
  intuitions[qid].forEach(i=>{ const v=ivc[i.id]||{}; i.upvotes=+v.upvotes||0; i.downvotes=+v.downvotes||0; });
  takeaways[qid].forEach(t=>{ const v=tvc[t.id]||{}; t.upvotes=+v.upvotes||0; t.downvotes=+v.downvotes||0; });
  if (me && allIds.length) {
    try {
      const { data:vd } = await db.from('votes').select('target_id,target_type,direction').eq('user_id',me.id).in('target_id',allIds);
      (vd||[]).forEach(v=>{ if(v.target_type==='intuition') intuitionVotes[v.target_id]=v.direction; if(v.target_type==='takeaway') takeawayVotes[v.target_id]=v.direction; });
    } catch {}
  }
}

function renderDetailHeader() {
  const q=selectedQuestion, score=q.upvotes-q.downvotes, vu=questionVotes[q.id], sc=score>0?'positive':score<0?'negative':'';
  document.getElementById('detailVoteCol').innerHTML=`
    <button class="vote-btn ${vu==='up'?'voted-up':''}" id="dvUp"><svg width="20" height="20" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button>
    <span class="vote-score ${sc}" style="font-size:17px">${score}</span>
    <button class="vote-btn ${vu==='down'?'voted-down':''}" id="dvDown"><svg width="20" height="20" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button>
    <div class="bulb-count" style="flex-direction:column;gap:2px;margin-top:8px;text-align:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6l-.7.6V18H9v-2.4l-.7-.6A7 7 0 0 1 12 2z"/></svg><span>${(intuitions[q.id]||[]).length}</span></div>`;
  document.getElementById('dvUp').addEventListener('click',()=>handleVote(q.id,'up','q'));
  document.getElementById('dvDown').addEventListener('click',()=>handleVote(q.id,'down','q'));
  document.getElementById('detailContent').innerHTML=`
    <div class="detail-title kr">${esc(q.title)}</div>
    <div class="detail-about"><strong>About:</strong> <span class="kr">${esc(q.about)}</span></div>
    <div class="tags" style="margin:10px 0">${q.tags.map((t,i)=>{
      const ssc=parseSscTag(t);
      if(ssc){const col=ssc.type==='technique'?'rgba(240,192,96,.15)':'rgba(122,176,245,.15)';const bdr=ssc.type==='technique'?'rgba(240,192,96,.3)':'rgba(122,176,245,.3)';const tc=ssc.type==='technique'?'var(--gold)':'var(--blue)';return`<span style="padding:2px 9px;border-radius:10px;font-size:10.5px;font-weight:600;background:${col};color:${tc};border:1px solid ${bdr}">${ssc.name}</span>`;}
      return`<span class="${i===0?'tag-primary':'tag-secondary'}">${esc(t)}</span>`;
    }).join('')}</div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div class="detail-meta">${q.createdAt}</div>
      <button class="btn-report" data-reportid="${q.id}" data-reporttype="question" onclick="handleReport('${q.id}','question')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Report
      </button>
    </div>`;
  document.querySelectorAll('#detailContent .kr').forEach(renderMath);
}

function switchDetailTab(btn) {
  document.querySelectorAll('.tab-btn[data-dtab]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); currentDetailTab=btn.dataset.dtab;
  document.querySelectorAll('[id^="dtab-"]').forEach(c=>c.classList.remove('active'));
  document.getElementById('dtab-'+currentDetailTab).classList.add('active');
  renderPostForm();
}
function switchDetailSort(btn) {
  document.querySelectorAll('.sort-btn[data-dsort]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); currentDetailSort=btn.dataset.dsort; renderDetailItems();
}

function renderDetailItems() {
  if (!selectedQuestion) return;
  const qid=selectedQuestion.id, il=intuitions[qid]||[], tl=takeaways[qid]||[];
  document.getElementById('intCount').textContent=il.length;
  document.getElementById('takCount').textContent=tl.length;
  const ic=document.getElementById('dtab-intuitions'), si=sortItems(il,currentDetailSort);
  ic.innerHTML=si.length?si.map((i,idx)=>intuitionCardHTML(i,idx)).join(''):'<div class="empty-state"><span class="empty-icon">💡</span>No intuitions yet. Be the first!</div>';
  ic.querySelectorAll('.kr').forEach(renderMath);
  ic.querySelectorAll('.vote-btn[data-vid]').forEach(btn=>btn.addEventListener('click',()=>handleVote(btn.dataset.vid,btn.dataset.vdir,'i')));
  ic.querySelectorAll('.btn-report[data-reportid]').forEach(btn=>btn.addEventListener('click',()=>handleReport(btn.dataset.reportid,btn.dataset.reporttype)));
  const tc=document.getElementById('dtab-takeaways'), st=sortItems(tl,currentDetailSort);
  tc.innerHTML=st.length?st.map((t,idx)=>takeawayCardHTML(t,idx)).join(''):'<div class="empty-state"><span class="empty-icon">📝</span>No takeaways yet. Share what you learned!</div>';
  tc.querySelectorAll('.kr').forEach(renderMath);
  tc.querySelectorAll('.vote-btn[data-vid]').forEach(btn=>btn.addEventListener('click',()=>handleVote(btn.dataset.vid,btn.dataset.vdir,'t')));
  tc.querySelectorAll('.btn-report[data-reportid]').forEach(btn=>btn.addEventListener('click',()=>handleReport(btn.dataset.reportid,btn.dataset.reporttype)));
  renderDetailHeader();
}

function intuitionCardHTML(item, idx=0) {
  const score=item.upvotes-item.downvotes,vu=intuitionVotes[item.id],sc=score>0?'positive':score<0?'negative':'';
  const exp=item.explanation||'',trunc=exp.length>300,disp=trunc?exp.substring(0,300)+'…':exp;
  const linksHTML=(item.explanationLinks||[]).length?`<div class="i-links">${item.explanationLinks.map(l=>`<a class="i-link" href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div>`:'';
  const exHTML=(item.exampleLink||item.exampleExplanation)?`<div class="i-example"><div class="i-label">Example</div>${item.exampleLink?`<a class="i-link" href="${esc(item.exampleLink)}" target="_blank" rel="noopener">${esc(item.exampleLink)}</a>`:''}${item.exampleExplanation?`<div class="kr" style="font-size:13.5px;color:var(--text2);margin-top:6px">${processText(item.exampleExplanation)}</div>`:''}</div>`:'';
  const imgHTML=item.image_url?`<img src="${esc(item.image_url)}" alt="Intuition image" style="max-width:100%;border-radius:8px;margin-top:10px;border:1px solid var(--border)" />`:'';
  const cc=(item.comments||[]).length,cHTML=(item.comments||[]).map(c=>`<div class="comment-item"><div class="comment-text">${processText(c.text)}</div><div class="comment-meta">${esc(c.author)} · ${c.createdAt}</div></div>`).join('');
  const isOwn=me&&me.id===item.author_id;
  const editBtn=isOwn?`<button class="btn-edit" data-editid="${item.id}" data-edittype="i"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`:'';
  return `<div class="i-card" id="icard-${item.id}" style="animation-delay:${idx*40}ms">
    <div class="i-card-inner">
      <div class="vote-col"><button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${item.id}" data-vdir="up"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button><span class="vote-score ${sc}">${score}</span><button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${item.id}" data-vdir="down"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button></div>
      <div class="i-content">
        <div class="i-label">Intuition</div>
        <div class="i-statement kr">${processText(item.statement)}</div>
        <div class="i-label">Explanation</div>
        <div class="i-explanation kr" id="iexp-${item.id}">${processText(disp)}</div>
        ${imgHTML}${trunc?`<button class="btn-link" id="iexpbtn-${item.id}">Show more</button>`:''}
        ${linksHTML}${exHTML}
        <div class="i-footer">
          <span>By ${esc(item.author)} · ${item.createdAt}${item.edited?' <span style="color:var(--text3);font-size:11px">(edited)</span>':''}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn-report" data-reportid="${item.id}" data-reporttype="intuition"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Report</button>
            ${editBtn}
            <button class="comment-btn" data-cid="${item.id}" data-ctype="i"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${cc} comment${cc!==1?'s':''}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="edit-section" id="edit-i-${item.id}">
      <div class="form-group" style="margin-bottom:10px"><label class="form-label">Statement</label><input class="form-input" id="edit-stmt-${item.id}" value="${esc(item.statement)}" /></div>
      <div class="form-group" style="margin-bottom:4px">
        <div class="preview-toggle"><button class="preview-tab active" id="etab-write-i-${item.id}">Write</button><button class="preview-tab" id="etab-preview-i-${item.id}">Preview</button></div>
        <div class="preview-pane active" id="epane-write-i-${item.id}"><textarea class="form-textarea" id="edit-exp-${item.id}" style="min-height:100px">${esc(item.explanation)}</textarea><div class="edit-word-count" id="edit-wc-i-${item.id}">0 / 1500 words</div></div>
        <div class="preview-pane" id="epane-preview-i-${item.id}"><div class="preview-rendered kr" id="epreview-i-${item.id}"></div></div>
      </div>
      <div class="edit-actions"><button class="btn btn-ghost btn-sm" data-cancelid="${item.id}" data-canceltype="i">Cancel</button><button class="btn btn-primary btn-sm" data-saveid="${item.id}" data-savetype="i">Save</button></div>
    </div>
    <div class="comments-section" id="comments-i-${item.id}">${cHTML}<div class="comment-form"><textarea class="comment-input" id="ctext-i-${item.id}" placeholder="Add a comment…"></textarea><button class="btn btn-primary btn-sm" data-postid="${item.id}" data-posttype="i">Post</button></div></div>
  </div>`;
}

function takeawayCardHTML(item, idx=0) {
  const score=item.upvotes-item.downvotes,vu=takeawayVotes[item.id],sc=score>0?'positive':score<0?'negative':'';
  const content=item.content||'',trunc=content.length>300,disp=trunc?content.substring(0,300)+'…':content;
  const linksHTML=(item.links||[]).length?`<div class="i-links">${item.links.map(l=>`<a class="i-link" href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div>`:'';
  const imgHTML=item.image_url?`<img src="${esc(item.image_url)}" alt="Takeaway image" style="max-width:100%;border-radius:8px;margin-top:10px;border:1px solid var(--border)" />`:'';
  const cc=(item.comments||[]).length,cHTML=(item.comments||[]).map(c=>`<div class="comment-item"><div class="comment-text">${processText(c.text)}</div><div class="comment-meta">${esc(c.author)} · ${c.createdAt}</div></div>`).join('');
  const isOwn=me&&me.id===item.author_id;
  const editBtn=isOwn?`<button class="btn-edit" data-editid="${item.id}" data-edittype="t"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`:'';
  return `<div class="i-card" id="tcard-${item.id}" style="animation-delay:${idx*40}ms">
    <div class="i-card-inner">
      <div class="vote-col"><button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${item.id}" data-vdir="up"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button><span class="vote-score ${sc}">${score}</span><button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${item.id}" data-vdir="down"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button></div>
      <div class="i-content">
        <div class="i-label">Takeaway by ${esc(item.author)}</div>
        <div class="i-explanation kr" id="texp-${item.id}">${processText(disp)}</div>
        ${imgHTML}${trunc?`<button class="btn-link" id="texpbtn-${item.id}">Show more</button>`:''}
        ${linksHTML}
        <div class="i-footer">
          <span>${item.createdAt}${item.edited?' <span style="color:var(--text3);font-size:11px">(edited)</span>':''}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn-report" data-reportid="${item.id}" data-reporttype="takeaway"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Report</button>
            ${editBtn}
            <button class="comment-btn" data-cid="${item.id}" data-ctype="t"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${cc} comment${cc!==1?'s':''}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="edit-section" id="edit-t-${item.id}">
      <div class="form-group" style="margin-bottom:4px">
        <div class="preview-toggle"><button class="preview-tab active" id="etab-write-t-${item.id}">Write</button><button class="preview-tab" id="etab-preview-t-${item.id}">Preview</button></div>
        <div class="preview-pane active" id="epane-write-t-${item.id}"><textarea class="form-textarea" id="edit-tak-${item.id}" style="min-height:100px">${esc(item.content)}</textarea></div>
        <div class="preview-pane" id="epane-preview-t-${item.id}"><div class="preview-rendered kr" id="epreview-t-${item.id}"></div></div>
      </div>
      <div class="edit-actions"><button class="btn btn-ghost btn-sm" data-cancelid="${item.id}" data-canceltype="t">Cancel</button><button class="btn btn-primary btn-sm" data-saveid="${item.id}" data-savetype="t">Save</button></div>
    </div>
    <div class="comments-section" id="comments-t-${item.id}">${cHTML}<div class="comment-form"><textarea class="comment-input" id="ctext-t-${item.id}" placeholder="Add a comment…"></textarea><button class="btn btn-primary btn-sm" data-postid="${item.id}" data-posttype="t">Post</button></div></div>
  </div>`;
}

/* ── DELEGATED CLICKS (expand, comment, edit, save) ────── */
document.addEventListener('click', e => {
  const expBtn = e.target.closest('[id^="iexpbtn-"],[id^="texpbtn-"]');
  if (expBtn) { const m=expBtn.id.match(/^([it])expbtn-(.+)$/); if(m) toggleExpand(m[2],m[1]); return; }

  const cBtn = e.target.closest('.comment-btn[data-cid]');
  if (cBtn) { toggleComments(cBtn.dataset.cid, cBtn.dataset.ctype); return; }

  const postBtn = e.target.closest('button[data-postid]');
  if (postBtn) { addComment(postBtn.dataset.postid, postBtn.dataset.posttype); return; }

  const editBtn = e.target.closest('button[data-editid]');
  if (editBtn) {
    const id=editBtn.dataset.editid, type=editBtn.dataset.edittype;
    const sec=document.getElementById(`edit-${type}-${id}`);
    if (sec) {
      sec.classList.toggle('open');
      if (sec.classList.contains('open')) {
        if (type==='i') {
          const ta=document.getElementById(`edit-exp-${id}`);
          const wc=document.getElementById(`edit-wc-i-${id}`);
          const updateWC=()=>{ const c=ta.value.trim().split(/\s+/).filter(Boolean).length; wc.textContent=`${c} / 1500 words`; wc.classList.toggle('over',c>1500); };
          ta.addEventListener('input',updateWC); updateWC();
          document.getElementById(`etab-write-i-${id}`)?.addEventListener('click',()=>toggleEditTab(id,'i','write'));
          document.getElementById(`etab-preview-i-${id}`)?.addEventListener('click',()=>toggleEditTab(id,'i','preview'));
        } else {
          document.getElementById(`etab-write-t-${id}`)?.addEventListener('click',()=>toggleEditTab(id,'t','write'));
          document.getElementById(`etab-preview-t-${id}`)?.addEventListener('click',()=>toggleEditTab(id,'t','preview'));
        }
        setTimeout(()=>{ document.getElementById(type==='i'?`edit-exp-${id}`:`edit-tak-${id}`)?.focus(); },50);
      }
    }
    return;
  }
  const cancelBtn = e.target.closest('button[data-cancelid]');
  if (cancelBtn) { document.getElementById(`edit-${cancelBtn.dataset.canceltype}-${cancelBtn.dataset.cancelid}`)?.classList.remove('open'); return; }

  const saveBtn = e.target.closest('button[data-saveid]');
  if (saveBtn) { saveEdit(saveBtn.dataset.saveid, saveBtn.dataset.savetype); return; }

  if (e.target.id==='loginPrompt') openAuthModal();
});

const expandState = {};
function toggleExpand(id, type) {
  const key=type+id; expandState[key]=!expandState[key];
  const list=type==='i'?(intuitions[selectedQuestion.id]||[]):(takeaways[selectedQuestion.id]||[]);
  const item=list.find(x=>x.id===id); if (!item) return;
  const content=type==='i'?item.explanation:item.content, ex=expandState[key];
  const el=document.getElementById((type==='i'?'iexp':'texp')+'-'+id);
  const btn=document.getElementById((type==='i'?'iexpbtn':'texpbtn')+'-'+id);
  if (el) { el.innerHTML=processText(ex?content:content.substring(0,300)+'…'); renderMath(el); }
  if (btn) btn.textContent=ex?'Show less':'Show more';
}
function toggleComments(id,type) { document.getElementById(`comments-${type}-${id}`)?.classList.toggle('open'); }

function toggleEditTab(id, type, mode) {
  const writeTab=document.getElementById(`etab-write-${type}-${id}`);
  const previewTab=document.getElementById(`etab-preview-${type}-${id}`);
  const writePane=document.getElementById(`epane-write-${type}-${id}`);
  const previewPane=document.getElementById(`epane-preview-${type}-${id}`);
  if (!writeTab) return;
  if (mode==='write') {
    writeTab.classList.add('active'); previewTab.classList.remove('active');
    writePane.classList.add('active'); previewPane.classList.remove('active');
  } else {
    previewTab.classList.add('active'); writeTab.classList.remove('active');
    previewPane.classList.add('active'); writePane.classList.remove('active');
    const raw=type==='i'?document.getElementById(`edit-exp-${id}`)?.value||'':document.getElementById(`edit-tak-${id}`)?.value||'';
    const el=document.getElementById(`epreview-${type}-${id}`);
    if (el) { el.innerHTML=raw.trim()?processText(raw):'<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>'; renderMath(el); }
  }
}

async function saveEdit(id, type) {
  if (!me) { openAuthModal(); return; }
  const saveBtn=document.querySelector(`button[data-saveid="${id}"][data-savetype="${type}"]`);
  if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }
  if (type==='i') {
    const stmt=document.getElementById(`edit-stmt-${id}`)?.value.trim();
    const exp =document.getElementById(`edit-exp-${id}`)?.value.trim();
    if (!stmt||!exp) { showToast('Statement and explanation cannot be empty.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    if (exp.split(/\s+/).filter(Boolean).length>1500) { showToast('Explanation exceeds 1500 words.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    const { error }=await db.from('intuitions').update({ statement:stmt, explanation:exp }).eq('id',id).eq('author_id',me.id);
    if (error) { showToast('Save failed: '+error.message,'error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    const item=(intuitions[selectedQuestion.id]||[]).find(x=>x.id===id);
    if (item) { item.statement=stmt; item.explanation=exp; item.edited=true; }
  } else {
    const content=document.getElementById(`edit-tak-${id}`)?.value.trim();
    if (!content) { showToast('Takeaway cannot be empty.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    const { error }=await db.from('takeaways').update({ content }).eq('id',id).eq('author_id',me.id);
    if (error) { showToast('Save failed: '+error.message,'error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    const item=(takeaways[selectedQuestion.id]||[]).find(x=>x.id===id);
    if (item) { item.content=content; item.edited=true; }
  }
  showToast('Saved!','success'); renderDetailItems();
}

function addComment(id, type) {
  if (!me) { openAuthModal(); return; }
  const el=document.getElementById(`ctext-${type}-${id}`), text=el?.value.trim(); if (!text) return;
  const comment={ id:'c'+(++idCounter), text, author:profile?.username||'You', createdAt:'just now' };
  const list=type==='i'?(intuitions[selectedQuestion.id]||[]):(takeaways[selectedQuestion.id]||[]);
  const item=list.find(x=>x.id===id);
  if (item) { if(!item.comments) item.comments=[]; item.comments.push(comment); }
  db.from('comments').insert({ parent_id:id, parent_type:type==='i'?'intuition':'takeaway', text, author_id:me.id });
  renderDetailItems();
  setTimeout(()=>document.getElementById(`comments-${type}-${id}`)?.classList.add('open'),10);
}

/* ── VOTING ───────────────────────────────────────────── */
async function handleVote(id, dir, type) {
  if (!me) { openAuthModal(); return; }
  const vm=type==='q'?questionVotes:type==='i'?intuitionVotes:takeawayVotes;
  const cur=vm[id]??null, next=cur===dir?null:dir;
  const ttype=type==='q'?'question':type==='i'?'intuition':'takeaway';
  const ud=(cur==='up'?-1:0)+(next==='up'?1:0);
  const dd=(cur==='down'?-1:0)+(next==='down'?1:0);
  vm[id]=next;
  const applyDelta=item=>{ item.upvotes+=ud; item.downvotes+=dd; };
  if (type==='q') { const q=questions.find(q=>q.id===id); if(q) applyDelta(q); if(selectedQuestion?.id===id) renderDetailHeader(); else renderQuestions(); }
  else if (type==='i'&&selectedQuestion) { const i=(intuitions[selectedQuestion.id]||[]).find(x=>x.id===id); if(i) applyDelta(i); renderDetailItems(); }
  else if (type==='t'&&selectedQuestion) { const t=(takeaways[selectedQuestion.id]||[]).find(x=>x.id===id); if(t) applyDelta(t); renderDetailItems(); }
  try {
    if (next===null) await db.from('votes').delete().eq('user_id',me.id).eq('target_id',id).eq('target_type',ttype);
    else if (cur===null) await db.from('votes').insert({ user_id:me.id, target_id:id, target_type:ttype, direction:next });
    else await db.from('votes').update({ direction:next }).eq('user_id',me.id).eq('target_id',id).eq('target_type',ttype);
  } catch(e) {
    showToast('Vote failed: '+e.message,'error');
    vm[id]=cur;
    const revert=item=>{ item.upvotes-=ud; item.downvotes-=dd; };
    if (type==='q') { const q=questions.find(q=>q.id===id); if(q) revert(q); renderQuestions(); }
    else if (type==='i'&&selectedQuestion) { const i=(intuitions[selectedQuestion.id]||[]).find(x=>x.id===id); if(i) revert(i); renderDetailItems(); }
    else if (type==='t'&&selectedQuestion) { const t=(takeaways[selectedQuestion.id]||[]).find(x=>x.id===id); if(t) revert(t); renderDetailItems(); }
  }
}

/* ── INLINE POST FORM ─────────────────────────────────── */
function renderPostForm() {
  const c=document.getElementById('postForm');
  c.innerHTML=currentDetailTab==='intuitions'?intuitionFormHTML():takeawayFormHTML();
  if (currentDetailTab==='intuitions') {
    const stEl=document.getElementById('pf-statement'), expEl=document.getElementById('pf-explanation');
    if (stEl)  { stEl.value=formState.statement;   stEl.addEventListener('input',e=>{formState.statement=e.target.value;updateWordCount();}); }
    if (expEl) { expEl.value=formState.explanation; expEl.addEventListener('input',e=>{formState.explanation=e.target.value;updateWordCount();}); }
    const elEl=document.getElementById('pf-exampleLink'), eeEl=document.getElementById('pf-exampleExp');
    if (elEl) { elEl.value=formState.exampleLink;        elEl.addEventListener('input',e=>{formState.exampleLink=e.target.value;}); }
    if (eeEl) { eeEl.value=formState.exampleExplanation; eeEl.addEventListener('input',e=>{formState.exampleExplanation=e.target.value;}); }
    // optional write/preview tabs
    document.getElementById('intExpWriteTab')?.addEventListener('click',()=>{
      document.getElementById('intExpWriteTab').classList.add('active');document.getElementById('intExpPreviewTab').classList.remove('active');
      document.getElementById('intExpWritePane').classList.add('active');document.getElementById('intExpPreviewPane').classList.remove('active');
    });
    document.getElementById('intExpPreviewTab')?.addEventListener('click',()=>{
      document.getElementById('intExpPreviewTab').classList.add('active');document.getElementById('intExpWriteTab').classList.remove('active');
      document.getElementById('intExpPreviewPane').classList.add('active');document.getElementById('intExpWritePane').classList.remove('active');
      const raw=document.getElementById('pf-explanation')?.value||'';
      const el=document.getElementById('intExpPreviewContent');
      el.innerHTML=raw.trim()?processText(raw):'<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>'; renderMath(el);
    });
    document.getElementById('pf-addlink')?.addEventListener('click', addIntLink);
    document.getElementById('pf-submitInt')?.addEventListener('click', submitIntuition);
    wireImagePreview('pf-intImage','pf-intImagePreviewBox','pf-intImagePreview','pf-intImageRemove',formState,'intImageFile');
    renderLinkList('int'); updateWordCount();
  } else {
    const tkEl=document.getElementById('pf-takeaway');
    if (tkEl) { tkEl.value=formState.takeawayContent; tkEl.addEventListener('input',e=>{formState.takeawayContent=e.target.value;}); }
    document.getElementById('takExpWriteTab')?.addEventListener('click',()=>{
      document.getElementById('takExpWriteTab').classList.add('active');document.getElementById('takExpPreviewTab').classList.remove('active');
      document.getElementById('takExpWritePane').classList.add('active');document.getElementById('takExpPreviewPane').classList.remove('active');
    });
    document.getElementById('takExpPreviewTab')?.addEventListener('click',()=>{
      document.getElementById('takExpPreviewTab').classList.add('active');document.getElementById('takExpWriteTab').classList.remove('active');
      document.getElementById('takExpPreviewPane').classList.add('active');document.getElementById('takExpWritePane').classList.remove('active');
      const raw=document.getElementById('pf-takeaway')?.value||'';
      const el=document.getElementById('takExpPreviewContent');
      el.innerHTML=raw.trim()?processText(raw):'<span style="color:var(--text3);font-style:italic;font-size:13px">Nothing to preview yet.</span>'; renderMath(el);
    });
    document.getElementById('pf-addtaklink')?.addEventListener('click', addTakLink);
    document.getElementById('pf-submitTak')?.addEventListener('click', submitTakeaway);
    wireImagePreview('pf-takImage','pf-takImagePreviewBox','pf-takImagePreview','pf-takImageRemove',formState,'takImageFile');
    renderLinkList('tak');
  }
}

function intuitionFormHTML() {
  const li=!!me;
  return `<div class="form-card">
    <div class="form-title">Share Your Intuition</div>
    ${!li?`<div class="login-notice">You need to <button class="btn-link" id="loginPrompt">log in</button> to post an intuition.</div>`:''}
    <div class="form-group"><label class="form-label">Intuition Statement</label><input class="form-input" id="pf-statement" placeholder="e.g. It factors because of a common root" ${!li?'disabled':''} /></div>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><label class="form-label" style="margin:0">Explanation</label><span id="wordCount" class="word-count">0 / 1500 words</span></div>
      <div class="preview-toggle"><button class="preview-tab active" id="intExpWriteTab">Write</button><button class="preview-tab" id="intExpPreviewTab">Preview</button></div>
      <div class="preview-pane active" id="intExpWritePane"><textarea class="form-textarea" id="pf-explanation" style="min-height:120px" ${!li?'disabled':''} placeholder="Explain your intuition… ($LaTeX$ and ||spoiler|| supported)"></textarea></div>
      <div class="preview-pane" id="intExpPreviewPane"><div class="preview-rendered kr" id="intExpPreviewContent" style="min-height:120px"></div></div>
    </div>
    <div class="form-group"><label class="form-label">Add Image (optional)</label>
      <input type="file" id="pf-intImage" accept="image/*" style="color:var(--text2);font-size:13px" ${!li?'disabled':''} />
      <div class="img-preview-box" id="pf-intImagePreviewBox" style="display:none"><img id="pf-intImagePreview" src="" alt="Preview" /><button class="img-preview-remove" id="pf-intImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    </div>
    <div class="form-group"><label class="form-label">Links (optional, max 3)</label><div class="link-input-row"><input class="form-input" id="pf-link" placeholder="https://…" style="flex:1" ${!li?'disabled':''} /><button class="btn btn-ghost btn-sm" id="pf-addlink" ${!li?'disabled':''}>Add</button></div><div class="link-list" id="int-links"></div></div>
    <hr class="form-divider"/>
    <div class="form-group"><label class="form-label">Problem Link (optional)</label><input class="form-input" id="pf-exampleLink" placeholder="https://…" ${!li?'disabled':''} /></div>
    <div class="form-group"><label class="form-label">Additional Context (optional)</label><textarea class="form-textarea" id="pf-exampleExp" style="min-height:70px" ${!li?'disabled':''}></textarea></div>
    <button class="btn btn-primary" id="pf-submitInt" ${!li?'disabled':''}>Post Intuition</button>
  </div>`;
}

function takeawayFormHTML() {
  const li=!!me;
  return `<div class="form-card">
    <div class="form-title">Share Your Takeaway</div>
    ${!li?`<div class="login-notice">You need to <button class="btn-link" id="loginPrompt">log in</button> to post a takeaway.</div>`:''}
    <div class="form-group"><label class="form-label">Your Takeaway</label>
      <div class="preview-toggle"><button class="preview-tab active" id="takExpWriteTab">Write</button><button class="preview-tab" id="takExpPreviewTab">Preview</button></div>
      <div class="preview-pane active" id="takExpWritePane"><textarea class="form-textarea" id="pf-takeaway" style="min-height:130px" ${!li?'disabled':''} placeholder="Share your insights… ($LaTeX$ and ||spoiler|| supported)"></textarea></div>
      <div class="preview-pane" id="takExpPreviewPane"><div class="preview-rendered kr" id="takExpPreviewContent" style="min-height:130px"></div></div>
    </div>
    <div class="form-group"><label class="form-label">Add Image (optional)</label>
      <input type="file" id="pf-takImage" accept="image/*" style="color:var(--text2);font-size:13px" ${!li?'disabled':''} />
      <div class="img-preview-box" id="pf-takImagePreviewBox" style="display:none"><img id="pf-takImagePreview" src="" alt="Preview" /><button class="img-preview-remove" id="pf-takImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    </div>
    <div class="form-group"><label class="form-label">Links (optional)</label><div class="link-input-row"><input class="form-input" id="pf-taklink" placeholder="https://…" style="flex:1" ${!li?'disabled':''} /><button class="btn btn-ghost btn-sm" id="pf-addtaklink" ${!li?'disabled':''}>Add</button></div><div class="link-list" id="tak-links"></div></div>
    <button class="btn btn-primary" id="pf-submitTak" ${!li?'disabled':''}>Post Takeaway</button>
  </div>`;
}

function updateWordCount() {
  const el=document.getElementById('pf-explanation'), wc=document.getElementById('wordCount');
  if (!el||!wc) return;
  const c=el.value.trim().split(/\s+/).filter(Boolean).length;
  wc.textContent=`${c} / 1500 words`; wc.classList.toggle('over',c>1500);
  const btn=document.getElementById('pf-submitInt');
  if (btn) btn.disabled=c>1500||!formState.statement.trim()||!formState.explanation.trim();
}

function addIntLink() {
  const i=document.getElementById('pf-link'), v=i?.value.trim(); if (!v) return;
  if (!isValidURL(v)) { showToast('Please enter a valid URL','error'); return; }
  if (formState.explanationLinks.length>=3) { showToast('Max 3 links allowed','error'); return; }
  formState.explanationLinks.push(v); i.value=''; renderLinkList('int');
}
function removeIntLink(idx) { formState.explanationLinks.splice(idx,1); renderLinkList('int'); }
function addTakLink() {
  const i=document.getElementById('pf-taklink'), v=i?.value.trim(); if (!v) return;
  if (!isValidURL(v)) { showToast('Please enter a valid URL','error'); return; }
  formState.takeawayLinks.push(v); i.value=''; renderLinkList('tak');
}
function removeTakLink(idx) { formState.takeawayLinks.splice(idx,1); renderLinkList('tak'); }
function renderLinkList(type) {
  const c=document.getElementById(type+'-links'); if (!c) return;
  const links=type==='int'?formState.explanationLinks:formState.takeawayLinks;
  const fn=type==='int'?'removeIntLink':'removeTakLink';
  c.innerHTML=links.map((l,i)=>`<div class="link-item"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a><button class="remove-link-btn" onclick="${fn}(${i})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
}

async function submitIntuition() {
  if (!me) { openAuthModal(); return; }
  let imageUrl=null;
  if (formState.intImageFile) { try { imageUrl=await uploadImage(formState.intImageFile); } catch(e) { showToast('Image upload failed: '+e.message,'error'); return; } }
  const stmt=document.getElementById('pf-statement')?.value.trim();
  const exp =document.getElementById('pf-explanation')?.value.trim();
  if (!stmt||!exp) { showToast('Please fill in both the statement and explanation.','error'); return; }
  if (exp.split(/\s+/).filter(Boolean).length>1500) { showToast('Explanation exceeds 1500 words.','error'); return; }
  const btn=document.getElementById('pf-submitInt');
  btn.disabled=true; btn.textContent='Posting…';
  const exLink=document.getElementById('pf-exampleLink')?.value.trim()||null;
  const exExp =document.getElementById('pf-exampleExp')?.value.trim()||null;
  const { data:d, error:e }=await db.from('intuitions').insert({ question_id:selectedQuestion.id, statement:stmt, explanation:exp, example_link:exLink, example_explanation:exExp, author_id:me.id, image_url:imageUrl }).select('id').single();
  if (e) { showToast('Error posting: '+e.message,'error'); btn.disabled=false; btn.textContent='Post Intuition'; return; }
  if (formState.explanationLinks.length&&d) await db.from('links').insert(formState.explanationLinks.map(url=>({ parent_id:d.id, parent_type:'intuition', url })));
  Object.assign(formState,{ statement:'', explanation:'', explanationLinks:[], exampleLink:'', exampleExplanation:'', intImageFile:null });
  showToast('Intuition posted!','success');
  await loadDetailItems(selectedQuestion.id);
  renderDetailItems(); renderPostForm();
  window.scrollTo({ top:document.getElementById('dtab-intuitions').offsetTop-80, behavior:'smooth' });
}

async function submitTakeaway() {
  if (!me) { openAuthModal(); return; }
  let imageUrl=null;
  if (formState.takImageFile) { try { imageUrl=await uploadImage(formState.takImageFile); } catch(e) { showToast('Image upload failed: '+e.message,'error'); return; } }
  const content=document.getElementById('pf-takeaway')?.value.trim();
  if (!content) { showToast('Please write your takeaway.','error'); return; }
  const btn=document.getElementById('pf-submitTak');
  btn.disabled=true; btn.textContent='Posting…';
  const { data:d, error:e }=await db.from('takeaways').insert({ question_id:selectedQuestion.id, content, image_url:imageUrl, author_id:me.id }).select('id').single();
  if (e) { showToast('Error posting: '+e.message,'error'); btn.disabled=false; btn.textContent='Post Takeaway'; return; }
  if (formState.takeawayLinks.length&&d) await db.from('links').insert(formState.takeawayLinks.map(url=>({ parent_id:d.id, parent_type:'takeaway', url })));
  Object.assign(formState,{ takeawayContent:'', takeawayLinks:[], takImageFile:null });
  showToast('Takeaway posted!','success');
  await loadDetailItems(selectedQuestion.id);
  renderDetailItems(); renderPostForm();
  window.scrollTo({ top:document.getElementById('dtab-takeaways').offsetTop-80, behavior:'smooth' });
}
