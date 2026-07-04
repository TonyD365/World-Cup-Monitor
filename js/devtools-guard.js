// devtools-guard.js — wipe the entire page the moment the browser developer
// tools appear to be open: every element is removed and the document is left a
// blank black screen. This is destructive and one-shot — the page does not come
// back when devtools close; a reload is required (that is the intent).
//
// There is no spec-blessed way to detect devtools. We use the one clean,
// side-effect-free heuristic: an open, *docked* devtools panel shrinks the
// viewport far below the window's outer size. (A separate undocked devtools
// window can't be detected this way — the console-bait tricks that would catch
// it spam and clear the console, so we deliberately don't use them.) The 160px
// threshold keeps normal scrollbars / browser chrome from tripping it.

(function () {
  const THRESHOLD = 160;
  let wiped = false;
  let timer = null;

  // Remove every element on the page and leave a blank black document.
  const wipe = () => {
    if (wiped) return;
    wiped = true;
    if (timer) clearInterval(timer);
    try {
      document.documentElement.innerHTML = ''; // drops <head> and <body> subtrees
      document.documentElement.style.background = '#000';
      document.documentElement.style.height = '100%';
      document.documentElement.style.margin = '0';
      document.title = '';
    } catch (_) { /* ignore */ }
  };

  // Docked devtools shrink the viewport horizontally or vertically. Width is the
  // strong signal (normally only a ~16px scrollbar); a large height gap can also
  // come from browser chrome, so the 160px threshold keeps that from tripping.
  const devtoolsOpen = () => {
    const w = window.outerWidth - window.innerWidth;
    const h = window.outerHeight - window.innerHeight;
    return w > THRESHOLD || h > THRESHOLD;
  };

  const check = () => {
    let open = false;
    try { open = devtoolsOpen(); } catch (_) { open = false; }
    if (open) wipe();
  };

  const start = () => {
    check(); // catch devtools already open at load
    timer = setInterval(check, 800);
    window.addEventListener('resize', check, { passive: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
