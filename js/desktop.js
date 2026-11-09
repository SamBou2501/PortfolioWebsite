/* ---------------------------------------------------------------------------
 * Desktop runtime: window manager + draggable desktop icons.
 *
 * Two layouts, switched live by the PHONE media query (also in style.css):
 *
 * Desktop (everything else)
 * - Clicking an app icon opens a draggable window with theme-colored chrome.
 * - Title bar has Win11-style minimise / maximise / close.
 * - Desktop icons themselves are draggable around the desktop surface
 *   (drag = move, click without drag = open the app).
 * - Taskbar: left-click open/focus/minimise (Win11 toggle), right-click
 *   context menu, Start = show desktop, .is-open class on open apps.
 *
 * Phone / small tablet / sideways phone (<= 900px wide or <= 500px tall)
 * - Scrolling home page of app tiles; the taskbar becomes a bottom tab bar.
 * - Apps open one at a time, full screen, like pages. Opening an app adds a
 *   history entry, so the phone's back button returns to the home page
 *   instead of leaving the site.
 *
 * Both: pointer events (mouse + touch + pen), Escape closes the top window,
 * focus moves into a window on open and back to its opener on close.
 * No persistence — refresh resets icon positions and closes all windows.
 * Content: each app and case study is its own page file (about/index.html,
 * games/ordinem/index.html); windows fetch those pages. See "Pages and paths".
 * ------------------------------------------------------------------------- */

(() => {
  // -- App registry ---------------------------------------------------------

  // Window sizing is viewport-relative, not fixed pixel sizes — every app
  // opens at OPEN_FRAC of the viewport, the maximise button takes it to
  // 100%, and the restore button (only visible when maximised) drops it to
  // SMALL_FRAC. See createWindow() / toggleMaximise().
  const APPS = {
    about:      { title: "About Me"   },
    games:      { title: "Projects"   },
    blogs:      { title: "Blogs", disabled: true }, // greyed out until real posts exist
    experience: { title: "Experience" },
    links:      { title: "Links"      },
    contacts:   { title: "Contacts"   },
  };

  const OPEN_FRAC  = 0.85; // default size on open
  const SMALL_FRAC = 0.60; // size after clicking restore from maximised

  const DRAG_THRESHOLD = 4; // px before a pointerdown counts as a drag

  // Phones, small tablets, and any screen under 500px tall (phones held
  // sideways). Must match the phone breakpoint in style.css.
  const PHONE = window.matchMedia("(max-width: 900px), (max-height: 500px)");
  const isPhone = () => PHONE.matches;

  // -- Window manager state -------------------------------------------------

  const openWindows = new Map(); // appId -> windowEl
  let zCounter = 100;
  let windowsLayer;

  function focusWindow(win) {
    win.style.zIndex = String(++zCounter);
  }

  // -- Pages and paths -------------------------------------------------------

  // Every app and case study is its own page file (about/index.html,
  // games/ordinem/index.html, …) so search engines and link previews see
  // it. The desktop fetches those pages and shows their <article> in a
  // window. Paths are relative to the site root: "" is home, "games/",
  // "games/ordinem/". Page files carry <base href> pointing at the root, so
  // relative URLs resolve the same on every page.
  const SITE_ROOT = new URL(document.querySelector("base") ? document.baseURI : "./", location.href).href;
  const pathOf = (url) => {
    const u = url.split(/[?#]/)[0];
    return u.startsWith(SITE_ROOT) ? u.slice(SITE_ROOT.length).replace(/index\.html$/, "") : null;
  };
  const here = () => pathOf(location.href) || "";
  const appOf = (path) => path.split("/")[0];

  // Arriving on a page file (from Google, a shared link): build the desktop
  // around it. Its own article is kept so the window doesn't fetch it again.
  const IS_PAGE = document.body.classList.contains("page");
  const startPage = IS_PAGE
    ? { path: here(), article: document.querySelector(".page-main > article"), title: document.title }
    : null;
  if (IS_PAGE) document.documentElement.classList.add("has-shell"); // hide the bare page now
  let homeTitle = IS_PAGE ? "" : document.title;

  // Every history entry the site adds remembers the path it was added from
  // and how many site entries came before it (`depth`), so going back or
  // closing can step back through history instead of piling up duplicate
  // entries the back button then has to wade through.
  // `base` is the path the chain started from ("" = the home page).
  function nextState() {
    const s = history.state;
    return s && s.site
      ? { site: true, from: here(), depth: s.depth + 1, base: s.base }
      : { site: true, from: here(), depth: 1, base: here() };
  }

  // In-app navigation. pushState doesn't fire popstate, so route here.
  function navigate(path) {
    history.pushState(nextState(), "", SITE_ROOT + path);
    route();
  }

  // Take the app out of the URL when its window is closed or minimised. If
  // the site's entries lead straight back to the home page, step back there
  // rather than leaving a duplicate; never step back onto an app's entry,
  // which on desktop would re-open a window the visitor may have closed.
  function clearPathFor(app) {
    if (appOf(here()) !== app) return;
    const s = history.state;
    if (s && s.site && s.base === "") {
      quietHome = true; // this isn't the visitor pressing back: change nothing else
      history.go(-s.depth);
    } else {
      history.replaceState(null, "", SITE_ROOT);
      document.title = homeTitle;
    }
  }
  let quietHome = false;

  // Open an app from the UI (icon, tab, menu). The URL names the page the
  // window is already showing, if any (e.g. reopening a minimised case study).
  function openApp(app) {
    if (!APPS[app] || APPS[app].disabled) return;
    const existing = openWindows.get(app);
    const target = (existing && existing.dataset.page) || app + "/";
    if (here() !== target) navigate(target);
    else route();
  }

  // Show (create, un-minimise, focus) an app's window. Called by route().
  function showApp(app) {
    // Phone: one app at a time, like pages.
    if (isPhone()) {
      openWindows.forEach((w, a) => { if (a !== app) w.classList.add("is-minimised"); });
    }

    let win = openWindows.get(app);
    if (win) {
      win.classList.remove("is-minimised");
    } else {
      win = createWindow(app);
      openWindows.set(app, win);
      windowsLayer.appendChild(win);
    }
    // Remember where focus came from so closing can hand it back.
    const opener = document.activeElement;
    if (opener && opener !== document.body && !win.contains(opener)) win.opener = opener;
    focusWindow(win);
    win.focus({ preventScroll: true });
    updateTaskbarState();
    return win;
  }

  function restoreFocus(win, app) {
    const target = win.opener && win.opener.isConnected && win.opener.offsetParent !== null
      ? win.opener
      : document.querySelector(`.taskbar-app[data-app="${app}"]`);
    if (target) target.focus({ preventScroll: true });
  }

  function closeApp(app) {
    const win = openWindows.get(app);
    if (!win) return;
    win.remove();
    openWindows.delete(app);
    clearPathFor(app);
    updateTaskbarState();
    restoreFocus(win, app);
  }

  function minimiseApp(app) {
    const win = openWindows.get(app);
    if (!win) return;
    win.classList.add("is-minimised");
    clearPathFor(app);
    updateTaskbarState();
    if (win.contains(document.activeElement)) restoreFocus(win, app);
  }

  // Topmost visible window (highest z-index), for Escape-to-close.
  function topWindowApp() {
    let top = null, topZ = -1;
    openWindows.forEach((w, a) => {
      const z = Number(w.style.zIndex) || 0;
      if (!w.classList.contains("is-minimised") && z > topZ) { top = a; topZ = z; }
    });
    return top;
  }

  // Maximise button toggles between fullscreen (100%) and a smaller
  // SMALL_FRAC-sized window. The "open" size of OPEN_FRAC is one-shot —
  // the restore button drops to SMALL_FRAC, not back to OPEN_FRAC, so the
  // toggle is clearly two-state once the user has maximised at least once.
  function toggleMaximise(app) {
    const win = openWindows.get(app);
    if (!win) return;
    const isMax = win.classList.toggle("is-maximised");
    if (!isMax) {
      // Restoring from fullscreen → drop to SMALL_FRAC, centred.
      sizeWindow(win, SMALL_FRAC);
    }
    const maxBtn = win.querySelector(".window-max");
    if (maxBtn) {
      maxBtn.setAttribute("aria-label", isMax ? "Restore" : "Maximise");
    }
  }

  function sizeWindow(win, frac) {
    const layerRect = windowsLayer.getBoundingClientRect();
    const w = Math.round(layerRect.width  * frac);
    const h = Math.round(layerRect.height * frac);
    const x = Math.max(0, Math.round((layerRect.width  - w) / 2));
    const y = Math.max(0, Math.round((layerRect.height - h) / 2));
    win.style.width  = w + "px";
    win.style.height = h + "px";
    win.style.left   = x + "px";
    win.style.top    = y + "px";
  }

  function showDesktop() {
    openWindows.forEach((win) => win.classList.add("is-minimised"));
    const app = appOf(here());
    if (app) clearPathFor(app);
    updateTaskbarState();
  }

  // is-open = window exists (underline persists, even when minimised).
  // is-active = window exists AND is not minimised (background highlight).
  // So multiple visible windows can all carry the highlight; only minimising
  // (or closing) clears it. Also flags <body> while any window is visible so
  // the phone home page stops scrolling underneath it.
  function updateTaskbarState() {
    let anyVisible = false;
    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      const win = openWindows.get(btn.dataset.app);
      const visible = !!win && !win.classList.contains("is-minimised");
      btn.classList.toggle("is-open", !!win);
      btn.classList.toggle("is-active", visible);
      if (visible) {
        btn.setAttribute("aria-current", "page");
        anyVisible = true;
      } else {
        btn.removeAttribute("aria-current");
      }
    });
    document.body.classList.toggle("has-open-window", anyVisible);
    // On phones an open app covers the home page, so take the home page out
    // of the keyboard / screen-reader order too.
    document.querySelector(".desktop").inert = anyVisible && isPhone();
  }

  // -- Window construction --------------------------------------------------

  function createWindow(app) {
    const meta = APPS[app];

    const win = document.createElement("article");
    win.className = "window";
    win.dataset.app = app;
    win.setAttribute("data-theme", app);
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", meta.title);
    win.tabIndex = -1; // focusable so openApp() can move focus into it

    // Apps open at OPEN_FRAC of the viewport (85%) — big enough to read as a
    // real fullscreen app, but with enough margin around the edges that the
    // user clearly sees it as a window over the desktop, not a takeover.
    // Click the maximise button to go true fullscreen (100%); from there the
    // restore button drops to SMALL_FRAC (60%).
    const layerRect = windowsLayer.getBoundingClientRect();
    const cascade = (openWindows.size % 6) * 26;
    const w = Math.round(layerRect.width  * OPEN_FRAC);
    const h = Math.round(layerRect.height * OPEN_FRAC);
    const x = Math.max(0, Math.round((layerRect.width  - w) / 2) + cascade);
    const y = Math.max(0, Math.round((layerRect.height - h) / 2) + cascade);

    win.style.width  = w + "px";
    win.style.height = h + "px";
    win.style.left   = x + "px";
    win.style.top    = y + "px";

    win.innerHTML = `
      <header class="window-titlebar">
        <span class="window-titlebar-icon" aria-hidden="true">${getAppIconSvg(app)}</span>
        <span class="window-titlebar-title">${meta.title}</span>
        <div class="window-titlebar-controls">
          <button class="window-control window-min" type="button" aria-label="Minimise">
            <svg viewBox="0 0 12 12" aria-hidden="true"><line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
          <button class="window-control window-max" type="button" aria-label="Maximise">
            <svg class="icon-maximise" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <svg class="icon-restore" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="4" width="6" height="6" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M 4 4 L 4 2 L 10 2 L 10 8 L 8 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>
          </button>
          <button class="window-control window-close" type="button" aria-label="Close">
            <svg viewBox="0 0 12 12" aria-hidden="true"><line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
      </header>
      <div class="window-body"></div>
    `;

    // Controls
    win.querySelector(".window-close").addEventListener("click", (e) => { e.stopPropagation(); closeApp(app); });
    win.querySelector(".window-min").addEventListener("click",   (e) => { e.stopPropagation(); minimiseApp(app); });
    win.querySelector(".window-max").addEventListener("click",   (e) => { e.stopPropagation(); toggleMaximise(app); });

    // Bring to front on any press inside the window
    win.addEventListener("pointerdown", () => focusWindow(win));

    // Drag via title bar (background area, not buttons)
    makeWindowDraggable(win);

    // Double-click title bar toggles maximise (desktop only — on phones every
    // window is already full screen)
    win.querySelector(".window-titlebar").addEventListener("dblclick", (e) => {
      if (e.target.closest(".window-control") || isPhone()) return;
      toggleMaximise(app);
    });

    return win;
  }

  // Put a page's article into a window and wire its behaviour. Runs each
  // time the window shows a different page.
  function showPage(win, path, page) {
    const body = win.querySelector(".window-body");
    body.replaceChildren(document.importNode(page.article, true));
    body.scrollTop = 0;
    win.dataset.page = path;
    win.dataset.title = page.title || "";
    if (page.title) document.title = page.title;
    wireContent(win);
  }

  function wireContent(win) {
    const app = win.dataset.app;

    // Wire any [data-copy] elements in the body (e.g. the Contacts email
    // button). Click → copy the value to clipboard and say whether it worked:
    // .is-copied flashes "Copied!", and an optional [data-copy-status] line in
    // the same window is updated (it's aria-live, so screen readers hear it).
    win.querySelectorAll("[data-copy]").forEach((el) => {
      el.addEventListener("click", async () => {
        const value = el.dataset.copy;
        let copied = true;
        try { await navigator.clipboard.writeText(value); } catch (_) { copied = false; }
        if (!copied) {
          // Clipboard blocked (old browser, insecure page): select the text
          // so Ctrl+C / long-press copy still works.
          const range = document.createRange();
          range.selectNodeContents(el.querySelector("[data-copy-text]") || el);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.classList.add(copied ? "is-copied" : "is-copy-failed");
        setTimeout(() => el.classList.remove("is-copied", "is-copy-failed"), 1400);
        const status = win.querySelector("[data-copy-status]");
        if (status) {
          status.textContent = copied
            ? "Copied to your clipboard."
            : "Couldn't copy automatically, so the address is selected for you to copy.";
        }
      });
    });

    // In-page "Jump to" buttons on long pages. They scroll the window body
    // directly, since #anchors would scroll the page behind it.
    win.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = win.querySelector(`[data-jump-id="${CSS.escape(btn.dataset.jump)}"]`);
        const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        if (target) target.scrollIntoView({ behavior, block: "start" });
      });
    });

    // Blogs decoration: scatter a small game/design sketch into each <li>
    // alternating left/right margin. Pulls from a fixed pool so new rows
    // added later inherit the same scattered-sketchbook treatment with no
    // markup changes — just append <li>'s and the indexer picks the sketch.
    if (app === "blogs") {
      populateBlogSketches(win);
    }

    // Blogs search bar: filters .blog-entry rows by combined text content
    // (title + meta + preview). Hides the parent <li> so the gap collapses
    // for filtered-out rows. Empty query shows everything.
    const blogSearch = win.querySelector(".blog-search");
    if (blogSearch) {
      const blogEntries = win.querySelectorAll(".blog-list .blog-entry");
      blogSearch.addEventListener("input", () => {
        const q = blogSearch.value.trim().toLowerCase();
        blogEntries.forEach((entry) => {
          const li = entry.closest("li");
          if (!li) return;
          if (q.length === 0) {
            li.hidden = false;
            return;
          }
          li.hidden = !entry.textContent.toLowerCase().includes(q);
        });
      });
    }
  }

  // -- Blog decoration ------------------------------------------------------

  // Pool of small inline-SVG sketches, mixing game-iconography (controller,
  // gameboy, dragon, crystal, heart, card) with design-iconography (iso
  // editor cube, wireframe, flowchart). populateBlogSketches() cycles
  // through these per <li> so the page reads as a scattered sketchbook even
  // as more blog rows are added later.
  //
  // NOTE: books and muffins (used on About Me / Other Hobbies) are
  // deliberately NOT in this pool — they're personal-life iconography that
  // shouldn't bleed into the work-blog visual language.
  const BLOG_SKETCHES = [
    // controller
    `<svg viewBox="0 0 100 70" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <path d="M 10 32 Q 10 14 28 14 Q 46 14 50 18 Q 54 14 72 14 Q 90 14 90 32 L 90 44 Q 90 60 76 60 Q 70 60 64 52 Q 58 48 42 48 Q 34 48 30 52 Q 24 60 18 60 Q 10 60 10 44 Z"/>
      <rect x="20" y="28" width="12" height="4" rx="0.5"/><rect x="24" y="24" width="4" height="12" rx="0.5"/>
      <circle cx="68" cy="22" r="2.4"/><circle cx="76" cy="30" r="2.4"/><circle cx="68" cy="38" r="2.4"/><circle cx="60" cy="30" r="2.4"/>
      <circle cx="40" cy="42" r="3"/><circle cx="56" cy="42" r="3"/>
    </svg>`,
    // iso editor cube
    `<svg viewBox="0 0 110 90" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <path d="M 12 60 L 50 80 L 96 60 L 58 40 Z"/>
      <line x1="32" y1="50" x2="68" y2="70"/><line x1="50" y1="42" x2="80" y2="58"/>
      <path d="M 36 28 L 56 38 L 76 28 L 56 18 Z"/>
      <path d="M 36 28 L 36 40 L 56 50 L 56 38 Z"/>
      <path d="M 76 28 L 76 40 L 56 50 L 56 38 Z"/>
      <line x1="56" y1="18" x2="56" y2="38"/>
      <path d="M 88 6 L 100 12 L 94 18 L 100 22 L 96 28 L 88 22 Z"/>
    </svg>`,
    // card (MTG-ish)
    `<svg viewBox="0 0 70 100" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <rect x="6" y="4" width="58" height="92" rx="3"/>
      <line x1="10" y1="14" x2="60" y2="14"/><line x1="12" y1="11" x2="38" y2="11"/>
      <circle cx="56" cy="9" r="2.6"/>
      <rect x="10" y="18" width="50" height="32"/>
      <path d="M 35 44 Q 30 32 35 24 Q 40 32 35 44 Z"/>
      <path d="M 35 44 Q 22 40 20 28 Q 30 30 35 44 Z"/>
      <path d="M 35 44 Q 48 40 50 28 Q 40 30 35 44 Z"/>
      <line x1="10" y1="56" x2="60" y2="56"/>
      <line x1="12" y1="62" x2="58" y2="62"/><line x1="12" y1="68" x2="56" y2="68"/>
      <line x1="12" y1="74" x2="58" y2="74"/><line x1="12" y1="80" x2="50" y2="80"/>
      <line x1="46" y1="89" x2="58" y2="89"/>
    </svg>`,
    // d20 die (tabletop / MTG)
    `<svg viewBox="0 0 90 90" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <path d="M 45 8 L 80 30 L 72 72 L 18 72 L 10 30 Z"/>
      <path d="M 45 8 L 45 42 L 80 30"/>
      <path d="M 45 42 L 10 30"/>
      <path d="M 45 42 L 18 72"/>
      <path d="M 45 42 L 72 72"/>
      <path d="M 38 24 L 42 32 L 48 24" stroke-width="1.2"/>
      <line x1="38" y1="32" x2="48" y2="32" stroke-width="1.2"/>
    </svg>`,
    // heart (HP)
    `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <path d="M 30 50 C 12 38, 8 24, 18 16 C 24 12, 30 18, 30 22 C 30 18, 36 12, 42 16 C 52 24, 48 38, 30 50 Z"/>
      <path d="M 14 32 L 46 26" stroke-width="2.2"/>
      <circle cx="30" cy="22" r="1.2" fill="currentColor"/>
    </svg>`,
    // wireframe sketch (design)
    `<svg viewBox="0 0 100 80" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <rect x="6" y="6" width="88" height="68" rx="2"/>
      <rect x="12" y="14" width="36" height="22"/>
      <line x1="14" y1="20" x2="44" y2="20"/><line x1="14" y1="26" x2="38" y2="26"/><line x1="14" y1="32" x2="40" y2="32"/>
      <rect x="54" y="14" width="34" height="22"/>
      <circle cx="71" cy="25" r="6"/>
      <line x1="12" y1="44" x2="88" y2="44"/>
      <rect x="12" y="50" width="22" height="18"/>
      <rect x="40" y="50" width="22" height="18"/>
      <rect x="68" y="50" width="22" height="18"/>
    </svg>`,
    // crystal cluster
    `<svg viewBox="0 0 60 80" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <path d="M 30 6 L 18 26 L 24 70 L 36 70 L 42 26 Z"/>
      <line x1="18" y1="26" x2="42" y2="26"/><line x1="30" y1="6" x2="30" y2="70"/>
      <line x1="18" y1="26" x2="30" y2="38"/><line x1="42" y1="26" x2="30" y2="38"/>
      <path d="M 8 46 L 4 60 L 14 70 L 18 56 Z"/>
      <line x1="4" y1="60" x2="18" y2="56"/>
      <path d="M 50 12 L 54 16 M 52 10 L 52 18"/>
    </svg>`,
    // flowchart (design)
    `<svg viewBox="0 0 110 90" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sketch-roughen-light)">
      <rect x="6" y="10" width="28" height="18" rx="1.5"/>
      <rect x="76" y="10" width="28" height="18" rx="1.5"/>
      <rect x="6" y="60" width="28" height="18" rx="1.5"/>
      <rect x="76" y="60" width="28" height="18" rx="1.5"/>
      <path d="M 34 19 L 76 19" stroke-dasharray="3 3"/>
      <path d="M 70 16 L 76 19 L 70 22"/>
      <path d="M 90 28 L 90 60"/><path d="M 87 54 L 90 60 L 93 54"/>
      <path d="M 76 69 L 34 69"/><path d="M 40 66 L 34 69 L 40 72"/>
      <path d="M 20 60 L 20 28"/><path d="M 17 34 L 20 28 L 23 34"/>
    </svg>`,
  ];

  function populateBlogSketches(win) {
    const items = win.querySelectorAll(".blog-list > li");
    items.forEach((li, i) => {
      if (li.querySelector(".blog-sketch")) return;
      const wrap = document.createElement("span");
      wrap.className = "blog-sketch " + (i % 2 === 0 ? "blog-sketch-right" : "blog-sketch-left");
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = BLOG_SKETCHES[i % BLOG_SKETCHES.length];
      li.appendChild(wrap);
    });
  }

  function getAppIconSvg(app) {
    // Reuse the taskbar icon (already theme-colored via currentColor)
    const btn = document.querySelector(`.taskbar-app[data-app="${app}"]`);
    if (!btn) return "";
    const svg = btn.querySelector("svg");
    return svg ? svg.outerHTML : "";
  }

  // Fetch a page file and pull out its article and title. Cached, so going
  // back to a page is instant.
  const pageCache = new Map();
  function fetchPage(path) {
    if (startPage && path === startPage.path) return Promise.resolve(startPage);
    if (!pageCache.has(path)) {
      const p = fetch(SITE_ROOT + path)
        .then((res) => { if (!res.ok) throw new Error(res.status); return res.text(); })
        .then((text) => {
          const doc = new DOMParser().parseFromString(text, "text/html");
          const article = doc.querySelector(".page-main > article");
          if (!article) throw new Error("no article");
          return { article, title: doc.title };
        });
      p.catch(() => pageCache.delete(path)); // let a later click retry
      pageCache.set(path, p);
    }
    return pageCache.get(path);
  }

  async function loadPage(win, path) {
    win.dataset.loading = path;
    let page;
    try {
      page = await fetchPage(path);
    } catch (_) {
      const msg = document.createElement("p");
      msg.className = "window-load-error";
      msg.innerHTML = `Couldn't load this page. <a href="${SITE_ROOT + path}">Open it on its own</a>.`;
      page = { article: msg, title: "" };
    }
    if (win.dataset.loading !== path || !win.isConnected) return; // clicked elsewhere meanwhile
    showPage(win, path, page);
  }

  // Any click on a link to one of the site's pages (icons, cards, back
  // buttons, the desktop screenshots, cross-links) opens it in its window
  // instead of loading a new document. Assets, PDFs and other sites pass
  // through untouched, as do new-tab clicks.
  function onLinkClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a[href]");
    if (!link || link.target === "_blank") return;
    const path = pathOf(link.href);
    if (path === null || (path !== "" && !APPS[appOf(path)])) return;
    e.preventDefault();
    if (path && APPS[appOf(path)].disabled) return;
    const s = history.state;
    if (s && s.site && s.from === path) {
      // Back to where this page was opened from (e.g. "Back to all games"):
      // step back, so the browser's back button doesn't return here.
      history.back();
    } else if (here() === path) {
      route();
    } else {
      navigate(path);
    }
  }

  // -- Window dragging ------------------------------------------------------

  // Pointer capture keeps move/up events flowing to the title bar even when
  // the pointer leaves it, so no document-level listeners are needed (and
  // nothing is left behind when the window closes).
  function makeWindowDraggable(win) {
    const titlebar = win.querySelector(".window-titlebar");
    let dragging = false;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0;

    titlebar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".window-control")) return;
      if (win.classList.contains("is-maximised") || isPhone()) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      startLeft = parseFloat(win.style.left) || 0;
      startTop  = parseFloat(win.style.top)  || 0;
      titlebar.setPointerCapture(e.pointerId);
      document.body.classList.add("is-dragging-window");
      e.preventDefault();
    });

    titlebar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const layerRect = windowsLayer.getBoundingClientRect();
      let nx = startLeft + (e.clientX - sx);
      let ny = startTop  + (e.clientY - sy);
      // Keep enough of the title bar in bounds to grab again
      nx = Math.max(-win.offsetWidth + 100, Math.min(layerRect.width - 100, nx));
      ny = Math.max(0, Math.min(layerRect.height - 40, ny));
      win.style.left = nx + "px";
      win.style.top  = ny + "px";
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-dragging-window");
    };
    titlebar.addEventListener("pointerup", endDrag);
    titlebar.addEventListener("pointercancel", endDrag);
  }

  // -- Draggable desktop icons ---------------------------------------------

  // Desktop layout: icons are "freed" from the grid and become absolutely
  // positioned, draggable children of .desktop. Phone layout: they sit back
  // in the grid as plain tiles. setIconMode() switches between the two
  // whenever the PHONE media query changes (rotating a tablet, resizing).
  const iconLayout = { icons: [], clones: [], grid: null, desktop: null, freed: false };

  function setupIcons() {
    iconLayout.grid = document.querySelector(".app-grid");
    iconLayout.desktop = document.querySelector(".desktop");
    if (!iconLayout.grid || !iconLayout.desktop) return;

    iconLayout.icons = Array.from(iconLayout.grid.querySelectorAll(".app-icon"));
    // Invisible stand-ins that stay in the grid while the real icons are
    // freed, so the grid still computes the staircase layout (and reflows on
    // resize) and each "would-be" position can be read off a clone.
    iconLayout.clones = iconLayout.icons.map((icon) => {
      const clone = icon.cloneNode(true);
      clone.style.visibility = "hidden";
      clone.removeAttribute("data-app");
      clone.removeAttribute("href"); // not a second link for crawlers
      clone.setAttribute("aria-hidden", "true");
      clone.tabIndex = -1;
      return clone;
    });
    iconLayout.icons.forEach(wireIcon);

    setIconMode();
    PHONE.addEventListener("change", setIconMode);
    // Re-place undragged icons whenever the desktop or the grid changes size
    // (window resize, rotation, fonts loading). More reliable than the
    // window "resize" event, which can fire before layout has settled.
    const ro = new ResizeObserver(repositionUndragged);
    ro.observe(iconLayout.desktop);
    ro.observe(iconLayout.grid);
  }

  function setIconMode() {
    const { icons, clones, grid, desktop } = iconLayout;
    const wantFree = !isPhone();
    if (wantFree === iconLayout.freed) return;

    if (wantFree) {
      icons.forEach((icon, i) => {
        grid.replaceChild(clones[i], icon);
        icon.classList.add("is-free");
        desktop.appendChild(icon);
      });
      iconLayout.freed = true;
      repositionUndragged();
    } else {
      icons.forEach((icon, i) => {
        icon.classList.remove("is-free", "is-dragging");
        icon.style.left = icon.style.top = "";
        delete icon.dataset.dragged;
        grid.replaceChild(icon, clones[i]);
      });
      iconLayout.freed = false;
    }
    updateTaskbarState(); // the phone-only inert home page depends on the layout
  }

  // Apply current clone positions to any icon the user hasn't dragged, and
  // pull dragged ones back inside if the desktop shrank.
  function repositionUndragged() {
    if (!iconLayout.freed) return;
    const desktopRect = iconLayout.desktop.getBoundingClientRect();
    iconLayout.icons.forEach((icon, i) => {
      if (icon.dataset.dragged === "true") {
        const maxX = desktopRect.width  - icon.offsetWidth;
        const maxY = desktopRect.height - icon.offsetHeight;
        icon.style.left = Math.max(0, Math.min(maxX, parseFloat(icon.style.left) || 0)) + "px";
        icon.style.top  = Math.max(0, Math.min(maxY, parseFloat(icon.style.top)  || 0)) + "px";
        return;
      }
      const r = iconLayout.clones[i].getBoundingClientRect();
      icon.style.left = (r.left - desktopRect.left) + "px";
      icon.style.top  = (r.top  - desktopRect.top)  + "px";
    });
  }

  // One handler set for both layouts. `click` opens the app, so mouse, touch
  // and keyboard (Enter / Space) all work; a drag swallows the click that
  // follows it. Dragging is only active while the icon is freed.
  function wireIcon(icon) {
    let pressed = false;
    let dragging = false;
    let justDragged = false;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0;

    icon.addEventListener("click", (e) => {
      e.preventDefault();
      if (justDragged) { justDragged = false; return; }
      openApp(icon.dataset.app);
    });

    icon.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !iconLayout.freed) return;
      pressed = true;
      dragging = false;
      justDragged = false;
      sx = e.clientX;
      sy = e.clientY;
      startLeft = parseFloat(icon.style.left) || 0;
      startTop  = parseFloat(icon.style.top)  || 0;
      icon.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection / native image drag
    });

    icon.addEventListener("pointermove", (e) => {
      if (!pressed) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragging = true;
        icon.classList.add("is-dragging");
        icon.dataset.dragged = "true"; // exclude from resize-reflow
        document.body.classList.add("is-dragging-icon");
      }
      if (!dragging) return;

      const desktopRect = iconLayout.desktop.getBoundingClientRect();
      let nx = startLeft + dx;
      let ny = startTop  + dy;
      // Keep within desktop bounds
      nx = Math.max(0, Math.min(desktopRect.width  - icon.offsetWidth,  nx));
      ny = Math.max(0, Math.min(desktopRect.height - icon.offsetHeight, ny));
      icon.style.left = nx + "px";
      icon.style.top  = ny + "px";
    });

    const endPress = () => {
      if (!pressed) return;
      pressed = false;
      if (dragging) {
        dragging = false;
        justDragged = true; // swallow the click that follows the drag
        icon.classList.remove("is-dragging");
        document.body.classList.remove("is-dragging-icon");
        // If the pointer was released off the icon no click fires, so don't
        // let the flag leak into the next real click.
        setTimeout(() => { justDragged = false; }, 0);
      }
    };
    icon.addEventListener("pointerup", endPress);
    icon.addEventListener("pointercancel", endPress);
  }

  // -- Taskbar wiring -------------------------------------------------------

  function wireTaskbar() {
    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      const app = btn.dataset.app;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const win = openWindows.get(app);
        if (win && !win.classList.contains("is-minimised") && !isPhone()) {
          // Already open and visible → minimise (Win11 behaviour). On phones
          // the taskbar is a tab bar, where tapping the current tab stays put.
          minimiseApp(app);
        } else {
          openApp(app);
        }
      });

      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        // Desktop only: on phones a long-press on a tab shouldn't pop a
        // Windows-style menu.
        if (!APPS[app].disabled && !isPhone()) showContextMenu(e.clientX, e.clientY, app);
      });
    });

    const startBtn = document.querySelector(".taskbar-start");
    if (startBtn) {
      startBtn.addEventListener("click", showDesktop);
    }
  }

  // -- Right-click context menu --------------------------------------------

  function showContextMenu(x, y, app) {
    document.querySelectorAll(".context-menu").forEach((m) => m.remove());

    const isOpen = openWindows.has(app);
    const meta = APPS[app];
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.dataset.theme = app;
    menu.style.left = x + "px";
    menu.style.top  = y + "px";
    menu.innerHTML = `
      <button class="context-menu-item" type="button">${isOpen ? "Close" : "Open"} ${meta.title}</button>
    `;
    menu.querySelector("button").addEventListener("click", () => {
      if (isOpen) closeApp(app); else openApp(app);
      menu.remove();
    });
    document.body.appendChild(menu);

    // Reposition if it overflows the viewport
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - r.width  - 8) + "px";
    if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + "px";

    // Dismiss on next outside click
    setTimeout(() => {
      const dismiss = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("mousedown", dismiss);
        }
      };
      document.addEventListener("mousedown", dismiss);
    }, 0);
  }

  // -- Routing --------------------------------------------------------------

  // The URL path decides what's visible: "" = home, "<app>/…" = that app's
  // window showing that page. Runs on popstate, after navigate(), and once at
  // load (so arriving on games/ordinem/ opens ORDINEM).
  function route() {
    const path = here();
    const quiet = quietHome;
    quietHome = false;

    // Home from the visitor pressing back (not from closing or minimising,
    // which step back quietly): on phones hide every app; on desktop the
    // windows stay open, like a real desktop.
    if (!path) {
      if (homeTitle) document.title = homeTitle;
      if (quiet || !isPhone()) return;
      openWindows.forEach((w) => w.classList.add("is-minimised"));
      updateTaskbarState();
      return;
    }

    const app = appOf(path);
    if (!APPS[app] || APPS[app].disabled) return;
    const win = showApp(app);
    if (win.dataset.page !== path) loadPage(win, path);
    else if (win.dataset.title) document.title = win.dataset.title;
  }

  // Links from before pages existed (`#games`, `#games:ordinem`, e.g. on the
  // resume) still land on the right page.
  function upgradeOldLink() {
    const m = location.hash.match(/^#([a-z-]+)(?::([a-z0-9-]+))?$/);
    if (!m || !APPS[m[1]] || here()) return false;
    history.replaceState(null, "", SITE_ROOT + m[1] + "/" + (m[2] ? m[2] + "/" : ""));
    return true;
  }

  // -- Init -----------------------------------------------------------------

  function init() {
    // Insert windows layer just before the taskbar so it sits above .desktop
    // but below the fixed taskbar (which uses z-index: 100).
    windowsLayer = document.createElement("div");
    windowsLayer.className = "windows-layer";
    const taskbar = document.querySelector(".taskbar");
    document.body.insertBefore(windowsLayer, taskbar);

    setupIcons();
    wireTaskbar();
    document.addEventListener("click", onLinkClick);

    // Escape closes the topmost window. Inside a search box that still has
    // text, Escape just clears the box (browser default) instead.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (e.target.matches?.("input, textarea") && e.target.value) return;
      if (document.querySelector(".context-menu")) {
        document.querySelectorAll(".context-menu").forEach((m) => m.remove());
        return;
      }
      const app = topWindowApp();
      if (app) closeApp(app);
    });

    window.addEventListener("popstate", route);
    window.addEventListener("hashchange", () => { if (upgradeOldLink()) route(); });
    upgradeOldLink();
    route();
  }

  // On a page file, fetch the home page and move its desktop (icon sprite,
  // desktop, taskbar) into this document, then start as usual. Relative URLs
  // inside it still work because this page's <base> points at the root.
  async function buildShell() {
    try {
      const res = await fetch(SITE_ROOT);
      if (!res.ok) throw new Error(res.status);
      const home = new DOMParser().parseFromString(await res.text(), "text/html");
      homeTitle = home.title;
      const parts = [...home.body.children].filter((el) => el.matches("svg, main.desktop, footer.taskbar"));
      if (parts.length < 3) throw new Error("shell not found");
      document.body.prepend(...parts.map((el) => document.adoptNode(el)));
      // The taskbar clock only exists now, so start clock.js after it.
      const clock = home.querySelector('script[src*="clock.js"]');
      if (clock) document.body.append(Object.assign(document.createElement("script"), { src: clock.getAttribute("src") }));
      init();
    } catch (_) {
      // No desktop (offline, or opened from disk): show the plain page.
      document.documentElement.classList.remove("has-shell");
    }
  }

  const start = IS_PAGE ? buildShell : init;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
