/**
 * Page servie au téléphone. Elle est volontairement embarquée en dur dans le bundle : le process
 * principal est compilé par rollup, un fichier à côté ne survivrait pas au packaging.
 *
 * Aucune dépendance, aucun appel réseau sortant : la page tient en un seul document, utilise le
 * jeton présent dans son URL et parle à l'application en WebSocket (repli sur HTTP si la socket
 * est coupée). Elle doit rester lisible d'une main, pouce sur l'écran, dans le noir.
 */
export const REMOTE_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0f1115">
<title>Télécommande EpiKodi</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --surface:#191d25; --surface-2:#222630;
          --text:#e8eaf0; --muted:#9aa2b1; --accent:#4f7cff; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; padding:12px calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));
         background:var(--bg); color:var(--text); font:16px/1.4 system-ui, sans-serif;
         display:flex; flex-direction:column; gap:12px; min-height:100vh; user-select:none; }
  header { display:flex; align-items:center; gap:8px; }
  h1 { font-size:15px; margin:0; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
  #link { margin-left:auto; font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px; }
  #dot { width:8px; height:8px; border-radius:50%; background:#c0453b; }
  #dot.on { background:#3ea06a; }
  .card { background:var(--surface); border-radius:14px; padding:14px; }
  #title { font-size:19px; font-weight:600; }
  #sub, #view { color:var(--muted); font-size:13px; }
  #title.idle { color:var(--muted); font-weight:400; }
  input[type=range] { width:100%; margin:10px 0 0; accent-color:var(--accent); height:28px; }
  .times { display:flex; justify-content:space-between; color:var(--muted);
           font-size:12px; font-variant-numeric:tabular-nums; }
  .row { display:flex; gap:10px; align-items:center; }
  button { font:inherit; color:var(--text); background:var(--surface-2); border:0; border-radius:12px;
           padding:0; height:56px; flex:1; font-size:20px; cursor:pointer; touch-action:manipulation; }
  button:active { background:var(--accent); }
  #play { flex:1.6; font-size:24px; }
  .pad { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .pad button { height:62px; }
  .pad .spacer { visibility:hidden; }
  #ok { background:var(--accent); font-size:15px; font-weight:600; }
  .small { font-size:14px; }
  footer { color:var(--muted); font-size:12px; text-align:center; margin-top:auto; }
</style>
</head>
<body>
<header>
  <h1>EpiKodi</h1>
  <span id="link"><span id="dot"></span><span id="linktext">connexion…</span></span>
</header>

<section class="card">
  <div id="title" class="idle">Rien en lecture</div>
  <div id="sub"></div>
  <input id="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Position">
  <div class="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
</section>

<div class="row">
  <button id="prev" title="Précédent">⏮</button>
  <button id="back10" title="-10 s">-10</button>
  <button id="play" title="Lecture / pause">▶</button>
  <button id="fwd10" title="+10 s">+10</button>
  <button id="next" title="Suivant">⏭</button>
</div>

<section class="card">
  <div class="row">
    <button id="mute" class="small" style="flex:0 0 64px; height:40px;">🔊</button>
    <input id="volume" type="range" min="0" max="100" value="100" aria-label="Volume">
  </div>
</section>

<div class="pad">
  <button class="spacer"></button>
  <button data-key="up">▲</button>
  <button class="spacer"></button>
  <button data-key="left">◀</button>
  <button id="ok" data-key="ok">OK</button>
  <button data-key="right">▶</button>
  <button class="small" data-key="back">Retour</button>
  <button data-key="down">▼</button>
  <button class="small" data-key="home">Accueil</button>
</div>

<div class="row">
  <button id="stop" class="small">Arrêter la lecture</button>
</div>

<footer id="view"></footer>

<script>
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var seeking = false, sliding = false, socket = null, retry = null, state = null;

  var el = function (id) { return document.getElementById(id); };
  var fmt = function (s) {
    s = Math.max(0, Math.round(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var mm = h && m < 10 ? '0' + m : String(m);
    return (h ? h + ':' : '') + mm + ':' + (x < 10 ? '0' + x : x);
  };

  function send(cmd) {
    var body = JSON.stringify(cmd);
    if (socket && socket.readyState === 1) { socket.send(body); return; }
    fetch('/api/command?t=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body
    }).catch(function () {});
  }

  function render(s) {
    state = s;
    var idle = s.source === 'none';
    el('title').textContent = s.title || 'Rien en lecture';
    el('title').className = idle ? 'idle' : '';
    el('sub').textContent = s.subtitle || '';
    el('view').textContent = s.view ? 'Écran : ' + s.view : '';
    el('play').textContent = s.playing ? '❚❚' : '▶';
    el('pos').textContent = fmt(s.position);
    el('dur').textContent = s.duration ? fmt(s.duration) : '--:--';
    if (!seeking) {
      el('seek').disabled = !s.duration;
      el('seek').value = s.duration ? Math.round((s.position / s.duration) * 1000) : 0;
    }
    if (!sliding) el('volume').value = Math.round((s.muted ? 0 : s.volume) * 100);
    el('mute').textContent = s.muted || !s.volume ? '🔇' : s.volume < 0.5 ? '🔉' : '🔊';
  }

  function link(ok, text) {
    el('dot').className = ok ? 'on' : '';
    el('linktext').textContent = text;
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    socket = new WebSocket(proto + location.host + '/ws?t=' + encodeURIComponent(token));
    socket.onopen = function () { link(true, 'connecté'); };
    socket.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === 'state') render(msg.state);
    };
    socket.onclose = function () {
      link(false, 'reconnexion…');
      socket = null;
      clearTimeout(retry);
      retry = setTimeout(connect, 2000);
    };
    socket.onerror = function () { link(false, 'hors ligne'); };
  }

  el('play').onclick = function () { send({ type: 'toggle' }); };
  el('prev').onclick = function () { send({ type: 'prev' }); };
  el('next').onclick = function () { send({ type: 'next' }); };
  el('back10').onclick = function () { send({ type: 'seek-by', delta: -10 }); };
  el('fwd10').onclick = function () { send({ type: 'seek-by', delta: 10 }); };
  el('mute').onclick = function () { send({ type: 'mute' }); };
  el('stop').onclick = function () { send({ type: 'stop' }); };

  var seek = el('seek');
  seek.addEventListener('pointerdown', function () { seeking = true; });
  seek.addEventListener('change', function () {
    seeking = false;
    if (state && state.duration) send({ type: 'seek', position: (seek.value / 1000) * state.duration });
  });

  var volume = el('volume');
  volume.addEventListener('pointerdown', function () { sliding = true; });
  volume.addEventListener('input', function () { send({ type: 'volume', value: volume.value / 100 }); });
  volume.addEventListener('change', function () { sliding = false; });

  var pad = document.querySelectorAll('[data-key]');
  for (var i = 0; i < pad.length; i++) {
    pad[i].onclick = function (e) { send({ type: 'key', key: e.currentTarget.dataset.key }); };
  }

  // Le navigateur gèle la socket quand l'écran s'éteint : on se reconnecte au réveil
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !socket) { clearTimeout(retry); connect(); }
  });

  connect();
})();
</script>
</body>
</html>
`

/** Réponse quand le jeton est absent ou faux : pas de détail, juste la marche à suivre. */
export const REMOTE_DENIED = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Télécommande EpiKodi</title>
<style>:root{color-scheme:dark}body{margin:0;display:grid;place-items:center;min-height:100vh;
background:#0f1115;color:#e8eaf0;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
p{color:#9aa2b1;max-width:28rem}</style></head>
<body><div><h1>Jeton invalide</h1>
<p>Ouvre l'adresse complète affichée dans <strong>EpiKodi → Paramètres → Télécommande</strong> :
elle contient le jeton d'appairage.</p></div></body></html>
`
