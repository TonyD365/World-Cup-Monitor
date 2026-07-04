// devtools-guard.js — wipe the entire page the moment the browser developer
// tools appear to be open: every element is removed and the document is left a
// blank black screen. Destructive and one-shot — the page does NOT come back
// when devtools close; a reload is required (that is the intent).
//
// Detection layers (any one trips the wipe):
//   1. Docked-panel size delta  — an open docked panel shrinks the viewport.
//   2. Console-inspection bait   — a getter that only runs when devtools render
//                                  the object in the console (catches an
//                                  undocked window whose console is showing).
//   3. debugger timing trap      — a `debugger` statement pauses only while
//                                  devtools are open; a long delay means open.
// Plus best-effort interception of the usual open-devtools shortcuts and the
// context menu. None of this is a real lock — determined users get in — it's a
// themed deterrent.

(function () {
  const THRESHOLD = 160;
  let wiped = false;
  let timer = null;

  // Remove every element and leave a blank black document.
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

  // 1. Docked devtools shrink the viewport. Width is the strong signal (normally
  // just a ~16px scrollbar); the 160px threshold keeps browser chrome from
  // tripping the height check.
  const sizeOpen = () => {
    const w = window.outerWidth - window.innerWidth;
    const h = window.outerHeight - window.innerHeight;
    return w > THRESHOLD || h > THRESHOLD;
  };

  // 2. Console bait. The getter fires only when devtools format the object for
  // the console panel — so it stays silent while the console is closed, then
  // trips the first time an (even undocked) console shows our log.
  let baitTripped = false;
  const bait = document.createElement('div');
  Object.defineProperty(bait, 'id', {
    get() { baitTripped = true; return ''; },
  });
  const baitOpen = () => {
    baitTripped = false;
    // Near-invisible log; the getter runs when devtools render it.
    console.log('%c', 'font-size:0', bait);
    return baitTripped;
  };

  // 3. debugger timing trap. Harmless no-op when devtools are closed; pauses (so
  // the measured gap balloons) when they are open. Only reached if 1 and 2 miss,
  // so it won't pause when we can already tell devtools are open.
  const debuggerOpen = () => {
    const t0 = (performance && performance.now) ? performance.now() : Date.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const t1 = (performance && performance.now) ? performance.now() : Date.now();
    return t1 - t0 > 120;
  };

  const check = () => {
    let open = false;
    try { open = sizeOpen() || baitOpen() || debuggerOpen(); } catch (_) { open = false; }
    if (open) wipe();
  };

  // Best-effort interception of the common entry points.
  const guardKeys = () => {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'i' || k === 'j' || k === 'c');
      const macAlt = e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c');
      const viewSource = (e.ctrlKey || e.metaKey) && k === 'u';
      if (e.key === 'F12' || ctrlShift || macAlt || viewSource) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  };

  const start = () => {
    guardKeys();
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
