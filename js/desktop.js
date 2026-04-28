/* ---------------------------------------------------------------------------
 * Desktop runtime: window manager + draggable desktop icons.
 *
 * Step 2 of the build (see memory/CONCEPT.md "Planned — step 2").
 *
 * - Clicking an app icon opens a draggable window with theme-colored chrome.
 * - Title bar has Win11-style minimise / maximise / close.
 * - Desktop icons themselves are draggable around the desktop surface
 *   (drag = move, click without drag = open the app).
 * - Taskbar: left-click open/focus/minimise (Win11 toggle), right-click
 *   context menu, Start = show desktop, .is-open class on open apps.
 * - No persistence — refresh resets icon positions and closes all windows.
 * ------------------------------------------------------------------------- */

(() => {
  // -- App registry ---------------------------------------------------------

  // Window sizing is viewport-relative, not fixed pixel sizes — every app
  // opens at OPEN_FRAC of the viewport, the maximise button takes it to
  // 100%, and the restore button (only visible when maximised) drops it to
  // SMALL_FRAC. See createWindow() / toggleMaximise().
  const APPS = {
    about:      { title: "About Me"   },
    games:      { title: "Games"      },
    blogs:      { title: "Blogs"      },
    experience: { title: "Experience" },
    links:      { title: "Links"      },
    contacts:   { title: "Contacts"   },
  };

  const OPEN_FRAC  = 0.85; // default size on open
  const SMALL_FRAC = 0.60; // size after clicking restore from maximised

  const DRAG_THRESHOLD = 4; // px before a mousedown counts as a drag

  // -- Window manager state -------------------------------------------------

  const openWindows = new Map(); // appId -> windowEl
  let zCounter = 100;
  let windowsLayer;

  function focusWindow(win) {
    win.style.zIndex = String(++zCounter);
  }

  function openApp(app) {
    if (openWindows.has(app)) {
      const win = openWindows.get(app);
      win.classList.remove("is-minimised");
      focusWindow(win);
      updateTaskbarState();
      return;
    }
    const win = createWindow(app);
    openWindows.set(app, win);
    windowsLayer.appendChild(win);
    focusWindow(win);
    updateTaskbarState();
  }

  function closeApp(app) {
    const win = openWindows.get(app);
    if (!win) return;
    win.remove();
    openWindows.delete(app);
    updateTaskbarState();
  }

  function minimiseApp(app) {
    const win = openWindows.get(app);
    if (!win) return;
    win.classList.add("is-minimised");
    updateTaskbarState();
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
    updateTaskbarState();
  }

  // is-open = window exists (underline persists, even when minimised).
  // is-active = window exists AND is not minimised (background highlight).
  // So multiple visible windows can all carry the highlight; only minimising
  // (or closing) clears it.
  function updateTaskbarState() {
    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      const win = openWindows.get(btn.dataset.app);
      btn.classList.toggle("is-open", !!win);
      btn.classList.toggle("is-active", !!win && !win.classList.contains("is-minimised"));
    });
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
      <div class="window-body">${getAppBody(app, meta)}</div>
    `;

    // Controls
    win.querySelector(".window-close").addEventListener("click", (e) => { e.stopPropagation(); closeApp(app); });
    win.querySelector(".window-min").addEventListener("click",   (e) => { e.stopPropagation(); minimiseApp(app); });
    win.querySelector(".window-max").addEventListener("click",   (e) => { e.stopPropagation(); toggleMaximise(app); });

    // Focus on any mousedown inside the window
    win.addEventListener("mousedown", () => focusWindow(win));

    // Drag via title bar (background area, not buttons)
    makeWindowDraggable(win);

    // Double-click title bar toggles maximise
    win.querySelector(".window-titlebar").addEventListener("dblclick", (e) => {
      if (e.target.closest(".window-control")) return;
      toggleMaximise(app);
    });

    // Wire any [data-copy] elements in the body (e.g. the Contacts email
    // button). Click → copy the value to clipboard, briefly flag the
    // element with .is-copied for visual feedback.
    win.querySelectorAll("[data-copy]").forEach((el) => {
      el.addEventListener("click", async () => {
        const value = el.dataset.copy;
        try { await navigator.clipboard.writeText(value); } catch (_) { /* no-op */ }
        el.classList.add("is-copied");
        setTimeout(() => el.classList.remove("is-copied"), 1400);
      });
    });

    // Cross-app anchor links (e.g. Experience → Games "Browse the portfolio").
    // We can't rely on the bare `<a href="#games">` because if the hash is
    // already `#games` (user opened, closed, re-clicked) no hashchange fires
    // and the window never re-opens. Intercept and route through openApp().
    win.querySelectorAll('a[href^="#"]').forEach((link) => {
      const href = link.getAttribute("href");
      const target = href.slice(1).split(":")[0];
      if (!APPS[target]) return;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (location.hash === href) {
          openApp(target);
        } else {
          location.hash = href.slice(1);
        }
      });
    });

    // Generic list/detail view swap, hash-routed so each detail view has a
    // shareable URL (e.g. #blogs:blog-3 → opens Blogs with that post showing,
    // #games:ordinem → opens Games on the ORDINEM detail). The click handlers
    // here ONLY mutate location.hash; the actual UI swap happens inside the
    // top-level applyHash() function (called on hashchange + page load), so
    // there's a single source of truth for the visible state.
    const listView   = win.querySelector('[data-view="list"]');
    const detailView = win.querySelector('[data-view="detail"]');
    if (listView && detailView) {
      win.querySelectorAll("[data-detail-trigger]").forEach((trigger) => {
        trigger.addEventListener("click", (e) => {
          e.preventDefault();
          location.hash = `${app}:${trigger.dataset.detailTrigger}`;
        });
      });
      win.querySelectorAll("[data-detail-back]").forEach((btn) => {
        btn.addEventListener("click", () => {
          location.hash = app;
        });
      });
    }

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

    return win;
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

  // Pulls each app's content from a <template id="app-content-<id>"> in
  // index.html. Templates make the content editable as plain HTML without
  // touching this JS file. Falls back to a generic placeholder if missing.
  function getAppBody(app, meta) {
    const tpl = document.getElementById(`app-content-${app}`);
    if (tpl) return tpl.innerHTML;
    return `
      <div class="window-placeholder">
        <h2 class="window-placeholder-title">${meta.title}</h2>
        <p class="window-placeholder-text">Coming soon &mdash; content for this app will live here.</p>
      </div>
    `;
  }

  // -- Window dragging ------------------------------------------------------

  function makeWindowDraggable(win) {
    const titlebar = win.querySelector(".window-titlebar");
    let dragging = false;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0;

    titlebar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".window-control")) return;
      if (win.classList.contains("is-maximised")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      startLeft = parseFloat(win.style.left) || 0;
      startTop  = parseFloat(win.style.top)  || 0;
      document.body.classList.add("is-dragging-window");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
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

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-dragging-window");
    });
  }

  // -- Draggable desktop icons ---------------------------------------------

  function setupDraggableIcons() {
    const grid = document.querySelector(".app-grid");
    const desktop = document.querySelector(".desktop");
    if (!grid || !desktop) return;

    const icons = Array.from(grid.querySelectorAll(".app-icon"));

    // On narrow screens, leave the grid layout alone — dragging icons in a
    // packed phone layout feels bad and there's no room to move them.
    if (window.innerWidth <= 900) {
      icons.forEach((icon) => wireIconClick(icon));
      return;
    }

    // Replace originals in the grid with invisible clones, so the grid still
    // computes the staircase layout (and reflows on resize) and we can read
    // each "would-be" position via getBoundingClientRect on the clones.
    // The actual interactive icons go into .desktop as absolute children.
    const measurementClones = icons.map((icon) => {
      const clone = icon.cloneNode(true);
      clone.style.visibility = "hidden";
      clone.removeAttribute("data-app");
      clone.setAttribute("aria-hidden", "true");
      clone.tabIndex = -1;
      return clone;
    });
    icons.forEach((icon, i) => grid.replaceChild(measurementClones[i], icon));

    // Promote each original to absolute inside .desktop.
    icons.forEach((icon) => {
      icon.style.position = "absolute";
      icon.style.transform = "none";
      icon.style.margin = "0";
      icon.style.zIndex = "3"; // above decor (1) and panels (2)
      desktop.appendChild(icon);
      makeIconDraggable(icon);
    });

    // Apply current clone positions, and re-apply on resize for any icon
    // the user hasn't manually dragged.
    function repositionUndragged() {
      const desktopRect = desktop.getBoundingClientRect();
      icons.forEach((icon, i) => {
        if (icon.dataset.dragged === "true") return;
        const r = measurementClones[i].getBoundingClientRect();
        icon.style.left = (r.left - desktopRect.left) + "px";
        icon.style.top  = (r.top  - desktopRect.top)  + "px";
      });
    }
    repositionUndragged();
    window.addEventListener("resize", repositionUndragged);
  }

  function wireIconClick(icon) {
    icon.addEventListener("click", (e) => {
      e.preventDefault();
      openApp(icon.dataset.app);
    });
  }

  function makeIconDraggable(icon) {
    let pressed = false;
    let dragging = false;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0;
    const desktop = document.querySelector(".desktop");

    icon.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      pressed = true;
      dragging = false;
      sx = e.clientX;
      sy = e.clientY;
      startLeft = parseFloat(icon.style.left) || 0;
      startTop  = parseFloat(icon.style.top)  || 0;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
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

      const desktopRect = desktop.getBoundingClientRect();
      let nx = startLeft + dx;
      let ny = startTop  + dy;
      // Keep within desktop bounds
      nx = Math.max(0, Math.min(desktopRect.width  - icon.offsetWidth,  nx));
      ny = Math.max(0, Math.min(desktopRect.height - icon.offsetHeight, ny));
      icon.style.left = nx + "px";
      icon.style.top  = ny + "px";
    });

    document.addEventListener("mouseup", (e) => {
      if (!pressed) return;
      pressed = false;
      if (dragging) {
        icon.classList.remove("is-dragging");
        document.body.classList.remove("is-dragging-icon");
        dragging = false;
        // Suppress the click that may follow if mouseup landed on the icon.
        // {once: true} cleans up if click fires; setTimeout cleans up if it doesn't
        // (e.g. mouseup happened off-icon — no click would be dispatched).
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        icon.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => icon.removeEventListener("click", swallow, true), 0);
      } else {
        // Treat as click → open the app
        openApp(icon.dataset.app);
      }
    });
  }

  // -- Taskbar wiring -------------------------------------------------------

  function wireTaskbar() {
    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      const app = btn.dataset.app;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const win = openWindows.get(app);
        if (win && !win.classList.contains("is-minimised")) {
          // Already open and visible → minimise (Win11 behaviour)
          minimiseApp(app);
        } else {
          openApp(app);
        }
      });

      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, app);
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

  // -- Hash routing ---------------------------------------------------------

  // URL hash scheme: `#<app>` for the app at list view, `#<app>:<detail-id>`
  // for a specific detail. Triggers and back buttons set location.hash; this
  // function reads the hash and mutates the UI to match. Runs on every
  // hashchange + once at page load (so a deep link in the URL on first load
  // opens the right window/state).
  function applyHash() {
    const raw = location.hash.replace(/^#/, "");

    // Empty hash → reset every open list/detail window back to its list view.
    // Means clicking the browser back button from a detail view returns to
    // the list (because the previous history entry typically had no hash or
    // just `#<app>`).
    if (!raw) {
      openWindows.forEach((w) => {
        const list   = w.querySelector('[data-view="list"]');
        const detail = w.querySelector('[data-view="detail"]');
        if (list && detail) { detail.hidden = true; list.hidden = false; }
      });
      return;
    }

    const [appId, detailId] = raw.split(":");
    if (!appId || !APPS[appId]) return;

    // Open the app (idempotent: focuses + un-minimises if already open).
    openApp(appId);

    const win = openWindows.get(appId);
    if (!win) return;
    const listView   = win.querySelector('[data-view="list"]');
    const detailView = win.querySelector('[data-view="detail"]');
    const body       = win.querySelector(".window-body");
    if (!listView || !detailView) return;

    if (detailId) {
      const trigger = win.querySelector(`[data-detail-trigger="${CSS.escape(detailId)}"]`);
      if (trigger) {
        const titleTarget = detailView.querySelector("[data-detail-title-target]");
        if (titleTarget) titleTarget.textContent = trigger.dataset.detailTitle || detailId;
        listView.hidden   = true;
        detailView.hidden = false;
      } else {
        // Unknown detail id (post deleted, typo'd URL, etc.) — fall back to list.
        detailView.hidden = true;
        listView.hidden   = false;
      }
    } else {
      // `#<app>` with no detail → list view.
      detailView.hidden = true;
      listView.hidden   = false;
    }

    if (body) body.scrollTop = 0;
  }

  // -- Init -----------------------------------------------------------------

  function init() {
    // Insert windows layer just before the taskbar so it sits above .desktop
    // but below the fixed taskbar (which uses z-index: 100).
    windowsLayer = document.createElement("div");
    windowsLayer.className = "windows-layer";
    const taskbar = document.querySelector(".taskbar");
    document.body.insertBefore(windowsLayer, taskbar);

    setupDraggableIcons();
    wireTaskbar();

    // Hash routing — keep UI in sync with location.hash so URLs like
    // `#blogs:blog-3` deep-link to a specific detail view. Runs once now to
    // honour any hash present at page load, then on every subsequent change.
    window.addEventListener("hashchange", applyHash);
    applyHash();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
