/** The LinkedIn window's toolbar page (loaded as a data: URL; talks to the main process through preload/toolbar). */
export const TOOLBAR_HEIGHT = 44

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: light dark; --bg:#f3f2ef; --fg:#1d1d1f; --muted:#666; --field:#fff; --line:#d0d0d0; --hover:rgba(0,0,0,.07); --accent:#0a66c2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1f2328; --fg:#e8e8e8; --muted:#9aa0a6; --field:#2b3036; --line:#3a4048; --hover:rgba(255,255,255,.09); --accent:#70b5f9; } }
  * { box-sizing:border-box; }
  html, body { margin:0; overflow:hidden; background:var(--bg); color:var(--fg); font:13px system-ui, "Segoe UI", sans-serif; user-select:none; }
  body { height:${TOOLBAR_HEIGHT}px; display:flex; align-items:center; gap:4px; padding:0 8px; border-bottom:1px solid var(--line); }
  button { width:32px; height:32px; flex:none; border:0; border-radius:6px; background:none; color:var(--fg); cursor:pointer; display:grid; place-items:center; padding:0; }
  button:hover:not(:disabled) { background:var(--hover); }
  button:disabled { opacity:.35; cursor:default; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  form { flex:1; min-width:0; margin:0 4px; position:relative; }
  input { width:100%; height:30px; border:1px solid var(--line); border-radius:15px; background:var(--field); color:var(--fg); padding:0 12px; font:inherit; user-select:text; }
  input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .bar { position:absolute; left:12px; right:12px; bottom:1px; height:2px; background:var(--accent); border-radius:1px; transform-origin:left; animation:load 1.2s ease-in-out infinite; display:none; }
  .loading .bar { display:block; }
  @keyframes load { 0% { transform:scaleX(0); opacity:1 } 80% { transform:scaleX(1); opacity:1 } 100% { transform:scaleX(1); opacity:0 } }
  .reload-x { display:none; } .loading .reload-x { display:block; } .loading .reload-r { display:none; }
</style></head>
<body>
  <button id="back" title="Back (Alt+←)" aria-label="Back" disabled><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
  <button id="forward" title="Forward (Alt+→)" aria-label="Forward" disabled><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
  <button id="reload" title="Reload (F5)" aria-label="Reload">
    <svg class="reload-r" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
    <svg class="reload-x" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
  </button>
  <button id="home" title="LinkedIn Jobs" aria-label="LinkedIn Jobs"><svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></button>
  <form id="f" autocomplete="off">
    <input id="addr" spellcheck="false" placeholder="LinkedIn address or job search (e.g. senior react developer)" aria-label="Address">
    <div class="bar"></div>
  </form>
  <button id="ext" title="Open this page in your browser" aria-label="Open in browser"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button>
<script>
  const $ = (id) => document.getElementById(id);
  const addr = $('addr');
  let loading = false, editing = false, current = '';
  $('back').onclick = () => nav.back();
  $('forward').onclick = () => nav.forward();
  $('reload').onclick = () => (loading ? nav.stop() : nav.reload());
  $('home').onclick = () => nav.home();
  $('ext').onclick = () => nav.external();
  $('f').onsubmit = (e) => { e.preventDefault(); editing = false; nav.go(addr.value); addr.blur(); };
  addr.addEventListener('focus', () => { editing = true; addr.select(); });
  addr.addEventListener('blur', () => { editing = false; addr.value = current; });
  addr.addEventListener('keydown', (e) => { if (e.key === 'Escape') { addr.value = current; addr.blur(); } });
  nav.onFocusAddress(() => { addr.focus(); addr.select(); });
  nav.onState((s) => {
    current = s.url; loading = s.loading;
    if (!editing) addr.value = s.url;
    $('back').disabled = !s.canGoBack;
    $('forward').disabled = !s.canGoForward;
    $('reload').title = s.loading ? 'Stop (Esc)' : 'Reload (F5)';
    $('reload').setAttribute('aria-label', s.loading ? 'Stop' : 'Reload');
    document.body.classList.toggle('loading', s.loading);
  });
</script>
</body></html>`

export const TOOLBAR_URL = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
