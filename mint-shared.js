'use strict';
/* ── APPWRITE ─────────────────────────────────────────── */
const PROJECT_ID = '69f87cc5001ba9cd97e5';
const DB_ID      = 'public';
const BUCKET_ID  = '6a14f7a546a2dafa90b3';

const client = new Appwrite.Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject(PROJECT_ID);

const account   = new Appwrite.Account(client);
const databases  = new Appwrite.Databases(client);
const storage    = new Appwrite.Storage(client);
const { ID, Query } = Appwrite;

/* Collection IDs – adjust if your collection names differ */
const COLLECTIONS = {
  profiles:       'profiles',
  questions:      'questions',
  tags:           'tags',
  question_tags:  'question_tags',
  intuitions:     'intuitions',
  takeaways:      'takeaways',
  links:          'links',
  votes:          'votes',
  comments:       'comments',
  reports:        'reports',
};

/* ── STATE ────────────────────────────────────────────── */
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
/* ||text|| becomes a Discord-style spoiler: each block hides on its own and a click reveals just that one */
function processText(raw) {
  if (!raw) return '';
  return esc(raw).replace(/\|\|([\s\S]+?)\|\|/g, (_,c) =>
    `<span class="spoiler" role="button" tabindex="0" aria-label="Hidden text. Click to reveal.">${c}</span>`);
}
/* Shorten long text for a preview without cutting a spoiler or a $math$ block open */
function previewText(text, max = 300) {
  if (!text || text.length <= max) return text || '';
  let cut = text.slice(0, max);
  if ((cut.match(/\$\$/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('$$'));             // inside $$math$$
  if ((cut.replace(/\$\$/g, '').match(/(?<!\\)\$/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('$'));   // inside $math$
  if ((cut.match(/\|\|/g) || []).length % 2) cut += '||';                                        // inside a spoiler: keep it hidden
  return cut.trimEnd() + '…';
}
function revealSpoiler(el) {
  el.classList.add('revealed');
  el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label');
}
document.addEventListener('click', e => {
  const sp = e.target.closest('.spoiler:not(.revealed)');
  if (sp) { e.stopPropagation(); e.preventDefault(); revealSpoiler(sp); }
}, true);
document.addEventListener('keydown', e => {
  const sp = e.target.closest?.('.spoiler:not(.revealed)');
  if (sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); revealSpoiler(sp); }
});
function renderMath(el) {
  if (window.renderMathInElement) renderMathInElement(el, {
    delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],
    throwOnError:false
  });
}
function isValidURL(s) { return !!safeUrl(s); }
function getParam(n) { return new URLSearchParams(window.location.search).get(n); }
function showToast(msg, type='success') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = `toast ${type}`;
  const icon = type==='success'
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
  t.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${icon}</svg> `;
  t.append(String(msg));   // text only, never HTML
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function highlightText(text, query) {
  if (!query || !text) return esc(text || '');
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return esc(text).replace(re, '<span class="hl">$1</span>');
}

async function fetchVoteCounts(ids) {
  const totals = await fetchVoteTotals(ids), m = {};
  for (const [id, t] of Object.entries(totals)) m[id] = { upvotes: t.up, downvotes: t.down };
  return m;
}

async function uploadImage(file) {
  const res = await storage.createFile(BUCKET_ID, ID.unique(), file);
  return `https://sgp.cloud.appwrite.io/v1/storage/buckets/${BUCKET_ID}/files/${res.$id}/view?project=${PROJECT_ID}`;
}

/* ── THEME ────────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.className = t;
  document.getElementById('iconDark').classList.toggle('hidden', t==='dark');
  document.getElementById('iconLight').classList.toggle('hidden', t==='light');
}

/* ── AUTH ─────────────────────────────────────────────── */
/* Login lives in mint-auth.js; re-draw the post form when login state changes */
function onAuthChange() {
  if (selectedQuestion) renderPostForm();
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
  btn.addEventListener('click', e => {
    e.stopPropagation();
    btn.setAttribute('aria-expanded', menu.classList.toggle('open'));
  });
  document.addEventListener('click', () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });

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

const MAX_TOPIC_TAGS = 5;
function renderNewQSscTags() {
  const wrap      = document.getElementById('newQSscWrap');
  const accordion = document.getElementById('sscAccordion');
  if (selectedSubTopics.size === 0) { wrap.style.display='none'; accordion.innerHTML=''; return; }
  wrap.style.display = 'block';
  const makeTagBtn = (sub, name, type) => {
    const tagKey = sscTagName(sub, name, type), sel = selectedNewQTags.has(tagKey);
    const tc = type==='technique' ? 'var(--gold)' : 'var(--blue)';
    const bg = sel ? (type==='technique'?'rgba(217,180,95,.25)':'rgba(143,179,224,.25)') : (type==='technique'?'rgba(217,180,95,.1)':'rgba(143,179,224,.1)');
    const border = sel ? (type==='technique'?'rgba(217,180,95,.5)':'rgba(143,179,224,.5)') : (type==='technique'?'rgba(217,180,95,.2)':'rgba(143,179,224,.2)');
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
      if (selectedNewQTags.has(key)) {
        selectedNewQTags.delete(key);
      } else {
        if (selectedNewQTags.size >= MAX_TOPIC_TAGS) {
          showToast(`Max ${MAX_TOPIC_TAGS} tags allowed`, 'error');
          return;
        }
        selectedNewQTags.add(key);
      }
      renderNewQSscTags();
    });
  });
  const selectedEl = document.getElementById('newQSelectedTags');
  if (selectedNewQTags.size === 0) { selectedEl.innerHTML=''; return; }
  const countLabel = `<div style="font-size:11px;color:var(--text3);margin-bottom:4px">${selectedNewQTags.size} / ${MAX_TOPIC_TAGS} tags selected</div>`;
  selectedEl.innerHTML = countLabel + [...selectedNewQTags].map(key => {
    const p = parseSscTag(key); if (!p) return '';
    const tc = p.type==='technique' ? 'var(--gold)' : 'var(--blue)';
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:3px;font-size:11px;font-weight:600;background:${p.type==='technique'?'rgba(217,180,95,.12)':'rgba(143,179,224,.12)'};color:${tc};border:1px solid ${p.type==='technique'?'rgba(217,180,95,.25)':'rgba(143,179,224,.25)'}">
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
  if (!throttle('post')) return;
  const title = document.getElementById('newQTitle').value.trim();
  const about = document.getElementById('newQAbout').value.trim();
  if (!title) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please enter a topic title.</div>'; return; }
  if (!about) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please add a brief description.</div>'; return; }
  if (selectedSubTopics.size === 0) { document.getElementById('postSubError').innerHTML='<div class="err-box">Please select at least one topic.</div>'; return; }
  const btn = document.getElementById('postSubSubmitBtn');
  btn.disabled=true; btn.textContent='Posting…';
  try {
    const qDoc = await databases.createDocument(DB_ID, COLLECTIONS.questions, ID.unique(), { title, about });
    const qid = qDoc.$id;

    for (const tagName of [...selectedSubTopics, ...selectedNewQTags]) {
      let tagId;
      try {
        const existing = await databases.listDocuments(DB_ID, COLLECTIONS.tags, [
          Query.equal('name', tagName),
          Query.equal('category', TOPIC_NAME),
          Query.limit(1),
        ]);
        tagId = existing.documents.length
          ? existing.documents[0].$id
          : (await databases.createDocument(DB_ID, COLLECTIONS.tags, ID.unique(), { name: tagName, category: TOPIC_NAME })).$id;
      } catch(e) {
        document.getElementById('postSubError').innerHTML=`<div class="err-box">Tag error: ${esc(e.message)}</div>`;
        btn.disabled=false; btn.textContent='Post Topic'; return;
      }
      await databases.createDocument(DB_ID, COLLECTIONS.question_tags, ID.unique(), {
        question_id: qid, tag_id: tagId
      });
    }

    showToast('Topic posted!', 'success');
    closeSubModal();
    await loadQuestions();
    const newQ = questions.find(q => q.id === qid);
    if (newQ) openQuestion(qid);
  } catch(e) {
    document.getElementById('postSubError').innerHTML=`<div class="err-box">Error: ${esc(e.message)}</div>`;
  }
  btn.disabled=false; btn.textContent='Post Topic';
}

/* ── GLOBAL INT MODAL ─────────────────────────────────── */
function openGlobalIntModal(preselectedQId) {
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
  document.getElementById('intWordCount').textContent = '0 / 2000 words';
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
     <button class="remove-link-btn" aria-label="Remove link" onclick="removeGIntLink(${i})">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
     </button></div>`
  ).join('');
}
function removeGIntLink(i) { gIntState.links.splice(i,1); renderIntLinks(); }
function renderTakLinks() {
  const c = document.getElementById('takLinkList'); if (!c) return;
  c.innerHTML = gTakState.links.map((l,i) =>
    `<div class="link-item"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>
     <button class="remove-link-btn" aria-label="Remove link" onclick="removeGTakLink(${i})">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
     </button></div>`
  ).join('');
}
function removeGTakLink(i) { gTakState.links.splice(i,1); renderTakLinks(); }

/* ── SUBMIT INT (global modal) ────────────────────────── */
async function submitGlobalIntuition() {
  if (!me) { openAuthModal(); return; }
  if (!throttle('post')) return;
  let imageUrl = null;
  if (gIntState.imageFile) {
    try { imageUrl = await uploadImage(gIntState.imageFile); }
    catch(e) { showToast('Image upload failed: '+e.message,'error'); return; }
  }
  const stmt = document.getElementById('intStatement').value.trim();
  const exp  = document.getElementById('intExplanation').value.trim();
  if (!gIntState.selectedQIds.size) { document.getElementById('postIntError').innerHTML='<div class="err-box">Please select at least one topic.</div>'; return; }
  if (!stmt || !exp) { document.getElementById('postIntError').innerHTML='<div class="err-box">Please fill in the statement and explanation.</div>'; return; }
  if (exp.split(/\s+/).filter(Boolean).length > 2000) { document.getElementById('postIntError').innerHTML='<div class="err-box">Explanation exceeds 2000 words.</div>'; return; }
  const btn = document.getElementById('postIntSubmitBtn');
  btn.disabled=true; btn.textContent='Posting…';
  const exLink = document.getElementById('intExampleLink').value.trim() || null;
  const exExp  = document.getElementById('intExampleExp').value.trim() || null;
  let posted=0, failed=0;
  for (const qid of [...gIntState.selectedQIds]) {
    try {
      const d = await databases.createDocument(DB_ID, COLLECTIONS.intuitions, ID.unique(), {
        question_id: qid, statement: stmt, explanation: exp,
        example_link: exLink, example_explanation: exExp,
        author_id: me.$id, image_url: imageUrl
      }, mine());
      for (const url of gIntState.links) {
        await databases.createDocument(DB_ID, COLLECTIONS.links, ID.unique(), {
          parent_id: d.$id, parent_type: 'intuition', url
        }, mine());
      }
      posted++;
    } catch { failed++; }
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
  if (!throttle('post')) return;
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
    try {
      const d = await databases.createDocument(DB_ID, COLLECTIONS.takeaways, ID.unique(), {
        question_id: qid,
        image_url: imageUrl,
        content,
        author_id: me.$id
      }, mine());
      for (const url of gTakState.links) {
        await databases.createDocument(DB_ID, COLLECTIONS.links, ID.unique(), {
          parent_id: d.$id, parent_type: 'takeaway', url
        }, mine());
      }
      posted++;
    } catch { failed++; }
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
  if (window.renderMathInElement || window._katexFailed) _katexReady = true;
  tryBoot();
}

async function boot() {
  applyTheme(localStorage.getItem('theme') || 'light');
  document.getElementById('themeBtn').addEventListener('click', () => {
    const t = document.documentElement.className === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', t); applyTheme(t);
  });
  try {
    bindEvents();
    await initAuth();
    buildSidebar();
    initPostDropdown();
    wireQPickers();
    await loadQuestions();
    const qp = getParam('q');
    if (qp) { const q = questions.find(x => x.id===qp); if (q) openQuestion(q.id); }
  } catch (e) {
    console.error('Boot failed', e);
  } finally {
    // A post link we couldn't open: fall back to the list instead of a stuck skeleton
    if (getParam('q') && !selectedQuestion) {
      document.getElementById('detailView').style.display = 'none';
      document.getElementById('listView').style.display = 'block';
    }
    document.body.classList.add('ready');
  }
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
  bindAuthModal();

  // Intuition modal
  document.getElementById('postIntModal').addEventListener('click', e => { if (e.target===e.currentTarget) closeGlobalIntModal(); });
  document.getElementById('postIntCancelBtn').addEventListener('click', closeGlobalIntModal);
  document.getElementById('postIntSubmitBtn').addEventListener('click', submitGlobalIntuition);
  document.getElementById('intExplanation').addEventListener('input', () => {
    const c = document.getElementById('intExplanation').value.trim().split(/\s+/).filter(Boolean).length;
    const wc = document.getElementById('intWordCount');
    wc.textContent=`${c} / 2000 words`; wc.classList.toggle('over', c>2000);
  });
  document.getElementById('intAddLink').addEventListener('click', () => {
    const i=document.getElementById('intLinkInput'), v=i?.value.trim(); if (!v) return;
    if (!isValidURL(v)) { showToast('Please enter a valid URL','error'); return; }
    if (gIntState.links.length>=3) { showToast('Max 3 links allowed','error'); return; }
    gIntState.links.push(v); i.value=''; renderIntLinks();
  });

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
}

/* ── LOAD QUESTIONS ───────────────────────────────────── */
async function loadQuestions() {
  document.getElementById('questionsList').innerHTML = listSkeleton(5);
  try {
    const tagRes = await databases.listDocuments(DB_ID, COLLECTIONS.tags, [
      Query.equal('category', TOPIC_NAME), Query.limit(500)
    ]);
    if (!tagRes.documents.length) { questions=[]; renderQuestions(); return; }
    const tagIds = tagRes.documents.map(t => t.$id);

    const qtRes = await databases.listDocuments(DB_ID, COLLECTIONS.question_tags, [
      Query.equal('tag_id', tagIds), Query.limit(1000)
    ]);
    if (!qtRes.documents.length) { questions=[]; renderQuestions(); return; }
    const qIds = [...new Set(qtRes.documents.map(qt => qt.question_id))];

    const qRes = await databases.listDocuments(DB_ID, COLLECTIONS.questions, [
      Query.equal('$id', qIds), Query.orderDesc('$createdAt'), Query.limit(200)
    ]);

    const allQtRes = await databases.listDocuments(DB_ID, COLLECTIONS.question_tags, [
      Query.equal('question_id', qIds), Query.limit(2000)
    ]);
    const tagNameMap = {};
    tagRes.documents.forEach(t => { tagNameMap[t.$id] = t.name; });
    const qTagsMap = {};
    allQtRes.documents.forEach(qt => {
      if (!qTagsMap[qt.question_id]) qTagsMap[qt.question_id] = [];
      if (tagNameMap[qt.tag_id]) qTagsMap[qt.question_id].push(tagNameMap[qt.tag_id]);
    });

    const [intRes, takRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.intuitions, [
        Query.equal('question_id', qIds), Query.limit(1000)
      ]),
      databases.listDocuments(DB_ID, COLLECTIONS.takeaways, [
        Query.equal('question_id', qIds), Query.limit(1000)
      ]),
    ]);
    const intCount = {}, takCount = {};
    intRes.documents.forEach(i => { intCount[i.question_id] = (intCount[i.question_id]||0)+1; });
    takRes.documents.forEach(t => { takCount[t.question_id] = (takCount[t.question_id]||0)+1; });

    questions = qRes.documents.map(q => ({
      id: q.$id, title: q.title, about: q.about,
      createdAt: ago(q.$createdAt), createdAtRaw: q.$createdAt,
      tags: qTagsMap[q.$id] || [],
      intuitionCount: intCount[q.$id] || 0,
      takeawayCount:  takCount[q.$id] || 0,
      upvotes: 0, downvotes: 0,
    }));

    const vc = await fetchVoteCounts(qIds, 'question');
    questions.forEach(q => { const v=vc[q.id]||{}; q.upvotes=v.upvotes||0; q.downvotes=v.downvotes||0; });

    if (me) {
      try {
        const vRes = await databases.listDocuments(DB_ID, COLLECTIONS.votes, [
          Query.equal('user_id', me.$id),
          Query.equal('target_type', 'question'),
          Query.equal('target_id', qIds),
          Query.limit(500),
        ]);
        vRes.documents.forEach(v => { questionVotes[v.target_id] = v.direction; });
      } catch {}
    }
    renderQuestions();
  } catch(e) {
    document.getElementById('questionsList').innerHTML = `<div class="err-box">Failed to load: ${esc(e.message)}</div>`;
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
      ? `<div class="empty-state">No questions found for "<strong>${esc(query)}</strong>".<br><span style="font-size:12px;opacity:.7">Try a different keyword or browse by topic.</span></div>`
      : `<div class="empty-state">No questions yet${activeSubtopic?` in ${activeSubtopic}`:''}. Be the first!</div>`;
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
      <button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${q.id}" data-vdir="up" aria-label="Upvote">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg>
      </button>
      <span class="vote-score ${sc}">${score}</span>
      <button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${q.id}" data-vdir="down" aria-label="Downvote">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg>
      </button>
      <div class="bulb-count"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6l-.7.6V18H9v-2.4l-.7-.6A7 7 0 0 1 12 2z"/></svg>${q.intuitionCount}</div>
    </div>
    <div class="card-content">
      <div class="card-title kr">${titleHTML}</div>
      <div class="card-about"><span class="kr">${aboutHTML}</span></div>
      <div class="tags">${q.tags.map((t,idx)=>{
        const ssc=parseSscTag(t);
        if (ssc) {
          const col=ssc.type==='technique'?'rgba(217,180,95,.15)':'rgba(143,179,224,.15)';
          const bdr=ssc.type==='technique'?'rgba(217,180,95,.3)':'rgba(143,179,224,.3)';
          const tc =ssc.type==='technique'?'var(--gold)':'var(--blue)';
          return `<span style="text-align:center;padding:3px 11px;border-radius:3px;font-size:var(--text-about);font-weight:700;background:${col};color:${tc};border:1px solid ${bdr};cursor:pointer" data-q="${esc(t.split('::')[1]||'')}" onclick="event.stopPropagation();setSearchQuery(this.dataset.q)">${esc(ssc.name)}</span>`;
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
  if (!throttle('report')) return;
  const label = type==='question'?'question':type==='intuition'?'intuition':'takeaway';
  const reason = prompt(`Why are you reporting this ${label}?`);
  if (!reason?.trim()) return;
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.reports, ID.unique(), {
      target_id: id, target_type: type, reason: reason.trim(), user_id: me.$id
    });
    showToast('Reported — thanks for keeping MINT clean.','success');
  } catch(e) {
    showToast('Report failed: '+e.message,'error');
  }
}

/* ── DETAIL VIEW ──────────────────────────────────────── */
async function openQuestion(id) {
  selectedQuestion = questions.find(q=>q.id===id);
  document.getElementById('listView').style.display='none';
  document.getElementById('detailView').style.display='block';
  renderDetailHeader();
  document.getElementById('dtab-intuitions').innerHTML=itemSkeleton(2);
  document.getElementById('dtab-takeaways').innerHTML =itemSkeleton(2);
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
  const [intRes, takRes] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.intuitions, [
      Query.equal('question_id', qid), Query.orderDesc('$createdAt'), Query.limit(500)
    ]),
    databases.listDocuments(DB_ID, COLLECTIONS.takeaways, [
      Query.equal('question_id', qid), Query.orderDesc('$createdAt'), Query.limit(500)
    ]),
  ]);

  // Only trust an author_id the row's permissions back up (stops impersonation)
  const ints = intRes.documents.filter(i => ownedRow(i, i.author_id));
  const taks = takRes.documents.filter(t => ownedRow(t, t.author_id));
  const authorMap = await fetchUsernames([...ints, ...taks].map(x => x.author_id));

  intuitions[qid] = ints.map(i => ({
    id: i.$id, statement: i.statement, explanation: i.explanation,
    exampleLink: i.example_link||'', exampleExplanation: i.example_explanation||'',
    image_url: i.image_url||'',
    author: authorMap[i.author_id] || 'Unknown',
    author_id: i.author_id,
    createdAt: ago(i.$createdAt), createdAtRaw: i.$createdAt,
    upvotes: 0, downvotes: 0, explanationLinks: [], comments: [], edited: false
  }));
  takeaways[qid] = taks.map(t => ({
    id: t.$id, content: t.content, image_url: t.image_url||'',
    author: authorMap[t.author_id] || 'Unknown',
    author_id: t.author_id,
    createdAt: ago(t.$createdAt), createdAtRaw: t.$createdAt,
    upvotes: 0, downvotes: 0, links: [], comments: [], edited: false
  }));

  const intIds = intuitions[qid].map(i=>i.id), takIds = takeaways[qid].map(t=>t.id);
  const allIds = [...intIds,...takIds];

  if (allIds.length) {
    try {
      const cRes = await databases.listDocuments(DB_ID, COLLECTIONS.comments, [
        Query.equal('parent_id', allIds), Query.orderAsc('$createdAt'), Query.limit(1000)
      ]);
      const comments = cRes.documents.filter(c => ownedRow(c, c.author_id));
      const names = await fetchUsernames(comments.map(c => c.author_id));
      comments.forEach(c => {
        const list = c.parent_type === 'intuition' ? intuitions[qid] : takeaways[qid];
        const item = list.find(x => x.id === c.parent_id);
        if (item) item.comments.push({ id: c.$id, text: c.text, author: names[c.author_id] || 'Unknown', authorId: c.author_id, createdAt: ago(c.$createdAt) });
      });
    } catch {}
  }

  if (allIds.length) {
    try {
      const linkRes = await databases.listDocuments(DB_ID, COLLECTIONS.links, [
        Query.equal('parent_id', allIds), Query.limit(1000)
      ]);
      linkRes.documents.forEach(l => {
        if (l.parent_type==='intuition') { const item=intuitions[qid].find(i=>i.id===l.parent_id); if(item) item.explanationLinks.push(l.url); }
        else if (l.parent_type==='takeaway') { const item=takeaways[qid].find(t=>t.id===l.parent_id); if(item) item.links.push(l.url); }
      });
    } catch {}
  }

  const [ivc, tvc] = await Promise.all([
    fetchVoteCounts(intIds, 'intuition'),
    fetchVoteCounts(takIds, 'takeaway'),
  ]);
  intuitions[qid].forEach(i=>{ const v=ivc[i.id]||{}; i.upvotes=+v.upvotes||0; i.downvotes=+v.downvotes||0; });
  takeaways[qid].forEach(t=>{ const v=tvc[t.id]||{}; t.upvotes=+v.upvotes||0; t.downvotes=+v.downvotes||0; });

  if (me && allIds.length) {
    try {
      const vRes = await databases.listDocuments(DB_ID, COLLECTIONS.votes, [
        Query.equal('user_id', me.$id),
        Query.equal('target_id', allIds),
        Query.limit(500),
      ]);
      vRes.documents.forEach(v => {
        if (v.target_type==='intuition') intuitionVotes[v.target_id]=v.direction;
        if (v.target_type==='takeaway')  takeawayVotes[v.target_id]=v.direction;
      });
    } catch {}
  }
}

function renderDetailHeader() {
  const q=selectedQuestion, score=q.upvotes-q.downvotes, vu=questionVotes[q.id], sc=score>0?'positive':score<0?'negative':'';
  document.getElementById('detailVoteCol').innerHTML=`
    <button class="vote-btn ${vu==='up'?'voted-up':''}" id="dvUp" aria-label="Upvote"><svg width="20" height="20" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button>
    <span class="vote-score ${sc}" style="font-size:17px">${score}</span>
    <button class="vote-btn ${vu==='down'?'voted-down':''}" id="dvDown" aria-label="Downvote"><svg width="20" height="20" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button>
    <div class="bulb-count" style="flex-direction:column;gap:2px;margin-top:8px;text-align:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6l-.7.6V18H9v-2.4l-.7-.6A7 7 0 0 1 12 2z"/></svg><span>${(intuitions[q.id]||[]).length}</span></div>`;
  document.getElementById('dvUp').addEventListener('click',()=>handleVote(q.id,'up','q'));
  document.getElementById('dvDown').addEventListener('click',()=>handleVote(q.id,'down','q'));
  document.getElementById('detailContent').innerHTML=`
    <div class="detail-title kr">${esc(q.title)}</div>
    <div class="detail-about"><span class="kr">${esc(q.about)}</span></div>
    <div class="tags" style="margin:10px 0">${q.tags.map((t,i)=>{
      const ssc=parseSscTag(t);
      if(ssc){const col=ssc.type==='technique'?'rgba(217,180,95,.15)':'rgba(143,179,224,.15)';const bdr=ssc.type==='technique'?'rgba(217,180,95,.3)':'rgba(143,179,224,.3)';const tc=ssc.type==='technique'?'var(--gold)':'var(--blue)';return`<span style="padding:3px 11px;border-radius:3px;font-size:var(--text-about);font-weight:700;background:${col};color:${tc};border:1px solid ${bdr}">${esc(ssc.name)}</span>`;}
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
  ic.innerHTML=si.length?si.map((i,idx)=>intuitionCardHTML(i,idx)).join(''):'<div class="empty-state">No intuitions yet. Be the first!</div>';
  ic.querySelectorAll('.kr').forEach(renderMath);
  ic.querySelectorAll('.vote-btn[data-vid]').forEach(btn=>btn.addEventListener('click',()=>handleVote(btn.dataset.vid,btn.dataset.vdir,'i')));
  ic.querySelectorAll('.btn-report[data-reportid]').forEach(btn=>btn.addEventListener('click',()=>handleReport(btn.dataset.reportid,btn.dataset.reporttype)));
  const tc=document.getElementById('dtab-takeaways'), st=sortItems(tl,currentDetailSort);
  tc.innerHTML=st.length?st.map((t,idx)=>takeawayCardHTML(t,idx)).join(''):'<div class="empty-state">No takeaways yet. Share what you learned!</div>';
  tc.querySelectorAll('.kr').forEach(renderMath);
  tc.querySelectorAll('.vote-btn[data-vid]').forEach(btn=>btn.addEventListener('click',()=>handleVote(btn.dataset.vid,btn.dataset.vdir,'t')));
  tc.querySelectorAll('.btn-report[data-reportid]').forEach(btn=>btn.addEventListener('click',()=>handleReport(btn.dataset.reportid,btn.dataset.reporttype)));
  renderDetailHeader();
}

function intuitionCardHTML(item, idx=0) {
  const score=item.upvotes-item.downvotes,vu=intuitionVotes[item.id],sc=score>0?'positive':score<0?'negative':'';
  const exp=item.explanation||'',trunc=exp.length>300,disp=trunc?previewText(exp):exp;
  const linksHTML=(item.explanationLinks||[]).length?`<div class="i-links">${item.explanationLinks.filter(safeUrl).map(l=>`<a class="i-link" href="${esc(safeUrl(l))}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join('')}</div>`:'';
  const exHTML=(item.exampleLink||item.exampleExplanation)?`<div class="i-example"><div class="i-label">Example</div>${safeUrl(item.exampleLink)?`<a class="i-link" href="${esc(safeUrl(item.exampleLink))}" target="_blank" rel="noopener noreferrer">${esc(item.exampleLink)}</a>`:''}${item.exampleExplanation?`<div class="kr" style="font-size:13.5px;color:var(--text2);margin-top:6px">${processText(item.exampleExplanation)}</div>`:''}</div>`:'';
  const imgHTML=safeUrl(item.image_url)?`<img src="${esc(safeUrl(item.image_url))}" alt="Intuition image" style="max-width:100%;border-radius:4px;margin-top:10px;border:1px solid var(--border)" />`:'';
  const cc=(item.comments||[]).length,cHTML=(item.comments||[]).map(c=>`<div class="comment-item"><div class="comment-text">${processText(c.text)}</div><div class="comment-meta">${authorLink(c.author)} · ${c.createdAt}${canDelete(c.authorId)?` <button class="btn-report btn-delete" data-delid="${c.id}" data-deltype="c" data-parent="${item.id}" aria-label="Delete comment">Delete</button>`:''}</div></div>`).join('');
  const isOwn=me&&me.$id===item.author_id;
  const editBtn=isOwn?`<button class="btn-edit" data-editid="${item.id}" data-edittype="i"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`:'';
  const delBtn=canDelete(item.author_id)?`<button class="btn-edit btn-delete" data-delid="${item.id}" data-deltype="i"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>`:'';
  return `<div class="i-card" id="icard-${item.id}" style="animation-delay:${idx*40}ms">
    <div class="i-card-inner">
      <div class="vote-col"><button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${item.id}" data-vdir="up" aria-label="Upvote"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button><span class="vote-score ${sc}">${score}</span><button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${item.id}" data-vdir="down" aria-label="Downvote"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button></div>
      <div class="i-content">
        <div class="i-label">Intuition</div>
        <div class="i-statement kr">${processText(item.statement)}</div>
        <div class="i-label">Explanation</div>
        <div class="i-explanation kr" id="iexp-${item.id}">${processText(disp)}</div>
        ${imgHTML}${trunc?`<button class="btn-link" id="iexpbtn-${item.id}">Show more</button>`:''}
        ${linksHTML}${exHTML}
        <div class="i-footer">
          <span>By ${authorLink(item.author)} · ${item.createdAt}${item.edited?' <span style="color:var(--text3);font-size:11px">(edited)</span>':''}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn-report" data-reportid="${item.id}" data-reporttype="intuition"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Report</button>
            ${editBtn}${delBtn}
            <button class="comment-btn" data-cid="${item.id}" data-ctype="i"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${cc} comment${cc!==1?'s':''}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="edit-section" id="edit-i-${item.id}">
      <div class="form-group" style="margin-bottom:10px"><label class="form-label">Statement</label><input class="form-input" id="edit-stmt-${item.id}" value="${esc(item.statement)}" /></div>
      <div class="form-group" style="margin-bottom:4px">
        <div class="preview-toggle"><button class="preview-tab active" id="etab-write-i-${item.id}">Write</button><button class="preview-tab" id="etab-preview-i-${item.id}">Preview</button></div>
        <div class="preview-pane active" id="epane-write-i-${item.id}"><textarea class="form-textarea" id="edit-exp-${item.id}" style="min-height:100px">${esc(item.explanation)}</textarea><div class="edit-word-count" id="edit-wc-i-${item.id}">0 / 2000 words</div></div>
        <div class="preview-pane" id="epane-preview-i-${item.id}"><div class="preview-rendered kr" id="epreview-i-${item.id}"></div></div>
      </div>
      <div class="edit-actions"><button class="btn btn-ghost btn-sm" data-cancelid="${item.id}" data-canceltype="i">Cancel</button><button class="btn btn-primary btn-sm" data-saveid="${item.id}" data-savetype="i">Save</button></div>
    </div>
    <div class="comments-section" id="comments-i-${item.id}">${cHTML}<div class="comment-form"><textarea class="comment-input" id="ctext-i-${item.id}" placeholder="Add a comment…"></textarea><button class="btn btn-primary btn-sm" data-postid="${item.id}" data-posttype="i">Post</button></div></div>
  </div>`;
}

function takeawayCardHTML(item, idx=0) {
  const score=item.upvotes-item.downvotes,vu=takeawayVotes[item.id],sc=score>0?'positive':score<0?'negative':'';
  const content=item.content||'',trunc=content.length>300,disp=trunc?previewText(content):content;
  const linksHTML=(item.links||[]).length?`<div class="i-links">${item.links.filter(safeUrl).map(l=>`<a class="i-link" href="${esc(safeUrl(l))}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join('')}</div>`:'';
  const imgHTML=safeUrl(item.image_url)?`<img src="${esc(safeUrl(item.image_url))}" alt="Takeaway image" style="max-width:100%;border-radius:4px;margin-top:10px;border:1px solid var(--border)" />`:'';
  const cc=(item.comments||[]).length,cHTML=(item.comments||[]).map(c=>`<div class="comment-item"><div class="comment-text">${processText(c.text)}</div><div class="comment-meta">${authorLink(c.author)} · ${c.createdAt}${canDelete(c.authorId)?` <button class="btn-report btn-delete" data-delid="${c.id}" data-deltype="c" data-parent="${item.id}" aria-label="Delete comment">Delete</button>`:''}</div></div>`).join('');
  const isOwn=me&&me.$id===item.author_id;
  const editBtn=isOwn?`<button class="btn-edit" data-editid="${item.id}" data-edittype="t"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`:'';
  const delBtn=canDelete(item.author_id)?`<button class="btn-edit btn-delete" data-delid="${item.id}" data-deltype="t"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>`:'';
  return `<div class="i-card" id="tcard-${item.id}" style="animation-delay:${idx*40}ms">
    <div class="i-card-inner">
      <div class="vote-col"><button class="vote-btn ${vu==='up'?'voted-up':''}" data-vid="${item.id}" data-vdir="up" aria-label="Upvote"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='up'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 11l5-5 5 5M7 17l5-5 5 5"/></svg></button><span class="vote-score ${sc}">${score}</span><button class="vote-btn ${vu==='down'?'voted-down':''}" data-vid="${item.id}" data-vdir="down" aria-label="Downvote"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vu==='down'?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg></button></div>
      <div class="i-content">
        <div class="i-label">Takeaway by ${authorLink(item.author)}</div>
        <div class="i-explanation kr" id="texp-${item.id}">${processText(disp)}</div>
        ${imgHTML}${trunc?`<button class="btn-link" id="texpbtn-${item.id}">Show more</button>`:''}
        ${linksHTML}
        <div class="i-footer">
          <span>${item.createdAt}${item.edited?' <span style="color:var(--text3);font-size:11px">(edited)</span>':''}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn-report" data-reportid="${item.id}" data-reporttype="takeaway"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Report</button>
            ${editBtn}${delBtn}
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

/* ── DELETE (authors delete their own; admins can delete anything) ── */
function canDelete(authorId) { return !!me && (isAdmin || authorId === me.$id); }
function authorLink(name) {
  return name && name !== 'Unknown' && name !== 'You'
    ? `<a class="author-link" href="profile.html?u=${encodeURIComponent(name)}">${esc(name)}</a>` : esc(name);
}
async function deleteRows(table, field, value) {
  try {
    const res = await databases.listDocuments(DB_ID, table, [Query.equal(field, value), Query.limit(500)]);
    for (const d of res.documents) {
      if (isAdmin || rowOwner(d) === me.$id) await databases.deleteDocument(DB_ID, table, d.$id).catch(() => {});
    }
  } catch {}
}
async function deleteItem(id, type, parentId) {
  const what = type === 'c' ? 'comment' : type === 'i' ? 'intuition' : 'takeaway';
  if (!confirm(`Delete this ${what}? This can't be undone.`)) return;
  const qid = selectedQuestion.id;
  try {
    if (type === 'c') {
      await databases.deleteDocument(DB_ID, COLLECTIONS.comments, id);
      const list = [...(intuitions[qid] || []), ...(takeaways[qid] || [])];
      const parent = list.find(x => x.id === parentId);
      if (parent) parent.comments = parent.comments.filter(c => c.id !== id);
    } else {
      await deleteRows(COLLECTIONS.links, 'parent_id', id);
      await deleteRows(COLLECTIONS.comments, 'parent_id', id);
      await databases.deleteDocument(DB_ID, type === 'i' ? COLLECTIONS.intuitions : COLLECTIONS.takeaways, id);
      if (type === 'i') intuitions[qid] = (intuitions[qid] || []).filter(x => x.id !== id);
      else takeaways[qid] = (takeaways[qid] || []).filter(x => x.id !== id);
    }
    showToast(`${what[0].toUpperCase() + what.slice(1)} deleted.`, 'success');
    renderDetailItems();
    if (type !== 'c') renderDetailHeader();
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

/* ── DELEGATED CLICKS (expand, comment, edit, delete, save) ────── */
document.addEventListener('click', e => {
  const expBtn = e.target.closest('[id^="iexpbtn-"],[id^="texpbtn-"]');
  if (expBtn) { const m=expBtn.id.match(/^([it])expbtn-(.+)$/); if(m) toggleExpand(m[2],m[1]); return; }

  const cBtn = e.target.closest('.comment-btn[data-cid]');
  if (cBtn) { toggleComments(cBtn.dataset.cid, cBtn.dataset.ctype); return; }

  const delBtn = e.target.closest('button[data-delid]');
  if (delBtn) { deleteItem(delBtn.dataset.delid, delBtn.dataset.deltype, delBtn.dataset.parent); return; }

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
          const updateWC=()=>{ const c=ta.value.trim().split(/\s+/).filter(Boolean).length; wc.textContent=`${c} / 2000 words`; wc.classList.toggle('over',c>2000); };
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
  if (el) { el.innerHTML=processText(ex?content:previewText(content)); renderMath(el); }
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
  try {
    if (type==='i') {
      const stmt=document.getElementById(`edit-stmt-${id}`)?.value.trim();
      const exp =document.getElementById(`edit-exp-${id}`)?.value.trim();
      if (!stmt||!exp) { showToast('Statement and explanation cannot be empty.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
      if (exp.split(/\s+/).filter(Boolean).length>2000) { showToast('Explanation exceeds 2000 words.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
      await databases.updateDocument(DB_ID, COLLECTIONS.intuitions, id, { statement:stmt, explanation:exp });
      const item=(intuitions[selectedQuestion.id]||[]).find(x=>x.id===id);
      if (item) { item.statement=stmt; item.explanation=exp; item.edited=true; }
    } else {
      const content=document.getElementById(`edit-tak-${id}`)?.value.trim();
      if (!content) { showToast('Takeaway cannot be empty.','error'); if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
      await databases.updateDocument(DB_ID, COLLECTIONS.takeaways, id, { content });
      const item=(takeaways[selectedQuestion.id]||[]).find(x=>x.id===id);
      if (item) { item.content=content; item.edited=true; }
    }
    showToast('Saved!','success'); renderDetailItems();
  } catch(e) {
    showToast('Save failed: '+e.message,'error');
    if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';}
  }
}

async function addComment(id, type) {
  if (!me) { openAuthModal(); return; }
  const el=document.getElementById(`ctext-${type}-${id}`), text=el?.value.trim(); if (!text) return;
  if (text.length > COMMENT_MAX) { showToast(`Comments can be at most ${COMMENT_MAX} characters.`,'error'); return; }
  if (!throttle('comment')) return;
  const list=type==='i'?(intuitions[selectedQuestion.id]||[]):(takeaways[selectedQuestion.id]||[]);
  const item=list.find(x=>x.id===id);
  try {
    const d = await databases.createDocument(DB_ID, COLLECTIONS.comments, ID.unique(), {
      parent_id: id,
      parent_type: type === 'i' ? 'intuition' : 'takeaway',
      text,
      author_id: me.$id
    }, mine());
    if (item) item.comments.push({ id:d.$id, text, author:profile?.username||'You', authorId:me.$id, createdAt:'just now' });
  } catch(e) { showToast('Comment failed: '+e.message,'error'); return; }
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
    if (next === null) {
      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.votes, [
        Query.equal('user_id', me.$id), Query.equal('target_id', id),
        Query.equal('target_type', ttype), Query.limit(1)
      ]);
      if (existing.documents.length)
        await databases.deleteDocument(DB_ID, COLLECTIONS.votes, existing.documents[0].$id);
    } else if (cur === null) {
      await databases.createDocument(DB_ID, COLLECTIONS.votes, ID.unique(), {
        user_id: me.$id, target_id: id, target_type: ttype, direction: next
      }, mine());
    } else {
      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.votes, [
        Query.equal('user_id', me.$id), Query.equal('target_id', id),
        Query.equal('target_type', ttype), Query.limit(1)
      ]);
      if (existing.documents.length)
        await databases.updateDocument(DB_ID, COLLECTIONS.votes, existing.documents[0].$id, { direction: next });
    }
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
    <div class="form-group"><label class="form-label" for="pf-statement">Intuition Statement</label><input class="form-input" id="pf-statement" placeholder="e.g. It factors because of a common root" ${!li?'disabled':''} /></div>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><label class="form-label" style="margin:0">Explanation</label><span id="wordCount" class="word-count">0 / 2000 words</span></div>
      <div class="preview-toggle"><button class="preview-tab active" id="intExpWriteTab">Write</button><button class="preview-tab" id="intExpPreviewTab">Preview</button></div>
      <div class="preview-pane active" id="intExpWritePane"><textarea class="form-textarea" id="pf-explanation" style="min-height:120px" ${!li?'disabled':''} placeholder="Explain your intuition… ($LaTeX$ and ||spoiler|| supported)"></textarea></div>
      <div class="preview-pane" id="intExpPreviewPane"><div class="preview-rendered kr" id="intExpPreviewContent" style="min-height:120px"></div></div>
    </div>
    <div class="form-group"><label class="form-label" for="pf-intImage">Add Image (optional)</label>
      <input type="file" id="pf-intImage" accept="image/*" style="color:var(--text2);font-size:13px" ${!li?'disabled':''} />
      <div class="img-preview-box" id="pf-intImagePreviewBox" style="display:none"><img id="pf-intImagePreview" src="" alt="Preview" /><button class="img-preview-remove" aria-label="Remove image" id="pf-intImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    </div>
    <div class="form-group"><label class="form-label">Links (optional, max 3)</label><div class="link-input-row"><input class="form-input" id="pf-link" placeholder="https://…" style="flex:1" ${!li?'disabled':''} /><button class="btn btn-ghost btn-sm" id="pf-addlink" ${!li?'disabled':''}>Add</button></div><div class="link-list" id="int-links"></div></div>
    <hr class="form-divider"/>
    <div class="form-group"><label class="form-label" for="pf-exampleLink">Problem Link (optional)</label><input class="form-input" id="pf-exampleLink" placeholder="https://…" ${!li?'disabled':''} /></div>
    <div class="form-group"><label class="form-label" for="pf-exampleExp">Additional Context (optional)</label><textarea class="form-textarea" id="pf-exampleExp" style="min-height:70px" ${!li?'disabled':''}></textarea></div>
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
    <div class="form-group"><label class="form-label" for="pf-takImage">Add Image (optional)</label>
      <input type="file" id="pf-takImage" accept="image/*" style="color:var(--text2);font-size:13px" ${!li?'disabled':''} />
      <div class="img-preview-box" id="pf-takImagePreviewBox" style="display:none"><img id="pf-takImagePreview" src="" alt="Preview" /><button class="img-preview-remove" aria-label="Remove image" id="pf-takImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    </div>
    <div class="form-group"><label class="form-label">Links (optional)</label><div class="link-input-row"><input class="form-input" id="pf-taklink" placeholder="https://…" style="flex:1" ${!li?'disabled':''} /><button class="btn btn-ghost btn-sm" id="pf-addtaklink" ${!li?'disabled':''}>Add</button></div><div class="link-list" id="tak-links"></div></div>
    <button class="btn btn-primary" id="pf-submitTak" ${!li?'disabled':''}>Post Takeaway</button>
  </div>`;
}

function updateWordCount() {
  const el=document.getElementById('pf-explanation'), wc=document.getElementById('wordCount');
  if (!el||!wc) return;
  const c=el.value.trim().split(/\s+/).filter(Boolean).length;
  wc.textContent=`${c} / 2000 words`; wc.classList.toggle('over',c>2000);
  const btn=document.getElementById('pf-submitInt');
  if (btn) btn.disabled=c>2000||!formState.statement.trim()||!formState.explanation.trim();
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
  c.innerHTML=links.map((l,i)=>`<div class="link-item"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a><button class="remove-link-btn" aria-label="Remove link" onclick="${fn}(${i})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
}

async function submitIntuition() {
  if (!me) { openAuthModal(); return; }
  if (!throttle('post')) return;
  let imageUrl=null;
  if (formState.intImageFile) { try { imageUrl=await uploadImage(formState.intImageFile); } catch(e) { showToast('Image upload failed: '+e.message,'error'); return; } }
  const stmt=document.getElementById('pf-statement')?.value.trim();
  const exp =document.getElementById('pf-explanation')?.value.trim();
  if (!stmt||!exp) { showToast('Please fill in both the statement and explanation.','error'); return; }
  if (exp.split(/\s+/).filter(Boolean).length>2000) { showToast('Explanation exceeds 2000 words.','error'); return; }
  const btn=document.getElementById('pf-submitInt');
  btn.disabled=true; btn.textContent='Posting…';
  const exLink=document.getElementById('pf-exampleLink')?.value.trim()||null;
  const exExp =document.getElementById('pf-exampleExp')?.value.trim()||null;
  try {
    const d = await databases.createDocument(DB_ID, COLLECTIONS.intuitions, ID.unique(), {
      question_id: selectedQuestion.id, statement: stmt, explanation: exp,
      example_link: exLink, example_explanation: exExp,
      author_id: me.$id, image_url: imageUrl
    }, mine());
    if (formState.explanationLinks.length) {
      for (const url of formState.explanationLinks) {
        await databases.createDocument(DB_ID, COLLECTIONS.links, ID.unique(), {
          parent_id: d.$id, parent_type: 'intuition', url
        }, mine());
      }
    }
    Object.assign(formState,{ statement:'', explanation:'', explanationLinks:[], exampleLink:'', exampleExplanation:'', intImageFile:null });
    showToast('Intuition posted!','success');
    await loadDetailItems(selectedQuestion.id);
    renderDetailItems(); renderPostForm();
    window.scrollTo({ top:document.getElementById('dtab-intuitions').offsetTop-80, behavior:'smooth' });
  } catch(e) {
    showToast('Error posting: '+e.message,'error');
    btn.disabled=false; btn.textContent='Post Intuition';
  }
}

async function submitTakeaway() {
  if (!me) { openAuthModal(); return; }
  if (!throttle('post')) return;
  let imageUrl=null;
  if (formState.takImageFile) { try { imageUrl=await uploadImage(formState.takImageFile); } catch(e) { showToast('Image upload failed: '+e.message,'error'); return; } }
  const content=document.getElementById('pf-takeaway')?.value.trim();
  if (!content) { showToast('Please write your takeaway.','error'); return; }
  const btn=document.getElementById('pf-submitTak');
  btn.disabled=true; btn.textContent='Posting…';
  try {
    const d = await databases.createDocument(DB_ID, COLLECTIONS.takeaways, ID.unique(), {
      question_id: selectedQuestion.id, content, image_url: imageUrl, author_id: me.$id
    }, mine());
    if (formState.takeawayLinks.length) {
      for (const url of formState.takeawayLinks) {
        await databases.createDocument(DB_ID, COLLECTIONS.links, ID.unique(), {
          parent_id: d.$id, parent_type: 'takeaway', url
        }, mine());
      }
    }
    Object.assign(formState,{ takeawayContent:'', takeawayLinks:[], takImageFile:null });
    showToast('Takeaway posted!','success');
    await loadDetailItems(selectedQuestion.id);
    renderDetailItems(); renderPostForm();
    window.scrollTo({ top:document.getElementById('dtab-takeaways').offsetTop-80, behavior:'smooth' });
  } catch(e) {
    showToast('Error posting: '+e.message,'error');
    btn.disabled=false; btn.textContent='Post Takeaway';
  }
}