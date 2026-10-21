  (function () {
    /* ── 0. Skeletons: grey placeholders shaped like the real content (also used by mint-shared.js) ── */
    function bar(w, h, extra) { return '<span class="skel" style="width:' + w + ';height:' + h + 'px;' + (extra || '') + '"></span>'; }
    const TITLE_W = ['58%', '72%', '46%', '64%', '52%'];
    window.listSkeleton = function (n) {          // rows in a topic's question list
      let out = '';
      for (let i = 0; i < n; i++) {
        out += '<div class="question-card skel-card" aria-hidden="true"><div class="vote-col">'
          + bar('14px', 10) + bar('18px', 16) + bar('14px', 10) + bar('22px', 10, 'margin-top:6px') + '</div>'
          + '<div class="card-content">' + bar(TITLE_W[i % 5], 17, 'margin-bottom:10px') + bar('85%', 11, 'margin-bottom:12px')
          + '<span class="skel-tags">' + bar('90px', 20) + bar('70px', 20) + '</span>'
          + '<div style="display:flex;justify-content:space-between;margin-top:12px">' + bar('60px', 10) + bar('50px', 10) + '</div></div></div>';
      }
      return out;
    };
    window.postVoteSkeleton = function () {
      return bar('20px', 20) + bar('22px', 18) + bar('20px', 20) + bar('16px', 30, 'margin-top:8px');
    };
    window.postContentSkeleton = function () {      // the question at the top of a post
      return bar('70%', 26, 'margin-bottom:14px') + bar('95%', 12, 'margin-bottom:8px') + bar('60%', 12, 'margin-bottom:16px')
        + '<span class="skel-tags">' + bar('90px', 20) + bar('110px', 20) + bar('70px', 20) + '</span>' + bar('80px', 10, 'margin-top:14px');
    };
    window.itemSkeleton = function (n) {            // intuition / takeaway cards
      let out = '';
      for (let i = 0; i < n; i++) {
        out += '<div class="i-card skel-card" aria-hidden="true"><div class="i-card-inner"><div class="vote-col">'
          + bar('16px', 16) + bar('18px', 14) + bar('16px', 16) + '</div><div class="i-content">'
          + bar('60px', 10, 'margin-bottom:8px') + bar(TITLE_W[(i + 1) % 5], 17, 'margin-bottom:16px')
          + bar('70px', 10, 'margin-bottom:8px') + bar('100%', 11, 'margin-bottom:7px') + bar('92%', 11, 'margin-bottom:7px') + bar('55%', 11)
          + '<div class="i-footer">' + bar('140px', 10) + bar('90px', 10) + '</div></div></div></div>';
      }
      return out;
    };

    /* ── 1. External CSS & fonts ─────────────────────────── */
    const head = document.head;

    function addLink(rel, href, extra) {
      const el = document.createElement('link');
      el.rel = rel; el.href = href;
      if (extra) Object.assign(el, extra);
      head.appendChild(el);
    }

    addLink('preconnect', 'https://fonts.googleapis.com');
    addLink('preconnect', 'https://fonts.gstatic.com', { crossOrigin: '' });
    addLink('stylesheet', 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600&family=Roboto+Slab:wght@400;700;900&display=swap');
    addLink('stylesheet', 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css', { integrity: 'sha384-n8MVd4RsNIU0tAv4ct0nTaAbDJwPJzDEaqSD1odI+WdtXRGWt2kTvGFasHpSy3SV', crossOrigin: 'anonymous' });
    addLink('icon',       'logo.svg', { type: 'image/svg+xml' });

    /* ── 2. Shared HTML body ─────────────────────────────── */
    /* Same icon colours as the subject cards on the home page */
    const TOPIC_COLORS = {
      'Algebra': 'var(--blue)', 'Combinatorics': 'var(--purple)', 'Geometry': 'var(--primary)',
      'Number Theory': 'var(--gold)', 'Problem Solving': 'var(--orange)',
    };
    document.addEventListener('DOMContentLoaded', function () {
      /* Opening a post from a link: show the post's skeleton, not the list's */
      const openingPost = new URLSearchParams(location.search).has('q');
      document.body.innerHTML = `

  <header>
    <div class="header-inner">
      <a class="logo" href="index.html">
        <svg class="logo-mark-svg" width="38" height="38" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
          <defs><clipPath id="clipTriangle"><polygon points="250,30 475,420 25,420"/></clipPath></defs>
          <g clip-path="url(#clipTriangle)">
            <polygon points="250,30 475,420 25,420" fill="#7ec7b4"/>
            <polygon points="250,30 362,225 250,160 138,225" fill="#9fd8c8"/>
            <polygon points="25,420 138,225 250,420" fill="#8ccbb9"/>
            <polygon points="475,420 362,225 250,420" fill="#6fb3a3"/>
            <polygon points="250,160 362,225 250,290 138,225" fill="#c9efe3"/>
            <polygon points="138,225 250,290 250,420 138,355" fill="#8fd0b6"/>
            <polygon points="362,225 250,290 250,420 362,355" fill="#76bca8"/>
            <polygon points="25,420 138,355 250,420" fill="#5aa094"/>
            <polygon points="475,420 362,355 250,420" fill="#4f9186"/>
          </g>
        </svg>
        <div class="logo-text">
          <span class="logo-name">MINT</span>
          <span class="logo-tagline">Math Olympiad Intuition</span>
        </div>
      </a>
      <div class="header-right">
        <button class="theme-btn" id="themeBtn" title="Switch theme" aria-label="Switch light or dark theme">
          <svg id="iconDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg id="iconLight" class="hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </button>
        <div class="user-pill hidden" id="userPill"><span class="user-pill-dot"></span><span id="pillName"></span></div>
        <button class="btn btn-ghost btn-sm" id="authBtn">Log in</button>
        <div class="post-dropdown-wrap" id="postDropdownWrap">
          <button class="btn-post-main" id="postDropdownBtn" aria-haspopup="true" aria-expanded="false">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Post
            <span class="btn-post-chevron"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>
          </button>
          <div class="post-dropdown-menu" id="postDropdownMenu">
            <button class="post-menu-item" id="menuPostIntuition">
              <span><div class="post-menu-label">Post an Intuition</div><div class="post-menu-sub">Attach your insight to any topic</div></span>
            </button>
            <button class="post-menu-item" id="menuPostTakeaway">
              <span><div class="post-menu-label">Post a Takeaway</div><div class="post-menu-sub">Share what you learned</div></span>
            </button>
            <button class="post-menu-item" id="menuPostSubtopic">
              <span><div class="post-menu-label">Post a Topic</div><div class="post-menu-sub">Investigate a new topic</div></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- LIST VIEW -->
  <main id="listView"${openingPost ? ' style="display:none"' : ''}>
    <div class="breadcrumb"><a href="index.html">Home</a><span>›</span><span>${window.TOPIC_NAME}</span></div>
    <div class="topic-header">
      <div class="topic-left">
        <span class="topic-glyph" style="color:${TOPIC_COLORS[window.TOPIC_NAME] || 'var(--blue)'}">${window.TOPIC_GLYPH}</span>
        <div><div class="topic-name">${window.TOPIC_NAME}</div><div class="topic-desc"></div></div>
      </div>
    </div>
    <div class="topic-layout">
      <div class="sidebar"><div class="sidebar-title">Topics</div><div id="subtopicList"></div></div>
      <div>
        <div class="toolbar">
          <div class="search-wrap">
            <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="search-input" id="questionSearch" type="text" placeholder="Search topics, and tags" autocomplete="off" autocorrect="off" spellcheck="false" />
            <button class="search-clear hidden" id="searchClear" aria-label="Clear search"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="tabs-list">
            <button class="tab-btn active" data-sort="relevance">Relevance</button>
            <button class="tab-btn" data-sort="recent">Recent</button>
            <button class="tab-btn" data-sort="top">Top</button>
          </div>
        </div>
        <div class="results-meta"><div class="q-count" id="qCount"></div><div id="activeFilterPill"></div></div>
        <div id="questionsList">${listSkeleton(5)}</div>
      </div>
    </div>
  </main>

  <!-- DETAIL VIEW -->
  <main id="detailView" style="display:${openingPost ? 'block' : 'none'}">
    <button class="back-btn" id="backBtn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      Back to Topics
    </button>
    <div class="detail-card">
      <div class="detail-card-inner">
        <div class="vote-col" id="detailVoteCol">${openingPost ? postVoteSkeleton() : ''}</div>
        <div class="detail-content" id="detailContent">${openingPost ? postContentSkeleton() : ''}</div>
      </div>
    </div>
    <div class="sort-bar">
      <div class="tabs-list">
        <button class="tab-btn active" data-dtab="intuitions">Intuitions (<span id="intCount">0</span>)</button>
        <button class="tab-btn" data-dtab="takeaways">Takeaways (<span id="takCount">0</span>)</button>
      </div>
      <div class="sort-btns">
        <button class="sort-btn active" data-dsort="relevance">Relevance</button>
        <button class="sort-btn" data-dsort="top">Top</button>
        <button class="sort-btn" data-dsort="recent">Recent</button>
      </div>
    </div>
    <div id="dtab-intuitions" class="tab-content active">${openingPost ? itemSkeleton(2) : ''}</div>
    <div id="dtab-takeaways" class="tab-content"></div>
    <div id="postForm"></div>
  </main>

  <!-- POST INTUITION MODAL -->
  <div class="modal-overlay" id="postIntModal">
    <div class="modal" style="max-width:600px">
      <div class="modal-title">Post an Intuition</div>
      <div class="modal-sub">Attach your intuition to one or more topics</div>
      <div id="postIntError"></div>
      <div class="form-group">
        <label class="form-label">Attach to Topic(s)</label>
        <div class="q-search-wrap" style="position:relative;margin-bottom:0">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="q-search-input" id="intQSearch" placeholder="Type to search topics…" autocomplete="off" />
          <div class="q-picker-list" id="intQList" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:50;display:none;max-height:200px;overflow-y:auto"></div>
        </div>
        <div class="q-selected-chips" id="intQChips" style="margin-top:8px"></div>
      </div>
      <div class="form-group"><label class="form-label" for="intStatement">Intuition Statement</label><input class="form-input" id="intStatement" placeholder="e.g. Primes become increasingly sparse" /></div>
      <div class="form-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label class="form-label" style="margin:0">Explanation</label>
          <span id="intWordCount" class="word-count">0 / 2000 words</span>
        </div>
        <div class="preview-toggle">
          <button class="preview-tab active" id="intExpWriteTabModal">Write</button>
          <button class="preview-tab" id="intExpPreviewTabModal">Preview</button>
        </div>
        <div class="preview-pane active" id="intExpWritePaneModal">
          <textarea class="form-textarea" id="intExplanation" style="min-height:120px" placeholder="Explain your intuition… ($LaTeX$ and ||spoiler|| supported)"></textarea>
        </div>
        <div class="preview-pane" id="intExpPreviewPaneModal">
          <div class="preview-rendered kr" id="intExpPreviewContentModal" style="min-height:120px"></div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Links (optional, max 3)</label><div class="link-input-row"><input class="form-input" id="intLinkInput" placeholder="https://…" style="flex:1" /><button class="btn btn-ghost btn-sm" id="intAddLink">Add</button></div><div class="link-list" id="intLinkList"></div></div>
      <div class="form-group"><label class="form-label" for="intImage">Add Image (optional)</label>
        <input type="file" id="intImage" accept="image/*" style="color:var(--text2);font-size:13px" />
        <div class="img-preview-box" id="intImagePreviewBox" style="display:none"><img id="intImagePreview" src="" alt="Preview" /><button class="img-preview-remove" aria-label="Remove image" id="intImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      </div>
      <hr class="form-divider"/>
      <div class="form-group"><label class="form-label" for="intExampleLink">Problems (optional)</label><input class="form-input" id="intExampleLink" placeholder="https://…" /></div>
      <div class="form-group"><label class="form-label" for="intExampleExp">Additional Context (optional)</label><textarea class="form-textarea" id="intExampleExp" style="min-height:70px"></textarea></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="postIntCancelBtn">Cancel</button><button class="btn btn-primary" id="postIntSubmitBtn">Post Intuition</button></div>
    </div>
  </div>

  <!-- POST TAKEAWAY MODAL -->
  <div class="modal-overlay" id="postTakModal">
    <div class="modal" style="max-width:600px">
      <div class="modal-title">Post a Takeaway</div>
      <div class="modal-sub">Share what you learned across one or more topics</div>
      <div id="postTakError"></div>
      <div class="form-group">
        <label class="form-label">Attach to Topic(s)</label>
        <div class="q-search-wrap" style="position:relative;margin-bottom:0">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="q-search-input" id="takQSearch" placeholder="Type to search topics…" autocomplete="off" />
          <div class="q-picker-list" id="takQList" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:50;display:none;max-height:200px;overflow-y:auto"></div>
        </div>
        <div class="q-selected-chips" id="takQChips" style="margin-top:8px"></div>
      </div>
      <div class="form-group"><label class="form-label">Your Takeaway</label>
        <div class="preview-toggle"><button class="preview-tab active" id="takExpWriteTabModal">Write</button><button class="preview-tab" id="takExpPreviewTabModal">Preview</button></div>
        <div class="preview-pane active" id="takExpWritePaneModal"><textarea class="form-textarea" id="takContent" style="min-height:130px" placeholder="Share your insights… ($LaTeX$ and ||spoiler|| supported)"></textarea></div>
        <div class="preview-pane" id="takExpPreviewPaneModal"><div class="preview-rendered kr" id="takExpPreviewContentModal" style="min-height:130px"></div></div>
      </div>
      <div class="form-group"><label class="form-label" for="takImage">Add Image (optional)</label>
        <input type="file" id="takImage" accept="image/*" style="color:var(--text2);font-size:13px" />
        <div class="img-preview-box" id="takImagePreviewBox" style="display:none"><img id="takImagePreview" src="" alt="Preview" /><button class="img-preview-remove" aria-label="Remove image" id="takImageRemove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      </div>
      <div class="form-group"><label class="form-label">Links (optional)</label><div class="link-input-row"><input class="form-input" id="takLinkInput" placeholder="https://…" style="flex:1" /><button class="btn btn-ghost btn-sm" id="takAddLink">Add</button></div><div class="link-list" id="takLinkList"></div></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="postTakCancelBtn">Cancel</button><button class="btn btn-primary" id="postTakSubmitBtn">Post Takeaway</button></div>
    </div>
  </div>

  <!-- POST TOPIC MODAL -->
  <div class="modal-overlay" id="postSubModal">
    <div class="modal" style="max-width:600px">
      <div class="modal-title">Investigate a new Topic</div>
      <div class="modal-sub">Add a new topic that others can post intuitions and takeaways under</div>
      <div id="postSubError"></div>
      <div class="form-group">
        <label class="form-label">Topics <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">(select one or more)</span></label>
        <div class="topic-picker-grid" id="topicPickerGrid"></div>
        <div id="subTopicChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px"></div>
      </div>
      <div id="newQSscWrap" style="display:none">
        <div class="form-group">
          <label class="form-label">Tags <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">(optional)</span></label>
          <div class="ssc-accordion" id="sscAccordion"></div>
          <div id="newQSelectedTags" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px"></div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Topic Title</label>
        <div class="preview-toggle"><button class="preview-tab active" id="qTitleWriteTab">Write</button><button class="preview-tab" id="qTitlePreviewTab">Preview</button></div>
        <div class="preview-pane active" id="qTitleWritePane"><input class="form-input" id="newQTitle" placeholder="e.g. Find all $f: \\mathbb{R} \\to \\mathbb{R}$ such that…" /></div>
        <div class="preview-pane" id="qTitlePreviewPane"><div class="preview-rendered kr" id="qTitlePreviewContent" style="min-height:44px"></div></div>
      </div>
      <div class="form-group"><label class="form-label">About <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">(brief description)</span></label>
        <div class="preview-toggle"><button class="preview-tab active" id="qAboutWriteTab">Write</button><button class="preview-tab" id="qAboutPreviewTab">Preview</button></div>
        <div class="preview-pane active" id="qAboutWritePane"><textarea class="form-textarea" id="newQAbout" style="min-height:70px" placeholder="What is this topic about?"></textarea></div>
        <div class="preview-pane" id="qAboutPreviewPane"><div class="preview-rendered kr" id="qAboutPreviewContent"></div></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" id="postSubCancelBtn">Cancel</button><button class="btn btn-primary" id="postSubSubmitBtn">Post Topic</button></div>
    </div>
  </div>

  <!-- AUTH MODAL -->
  <div class="modal-overlay" id="authOverlay">
    <div class="modal" style="max-width:420px">
      <div class="modal-title">Welcome to MINT</div>
      <div class="modal-sub">Sign in to post topics, share intuitions, and vote</div>
      <button class="btn-google-modal" id="googleSignInBtn">
        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Continue with Google
      </button>
      <div class="divider">or continue with email</div>
      <div class="auth-tabs"><button class="auth-tab active" id="loginTab">Log in</button><button class="auth-tab" id="signupTab">Sign up</button></div>
      <div class="auth-msg err" id="authErr"></div>
      <div class="auth-msg ok" id="authOk"></div>
      <div class="form-group" id="identWrap"><label class="form-label" for="authIdent">Email or Username</label><input class="form-input" id="authIdent" type="text" placeholder="you@example.com or username" autocomplete="username" /></div>
      <div class="form-group hidden" id="emailWrap"><label class="form-label" for="authEmail">Email</label><input class="form-input" id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
      <div class="form-group hidden" id="userWrap"><label class="form-label" for="authUser">Username</label><input class="form-input" id="authUser" type="text" placeholder="your_username" autocomplete="username" /></div>
      <div class="form-group" id="passWrap"><label class="form-label" for="authPass">Password</label><input class="form-input" id="authPass" type="password" placeholder="••••••••" autocomplete="current-password" /><button type="button" class="btn-link forgot-link" id="forgotLink">Forgot password?</button></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="authCancelBtn">Cancel</button><button class="btn btn-primary" id="authSubmitBtn">Log in</button></div>
    </div>
  </div>

  <footer>
    <p>Report issues, make suggestions, or join the team by contacting
      <a href="mailto:mint.forum.contact@gmail.com">mint.forum.contact@gmail.com</a>
    </p>
  </footer>`;

      /* Show the layout straight away; lists show skeletons until data arrives */
      document.body.classList.add('ready');

      /* ── 3. Load external scripts in order ─────────────── */
      function loadScript(src, onload, onerror, integrity) {
        const s = document.createElement('script');
        s.src = src;
        if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
        if (onload) s.onload = onload;
        if (onerror) s.onerror = onerror;
        document.body.appendChild(s);
      }

      /* Never leave the page stuck behind the loader */
      function showLoadError() {
        const list = document.getElementById('questionsList');
        if (list) list.innerHTML = '<div class="err-box">Could not reach the server. Check your connection and refresh.</div>';
        document.body.classList.add('ready');
      }
      setTimeout(function () {
        if (!document.body.classList.contains('ready')) document.body.classList.add('ready');
      }, 10000);

      function loadSharedScripts() {
        loadScript('mint-auth.js', function () { loadScript('mint-shared.js', null, showLoadError); }, showLoadError);
      }

      /* Math rendering is optional: boot without it if KaTeX fails */
      function katexDone() { if (window.onKatexReady) window.onKatexReady(); }

      loadScript('https://cdn.jsdelivr.net/npm/appwrite@16.1.0', function () {
        loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js', function () {
          loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js', katexDone, function () {
            window._katexFailed = true; katexDone();
          }, 'sha384-+VBxd3r6XgURycqtZ117nYw44OOcIax56Z4dCRWbxyPt0Koah1uHoK0o4+/RRE05');
          loadSharedScripts();
        }, function () {
          window._katexFailed = true;
          loadSharedScripts();
        }, 'sha384-XjKyOOlGwcjNTAIQHIpgOno0Hl1YQqzUOEleOLALmuqehneUG+vnGctmUb0ZY0l8');
      }, showLoadError, 'sha384-2SlRm45+3L4tLlQD0d0MZ0SZb9sJIHAnO3IPJifBX5gEg7m8fdj/GBUXVClL8DKq');
    });
  })();