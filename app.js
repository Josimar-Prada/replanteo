/* Replanteo final — app de campo sin conexión (Porotobango).
   Catálogo (tipos, campos con medida de diseño, estructuras con coordenadas) desde el Excel REPLANTEO FINAL.
   Datos solo en el teléfono (IndexedDB). Envío: CSV + fotos por el menú Compartir → Google Drive → Power Query del Excel. */
'use strict';
const APP_VERSION = '1.0.0';
const FOTO_LADO = 1600, FOTO_CAL = 0.72, FOTOS_POR_ENVIO = 6, GPS_SEG = 20, TRK_ACC_MAX = 25;
const COLS = {
  vis: ['VISITA_ID', 'FECHA', 'EST_ID', 'NOMBRE', 'NUEVA', 'COMPONENTES', 'ESTADO_OBRA', 'AVANCE', 'LATITUD', 'LONGITUD', 'ALTITUD', 'PRECISION_M',
    'N_LECTURAS', 'ESTE', 'NORTE', 'DIST_DISENO_M', 'OBSERVACION', 'FOTOS', 'N_MEDIDAS', 'USUARIO', 'CREADO', 'EDITADO'],
  med: ['MED_ID', 'VISITA_ID', 'FECHA', 'EST_ID', 'TIPO_ID', 'CAMPO_ID', 'GRUPO', 'CAMPO', 'UND', 'TIPO_DATO', 'DISENO', 'MEDIDO', 'DIFERENCIA',
    'VERIFICACION', 'TEXTO_CAMPO', 'USUARIO', 'CREADO'],
  pla: ['LIN_ID', 'VISITA_ID', 'FECHA', 'EST_ID', 'ITEM', 'DESCRIPCION', 'UND', 'N_VECES', 'LARGO', 'ANCHO', 'ALTO', 'PARCIAL', 'USUARIO'],
  trk: ['TRK_ID', 'TRAMO', 'DIAMETRO', 'MATERIAL', 'CLASE', 'PTO_N', 'FECHA_HORA', 'TIPO_PTO', 'OBS', 'LATITUD', 'LONGITUD', 'ALTITUD', 'PRECISION_M',
    'ESTE', 'NORTE', 'DIST_ACUM_M', 'USUARIO'],
};
const CATS = [['', 'Todas'], ['UBS', 'UBS'], ['PA', 'Pases aéreos'], ['VAL', 'Válvulas'], ['CAP', 'Captación y tratamiento'], ['ALM', 'Almacenamiento'], ['OTR', 'Otros']];
function catDe(id) {
  const p = String(id).split('-')[0];
  return p === 'UBS' ? 'UBS' : p === 'PA' ? 'PA' : ['VA', 'VP', 'VC'].includes(p) ? 'VAL' : ['CAP', 'DES', 'FIL'].includes(p) ? 'CAP' : ['RES', 'CIS', 'CDC'].includes(p) ? 'ALM' : 'OTR';
}

const $ = id => document.getElementById(id);
const S = { cat: null, tipo: new Map(), campos: new Map(), est: new Map(), alt: new Map(), idsVis: new Set(), nuevas: [], vis: [], trk: [], lotes: [],
  user: '', opts: { orig: true, sello: true }, gps: null, watch: null, v: null, est0: null, cat0: '', prep: null, trkAct: null, trkWatch: null, wake: null };

/* ---------------- IndexedDB ---------------- */
let DB;
function idb() {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open('replanteo', 1);
    rq.onupgradeneeded = () => { const d = rq.result; for (const s of ['vis', 'fotos', 'trk', 'est']) d.createObjectStore(s, { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'k' }); };
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((ok, ko) => {
    const t = DB.transaction(store, mode), st = t.objectStore(store); let out;
    Promise.resolve(fn(st)).then(v => { out = v; });
    t.oncomplete = () => ok(out); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
  });
}
const rqp = rq => new Promise((ok, ko) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error); });
const getAll = s => tx(s, 'readonly', st => rqp(st.getAll()));
const get1 = (s, k) => tx(s, 'readonly', st => rqp(st.get(k)));
const put = (s, v) => tx(s, 'readwrite', st => { st.put(v); });
const del = (s, k) => tx(s, 'readwrite', st => { st.delete(k); });
const getMeta = async k => { const r = await get1('meta', k); return r ? r.v : null; };
const setMeta = (k, v) => put('meta', { k, v });

/* ---------------- utilidades ---------------- */
const pad = n => String(n).padStart(2, '0');
function hoy(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function ahoraISO(d = new Date()) { return `${hoy(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = v => { if (v === '' || v === null || v === undefined) return null; const x = +String(v).trim().replace(',', '.'); return isNaN(x) ? null : x; };
const fmt = (v, d = 2) => v === null || v === undefined || isNaN(v) ? '—' : (+v).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d >= 2 ? Math.max(d, 3) : d });
const fechaTxt = f => { if (!f) return ''; const [y, m, d] = f.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
function toast(t, ms = 2600) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), ms); }
function msg(el, t, cls) { const e = $(el); if (!t) { e.classList.add('hidden'); return; } e.className = 'msg ' + cls; e.textContent = t; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const r3 = x => x === null || x === undefined ? null : Math.round(x * 1000) / 1000;
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();

/* ---------------- catálogo desde el Excel ---------------- */
function hoja(wb, nombre, clave) {
  const ws = wb.Sheets[nombre]; if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  const hi = rows.findIndex(r => r.map(x => String(x).trim()).includes(clave)); if (hi < 0) return null;
  const h = rows[hi].map(x => String(x).trim());
  return rows.slice(hi + 1).filter(r => String(r[h.indexOf(clave)] ?? '').trim()).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
async function cargarCatalogo(file) {
  msg('catMsg', 'Leyendo el libro…', 'warn');
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', sheets: ['TIPOS', 'CAMPOS', 'ESTRUCTURAS', 'PANEL', 'VISITAS'], cellFormula: false, cellHTML: false, cellStyles: false });
    const tipos = hoja(wb, 'TIPOS', 'TIPO_ID'), campos = hoja(wb, 'CAMPOS', 'CAMPO_ID'), est = hoja(wb, 'ESTRUCTURAS', 'EST_ID');
    if (!tipos || !campos || !est) throw new Error('El archivo no es el libro REPLANTEO FINAL (faltan las hojas TIPOS, CAMPOS o ESTRUCTURAS).');
    const panel = hoja(wb, 'PANEL', 'PARAMETRO') || [];
    const p = Object.fromEntries(panel.map(r => [String(r.PARAMETRO).trim(), r.VALOR]));
    const tol = num(p.TOLERANCIA_M);
    const vis = hoja(wb, 'VISITAS', 'VISITA_ID') || [];
    const cat = {
      tipos: tipos.map(t => ({ id: String(t.TIPO_ID).trim(), nom: String(t.TIPO), alt: String(t.ALTERNATIVAS || '').trim(), capa: String(t.CAPA || ''),
        planos: String(t.PLANOS || ''), esp: String(t.ESPECIFICACIONES || ''), acc: String(t.ACCESORIOS || ''), pv: String(t.POR_VERIFICAR || ''), notas: String(t.NOTAS || '') })),
      campos: campos.filter(c => String(c.MEDIR || 'SI').trim().toUpperCase() !== 'NO').map(c => ({ id: String(c.CAMPO_ID).trim(), tipo: String(c.TIPO_ID).trim(),
        grupo: String(c.GRUPO || ''), campo: String(c.CAMPO), und: String(c.UND || ''), td: String(c.TIPO_DATO || 'NUM').trim().toUpperCase(),
        dis: c.DISENO === '' ? null : c.DISENO, conf: String(c.CONFIANZA || ''), fuente: String(c.FUENTE || '') })),
      est: est.map(e => ({ id: String(e.EST_ID).trim(), nom: String(e.NOMBRE || ''), comps: String(e.COMPONENTES || '').split(',').map(s => s.trim()).filter(Boolean),
        x: num(e.X_DISENO), y: num(e.Y_DISENO), z: num(e.COTA_DISENO), prog: String(e.PROGRESIVA || ''), benef: String(e.BENEFICIARIO || ''),
        cond: String(e.CONDICION || ''), nota: String(e.NOTA || ''), plano: String(e.PLANO_UBIC || ''), conf: String(e.CONF_UBIC || '') })),
      tol: tol === null ? 0.02 : tol, idsVis: vis.map(r => String(r.VISITA_ID).trim()), file: file.name, cargado: ahoraISO(),
    };
    if (!cat.campos.length) throw new Error('La hoja CAMPOS está vacía.');
    await setMeta('cat', cat); aplicarCatalogo(cat);
    const mias = S.vis.filter(v => S.idsVis.has(v.id)).length;
    msg('catMsg', `✔ ${cat.est.length} estructuras, ${cat.tipos.length} tipos, ${cat.campos.length} campos. Tolerancia ±${fmt(cat.tol, 3)} m. ${cat.idsVis.length} visitas en el Excel (${mias} de este teléfono).`, 'ok');
    renderTodo();
  } catch (e) { console.error(e); msg('catMsg', '✖ ' + (e.message || e), 'err'); }
}
function aplicarCatalogo(cat) {
  S.cat = cat; S.tipo = new Map(cat.tipos.map(t => [t.id, t])); S.campos = new Map(); S.alt = new Map();
  for (const c of cat.campos) { if (!S.campos.has(c.tipo)) S.campos.set(c.tipo, []); S.campos.get(c.tipo).push(c); }
  for (const t of cat.tipos) if (t.alt) { if (!S.alt.has(t.alt)) S.alt.set(t.alt, []); S.alt.get(t.alt).push(t.id); }
  S.idsVis = new Set(cat.idsVis || []);
  reindexEst();
}
function reindexEst() {
  S.est = new Map();
  for (const e of (S.cat ? S.cat.est : [])) S.est.set(e.id, e);
  for (const e of S.nuevas) S.est.set(e.id, { ...e, nueva: true });
}
const campoById = id => { for (const l of S.campos.values()) { const c = l.find(x => x.id === id); if (c) return c; } return null; };

/* ---------------- GPS ---------------- */
function utmDe(lat, lon) { return UTM.aUTM(lat, lon); }
function gpsVivo() {
  if (!navigator.geolocation) { $('gpsLive').textContent = 'GPS no disponible'; return; }
  if (S.watch !== null) return;
  $('gpsLive').textContent = 'GPS: buscando señal…';
  S.watch = navigator.geolocation.watchPosition(p => {
    if (S.prom) S.prom.add(p);
    if (S.trkAct) trkFix(p);
    const u = utmDe(p.coords.latitude, p.coords.longitude);
    S.gps = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, e: u.e, n: u.n, t: Date.now() }; S.gpsRaw = p;
    $('gpsLive').textContent = `E ${u.e.toFixed(1)}  N ${u.n.toFixed(1)}  ±${Math.round(p.coords.accuracy)} m`;
    if ($('eOrden').value === 'cerca' && document.querySelector('#tab-est.active')) renderListaThrottle();
    if (document.querySelector('#tab-ficha.active')) renderDistancia();
  }, err => { $('gpsLive').textContent = 'GPS: ' + (err.code === 1 ? 'permiso denegado (actívelo en el teléfono)' : 'sin señal'); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
let _thr = 0; function renderListaThrottle() { const t = Date.now(); if (t - _thr > 4000) { _thr = t; renderLista(); } }

function gpsPromedio() {
  if (!navigator.geolocation) { toast('GPS no disponible'); return; }
  if (S.prom) { finProm(true); return; }
  const fixes = []; const t0 = Date.now();
  $('btnGpsProm').textContent = '■ Detener y usar';
  const add = p => {
    fixes.push({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy });
    const best = Math.min(...fixes.map(f => f.acc));
    $('fGps').innerHTML = `Midiendo… ${fixes.length} lecturas · mejor ±${Math.round(best)} m · ${Math.max(0, GPS_SEG - Math.round((Date.now() - t0) / 1000))} s`;
    if (Date.now() - t0 > GPS_SEG * 1000) finProm(false);
  };
  S.prom = { fixes, add, t0 };
  $('fGps').innerHTML = 'Midiendo… esperando la primera lectura';
  if (S.gpsRaw && Date.now() - S.gps.t < 3000) add(S.gpsRaw);
  gpsVivo();
  S.prom.timer = setInterval(() => { if (S.prom && Date.now() - t0 > (GPS_SEG + 15) * 1000) finProm(); }, 1000);
}
function finProm() {
  const P = S.prom; if (!P) return; clearInterval(P.timer); S.prom = null;
  $('btnGpsProm').textContent = '📍 Tomar GPS (promedio)';
  const fx = P.fixes; if (!fx.length || !S.v) { renderGpsFicha(); if (!fx.length) toast('No llegó ninguna lectura GPS: salga a cielo abierto e intente de nuevo'); return; }
  const best = Math.min(...fx.map(f => f.acc)); const sel = fx.filter(f => f.acc <= best * 1.5 + 1);
  const w = sel.map(f => 1 / (f.acc * f.acc)), W = w.reduce((a, b) => a + b, 0);
  const lat = sel.reduce((a, f, i) => a + f.lat * w[i], 0) / W, lon = sel.reduce((a, f, i) => a + f.lon * w[i], 0) / W;
  const alts = sel.map(f => f.alt).filter(a => a !== null && a !== undefined);
  const accs = sel.map(f => f.acc).sort((a, b) => a - b), accMed = accs[Math.floor(accs.length / 2)];
  const u = utmDe(lat, lon);
  S.v.gps = { lat: +lat.toFixed(7), lon: +lon.toFixed(7), alt: alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length * 10) / 10 : null,
    acc: Math.round(accMed * 10) / 10, n: sel.length, e: u.e, nn: u.n, t: ahoraISO() };
  cambio(); renderGpsFicha();
}
function renderGpsFicha() {
  const g = S.v && S.v.gps;
  $('fGps').innerHTML = g ? `<b>E ${g.e.toFixed(2)}  N ${g.nn.toFixed(2)}</b> (UTM 18S) · ±${fmt(g.acc, 1)} m · ${g.n} lecturas<br>
    <span class="muted">Lat ${g.lat}, Lon ${g.lon}${g.alt !== null ? ' · altitud GPS ' + g.alt + ' m (referencial)' : ''}</span>${distDiseno(g) !== null ? `<br>Distancia al punto del plano: <b>${fmt(distDiseno(g), 1)} m</b>` : ''}`
    : 'Sin GPS en esta visita.';
}
function distDiseno(g) { const e = S.est0; if (!g || !e || e.x === null || e.y === null) return null; return Math.hypot(g.e - e.x, g.nn - e.y); }
function renderDistancia() {
  const e = S.est0; if (!e) return;
  if (e.x === null || e.y === null) { $('fDis').innerHTML = 'Sin coordenada en el plano: el GPS de esta visita será su ubicación.'; return; }
  let t = `Plano: E ${fmt(e.x, 2)} · N ${fmt(e.y, 2)}${e.z !== null ? ' · cota ' + fmt(e.z, 3) : ''}${e.prog ? ' · prog. ' + esc(e.prog) : ''}${e.conf ? ' <span class="muted">(ubicación ' + esc(e.conf) + ')</span>' : ''}`;
  if (S.gps && Date.now() - S.gps.t < 60000) { const r = UTM.rumbo({ e: S.gps.e, n: S.gps.n }, { e: e.x, n: e.y }); t += `<br>🧭 Usted está a <b>${fmt(r.d, 0)} m</b> — camine hacia el <b>${r.txt}</b> (${Math.round(r.az)}°) · GPS ±${Math.round(S.gps.acc)} m`; }
  $('fDis').innerHTML = t;
}

/* ---------------- lista de estructuras ---------------- */
function visitasDe(id) { return S.vis.filter(v => v.est === id).sort((a, b) => (a.fecha + a.creado).localeCompare(b.fecha + b.creado)); }
function estadoVis(v) { return S.idsVis.has(v.id) && v.estado !== 'pendiente' ? 'car' : v.estado === 'enviado' ? 'env' : 'pend'; }
function estadoEst(id) { const vs = visitasDe(id); if (!vs.length) return 'sin'; return vs.some(v => estadoVis(v) === 'pend') ? 'pend' : 'vis'; }
function renderCats() {
  $('eCats').innerHTML = CATS.map(([k, t]) => `<button class="chip ${S.cat0 === k ? 'on' : ''}" data-k="${k}">${t}</button>`).join('');
}
function renderLista() {
  if (!S.cat) { $('eLista').innerHTML = ''; return; }
  const q = norm($('eBuscar').value).trim(), f = $('eFiltro').value, cerca = $('eOrden').value === 'cerca' && S.gps;
  let L = [...S.est.values()];
  if (S.cat0) L = L.filter(e => catDe(e.id) === S.cat0);
  if (q) { const w = q.split(/\s+/); L = L.filter(e => { const s = norm(e.id + ' ' + e.nom + ' ' + e.benef + ' ' + e.comps.map(c => S.tipo.get(c)?.nom || c).join(' ')); return w.every(x => s.includes(x)); }); }
  if (f === 'sin') L = L.filter(e => estadoEst(e.id) === 'sin'); if (f === 'vis') L = L.filter(e => estadoEst(e.id) !== 'sin');
  if (f === 'pend') L = L.filter(e => estadoEst(e.id) === 'pend'); if (f === 'nueva') L = L.filter(e => e.nueva);
  const dist = e => { if (!S.gps) return null; const v = visitasDe(e.id).filter(v => v.gps).pop(); const x = e.x ?? v?.gps.e, y = e.y ?? v?.gps.nn; return x == null ? null : Math.hypot(S.gps.e - x, S.gps.n - y); };
  L = L.map(e => ({ e, d: dist(e) }));
  if (cerca) L.sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12)); else L.sort((a, b) => a.e.id.localeCompare(b.e.id, 'es', { numeric: true }));
  const todos = [...S.est.values()], vis = todos.filter(e => estadoEst(e.id) !== 'sin').length;
  $('eResumen').textContent = `${L.length} mostradas · ${vis} de ${todos.length} estructuras con visita · ${S.vis.filter(v => estadoVis(v) === 'pend').length} visitas por enviar`;
  $('eLista').innerHTML = L.slice(0, 200).map(({ e, d }) => {
    const st = estadoEst(e.id), vs = visitasDe(e.id), u = vs[vs.length - 1];
    const comps = e.comps.map(c => S.tipo.get(c)?.nom || c);
    return `<div class="est ${st === 'sin' ? '' : st} ${e.nueva ? 'nueva' : ''}" data-id="${esc(e.id)}"><div class="l1"><span class="id">${esc(e.id)}</span>
      <span class="dist">${d !== null ? '📍 ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km') : ''}</span></div>
      <div class="nm">${esc(e.nom)}</div>
      <div class="l3"><span>${esc(comps.length > 2 ? comps.length + ' componentes' : comps.join(' + '))}</span>
      <span>${u ? `${esc(u.estado_obra || 'visitada')} · ${fechaTxt(u.fecha)}${u.fotos.length ? ' · 📷' + u.fotos.length : ''} · <span class="tag ${estadoVis(u)}">${{ pend: 'por enviar', env: 'enviada', car: 'en el Excel' }[estadoVis(u)]}</span>` : 'sin visitar'}</span></div></div>`;
  }).join('') || '<div class="card muted">No hay estructuras para mostrar.</div>';
}

/* ---------------- ficha / visita ---------------- */
function ultimaMedida(estId, campoId, exceptVis) {
  const vs = visitasDe(estId).filter(v => v.id !== exceptVis);
  for (let i = vs.length - 1; i >= 0; i--) { const m = vs[i].med[campoId]; if (m && (m.v !== null && m.v !== undefined || m.verif)) return { m, fecha: vs[i].fecha }; }
  return null;
}
async function abrirFicha(id) {
  const e = S.est.get(id); if (!e) return;
  S.est0 = e;
  const pend = visitasDe(id).filter(v => estadoVis(v) === 'pend').pop();
  S.v = pend ? JSON.parse(JSON.stringify(pend)) : { id: uuid(), est: id, fecha: hoy(), estado_obra: '', avance: null, gps: null, comps: [...e.comps], med: {}, pla: [], fotos: [], obs: '',
    usuario: S.user, creado: ahoraISO(), editado: null, estado: 'nuevo' };
  S.v.guardada = !!pend;
  $('fId').textContent = e.id; $('fNom').textContent = e.nom;
  $('fSub').textContent = [e.cond && 'Condición: ' + e.cond, e.benef && 'Beneficiario: ' + e.benef, e.nueva && 'Agregada en campo'].filter(Boolean).join(' · ');
  $('fNota').classList.toggle('hidden', !e.nota); $('fNota').textContent = e.nota;
  const prev = visitasDe(id).filter(v => v.id !== S.v.id);
  $('fPrev').innerHTML = prev.length ? `Visitas anteriores: ${prev.map(v => `${fechaTxt(v.fecha)} (${esc(v.estado_obra || '—')}, ${Object.keys(v.med).length} medidas)`).join(' · ')}. Las medidas anteriores se muestran como referencia; mida solo lo que cambió.` : '';
  $('vFecha').value = S.v.fecha; $('vEstado').value = S.v.estado_obra; $('vAvance').value = S.v.avance ?? ''; $('vObs').value = S.v.obs;
  $('vAvWrap').classList.toggle('hidden', S.v.estado_obra !== 'POR CONCLUIR');
  msg('vMsg'); renderDistancia(); renderGpsFicha(); renderComps(); renderPla(); await renderFotos();
  $('btnBorrarVis').classList.toggle('hidden', !S.v.guardada);
  cambiarTab('tab-ficha');
  gpsVivo();
}
function renderComps() {
  const v = S.v, tol = S.cat.tol;
  $('fComps').innerHTML = v.comps.map((tid, ci) => {
    const t = S.tipo.get(tid) || { id: tid, nom: tid + ' (tipo no está en el catálogo)', alt: '' };
    const cs = S.campos.get(tid) || [];
    const alts = t.alt ? (S.alt.get(t.alt) || []) : [];
    const n = cs.filter(c => medido(v.med[c.id])).length;
    const grupos = []; for (const c of cs) { let g = grupos.find(x => x.g === c.grupo); if (!g) grupos.push(g = { g: c.grupo, cs: [] }); g.cs.push(c); }
    const plano = [t.planos && `<p><b>Plano:</b> ${esc(t.planos)}</p>`, t.esp && `<p><b>Especificaciones:</b> ${esc(t.esp)}</p>`, t.acc && `<p><b>Accesorios:</b> ${esc(t.acc)}</p>`,
      t.pv && `<p><b>⚠ Por verificar:</b> ${esc(t.pv)}</p>`, t.notas && `<p><b>Notas:</b> ${esc(t.notas)}</p>`].filter(Boolean).join('');
    return `<details class="card comp" ${v.comps.length === 1 || ci === 0 ? 'open' : ''} data-ci="${ci}"><summary><b>${esc(t.nom)}</b><span class="cnt" id="cnt-${ci}">${n}/${cs.length} medidos</span></summary>
      <div class="cbody">
      ${alts.length > 1 ? `<label class="alt">Tipo según lo construido<select data-alt="${ci}">${alts.map(a => `<option value="${a}" ${a === tid ? 'selected' : ''}>${esc(S.tipo.get(a).nom)}</option>`).join('')}</select></label>` : ''}
      ${plano ? `<details class="plano"><summary>Datos del plano</summary>${plano}</details>` : ''}
      ${grupos.map((g, gi) => `<details class="grp" ${grupos.length <= 2 || gi === 0 ? 'open' : ''}><summary>${esc(g.g || 'General')} <span>(${g.cs.length})</span></summary>${g.cs.map(c => filaCampo(c, tol)).join('')}</details>`).join('')}
      ${!cs.length ? '<div class="muted small">Este tipo no tiene medidas de diseño en el plano: use la planilla adicional y las fotos.</div>' : ''}
      <button type="button" class="link" data-quitar="${ci}">Quitar este componente</button>
      </div></details>`;
  }).join('') + `<button type="button" class="btn light small" id="btnAddComp">＋ Agregar componente</button>`;
}
function medido(m) { return !!m && ((m.v !== null && m.v !== undefined) || !!m.verif); }
function filaCampo(c, tol) {
  const m = S.v.med[c.id] || {}, prev = ultimaMedida(S.v.est, c.id, S.v.id);
  const dis = c.dis === null ? '<i>sin dato</i>' : `<b>${esc(typeof c.dis === 'number' ? fmt(c.dis, Number.isInteger(c.dis) && c.und !== 'm' ? 0 : 2) : c.dis)}</b> ${esc(c.und)}`;
  const ref = prev ? `<div class="lc">anterior (${fechaTxt(prev.fecha)}): ${prev.m.v !== null && prev.m.v !== undefined ? fmt(prev.m.v, 2) : esc(prev.m.verif + (prev.m.t ? ' – ' + prev.m.t : ''))}</div>` : '';
  const conf = c.conf && c.conf !== 'alta' ? ` · confianza ${esc(c.conf)}` : '';
  if (c.td === 'NUM') {
    return `<div class="cmp ${medido(m) ? 'med' : ''}" data-c="${c.id}"><div><div class="lb">${esc(c.campo)}</div><div class="ds">Plano: ${dis}${conf}</div>${ref}</div>
      <input inputmode="decimal" data-num="${c.id}" value="${m.v ?? ''}" placeholder="campo" autocomplete="off">
      <div class="df" id="df-${c.id}">${difTxt(c, m.v, tol)}</div></div>`;
  }
  return `<div class="cmp ${medido(m) ? 'med' : ''}" data-c="${c.id}"><div><div class="lb">${esc(c.campo)}</div><div class="ds">Plano: ${dis}${conf}</div>${ref}</div>
    <select data-ver="${c.id}"><option value=""></option>${['CONFORME', 'DIFERENTE', 'NO VISIBLE'].map(o => `<option ${m.verif === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <input class="tx ${m.verif === 'DIFERENTE' ? '' : 'hidden'}" data-txt="${c.id}" value="${esc(m.t || '')}" placeholder="¿Qué se encontró en campo?"></div>`;
}
function difTxt(c, v, tol) {
  if (v === null || v === undefined || typeof c.dis !== 'number') return '';
  const d = v - c.dis, s = (d >= 0 ? '+' : '') + fmt(d, 3) + ' ' + c.und;
  if (c.und !== 'm') return `<span>Diferencia ${s}</span>`;
  return Math.abs(d) <= tol + 1e-9 ? `<span class="ok">✔ Conforme (${s})</span>` : `<span class="no">✖ Diferencia ${s} (tol. ±${fmt(tol, 3)})</span>`;
}
function onCampo(ev) {
  const t = ev.target;
  if (t.dataset.num) {
    const id = t.dataset.num, c = campoById(id), v = num(t.value);
    if (t.value.trim() !== '' && v === null) { t.style.borderColor = 'var(--red)'; return; } t.style.borderColor = '';
    if (v === null) delete S.v.med[id]; else S.v.med[id] = { v };
    const df = $('df-' + id); if (df) { df.innerHTML = difTxt(c, v, S.cat.tol); df.className = 'df'; }
    t.closest('.cmp').classList.toggle('med', v !== null); contar(); cambio();
  } else if (t.dataset.ver) {
    const id = t.dataset.ver;
    if (!t.value) delete S.v.med[id]; else S.v.med[id] = { ...(S.v.med[id] || {}), verif: t.value, v: null };
    const tx = t.parentElement.querySelector('[data-txt]'); tx.classList.toggle('hidden', t.value !== 'DIFERENTE');
    t.closest('.cmp').classList.toggle('med', !!t.value); contar(); cambio();
  } else if (t.dataset.txt) {
    const id = t.dataset.txt; if (S.v.med[id]) S.v.med[id].t = t.value.trim(); cambio();
  }
}
function contar() { S.v.comps.forEach((tid, ci) => { const cs = S.campos.get(tid) || [], e = $('cnt-' + ci); if (e) e.textContent = `${cs.filter(c => medido(S.v.med[c.id])).length}/${cs.length} medidos`; }); }
async function onCompsClick(ev) {
  const b = ev.target.closest('[data-quitar]');
  if (b) { const ci = +b.dataset.quitar; if (!confirm(`¿Quitar «${S.tipo.get(S.v.comps[ci])?.nom || S.v.comps[ci]}» de esta visita? (no borra la estructura)`)) return; S.v.comps.splice(ci, 1); renderComps(); cambio(); return; }
  if (ev.target.id === 'btnAddComp') {
    const id = await elegirTipos('Agregar componente', []); if (!id || !id.length) return;
    S.v.comps.push(...id.filter(x => !S.v.comps.includes(x))); renderComps(); cambio();
  }
}
function onAlt(ev) {
  const s = ev.target; if (!s.dataset.alt) return;
  S.v.comps[+s.dataset.alt] = s.value; renderComps(); cambio(); toast('Tipo cambiado: las medidas de diseño se actualizaron');
}

/* ---------------- planilla adicional ---------------- */
const UNDS = ['m', 'm2', 'm3', 'und', 'ml', 'kg', 'glb'];
function parcial(l) { const v = [l.n, l.l, l.a, l.h].filter(x => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a * b, 1) * 1e4) / 1e4 : null; }
function renderPla() {
  $('plaLista').innerHTML = S.v.pla.map((l, i) => `<div class="pla" data-i="${i}">
    <input class="w2" data-p="d" value="${esc(l.d)}" placeholder="Descripción (ej. Muro de contención)">
    <select class="w1" data-p="u">${UNDS.map(u => `<option ${l.u === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
    ${['n', 'l', 'a', 'h'].map(k => `<input data-p="${k}" inputmode="decimal" value="${l[k] ?? ''}" placeholder="${{ n: 'N° veces', l: 'Largo', a: 'Ancho', h: 'Alto' }[k]}">`).join('')}
    <div class="par"><span>Parcial: <b id="par-${i}">${fmt(parcial(l), 3)}</b> ${esc(l.u)}</span><button type="button" class="link" data-del="${i}">Quitar</button></div></div>`).join('');
}
function onPla(ev) {
  const t = ev.target, row = t.closest('.pla'); if (!row || !t.dataset.p) return;
  const l = S.v.pla[+row.dataset.i], k = t.dataset.p;
  if (k === 'd') l.d = t.value; else if (k === 'u') l.u = t.value; else l[k] = num(t.value);
  $('par-' + row.dataset.i).textContent = fmt(parcial(l), 3); cambio();
}

/* ---------------- fotos ---------------- */
function comprimir(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, FOTO_LADO / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? b.arrayBuffer().then(ok) : ko(new Error('No se pudo procesar la foto')), 'image/jpeg', FOTO_CAL);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Formato de foto no soportado')); };
    img.src = url;
  });
}
function selloDe(f) {
  const e = S.est0, g = S.v.gps || (S.gps && Date.now() - S.gps.t < 120000 ? { e: S.gps.e, nn: S.gps.n, acc: S.gps.acc } : null);
  const d = new Date(f.creado);
  return [`${e.id} · ${e.nom}`.slice(0, 90),
    `${fechaTxt(hoy(d))} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${g ? `UTM 18S  E ${g.e.toFixed(1)}  N ${g.nn.toFixed(1)}  ±${Math.round(g.acc)} m` : 'sin GPS'}`,
    `Resp.: ${S.user || '—'} · Replanteo final – Saneamiento CC.NN. Porotobango`];
}
function camposEditor() {
  const out = [];
  for (const tid of S.v.comps) for (const c of (S.campos.get(tid) || [])) if (c.td === 'NUM')
    out.push({ id: c.id, label: c.campo, corto: c.campo.length > 30 ? c.campo.slice(0, 29) + '…' : c.campo, und: c.und, dis: typeof c.dis === 'number' ? fmt(c.dis, 2) : c.dis,
      med: S.v.med[c.id]?.v ?? null, comp: S.v.comps.length > 1 ? (S.tipo.get(tid)?.nom || tid).split(' (')[0].slice(0, 22) : '' });
  return out;
}
async function agregarFoto(ev) {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  try {
    const orig = await comprimir(file);
    const d = new Date(), est = slug(S.est0.id);
    const base = `REP_${est}_${hoy(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const f = { id: uuid(), vis: S.v.id, est: S.est0.id, base, orig, anot: null, ann: [], stampOn: S.opts.sello, creado: ahoraISO(d), env_o: false, env_a: false };
    const r = await Editor.abrir({ orig, ann: [], stamp: selloDe(f), stampOn: f.stampOn, campos: camposEditor(), onCota: setDesdeFoto, nueva: true });
    if (r && r.accion === 'descartar') return;
    if (r && r.accion === 'guardar') { f.anot = r.anot; f.ann = r.ann; f.stampOn = r.stampOn; }
    else if (f.stampOn) f.anot = await Editor.renderSinEditor(orig, [], selloDe(f), true);
    await put('fotos', f); S.v.fotos.push(f.id);
    await guardarVisita(true); renderComps(); await renderFotos();
  } catch (e) { console.error(e); toast(e.message); }
}
function setDesdeFoto(campoId, v) { S.v.med[campoId] = { v }; }
async function editarFoto(fid) {
  const f = await get1('fotos', fid); if (!f) return;
  const r = await Editor.abrir({ orig: f.orig, ann: f.ann, stamp: selloDe(f), stampOn: f.stampOn, campos: camposEditor(), onCota: setDesdeFoto, nueva: false });
  if (r && r.accion === 'guardar') { f.anot = r.anot; f.ann = r.ann; f.stampOn = r.stampOn; f.env_a = false; await put('fotos', f); }
  await guardarVisita(true); renderComps(); await renderFotos();
}
const _urls = [];
async function renderFotos() {
  _urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  let h = '';
  for (const fid of S.v.fotos) {
    const f = await get1('fotos', fid); if (!f) continue;
    const u = URL.createObjectURL(new Blob([f.anot || f.orig], { type: 'image/jpeg' })); _urls.push(u);
    h += `<div data-f="${fid}"><img src="${u}">${f.ann.length ? `<span class="an">✎${f.ann.length}</span>` : ''}<button type="button" data-q="${fid}">×</button></div>`;
  }
  $('fThumbs').innerHTML = h || '<span class="muted small">Sin fotos.</span>';
}
async function onThumbs(ev) {
  const q = ev.target.closest('[data-q]');
  if (q) { if (!confirm('¿Eliminar esta foto (original y anotada)?')) return; await del('fotos', q.dataset.q); S.v.fotos = S.v.fotos.filter(x => x !== q.dataset.q); await guardarVisita(true); await renderFotos(); return; }
  const d = ev.target.closest('[data-f]'); if (d) editarFoto(d.dataset.f);
}

/* ---------------- guardar ---------------- */
let _deb = null;
function cambio() { clearTimeout(_deb); _deb = setTimeout(() => guardarVisita(true), 900); }
function leerVisita() {
  const v = S.v; v.fecha = $('vFecha').value || hoy(); v.estado_obra = $('vEstado').value; v.avance = num($('vAvance').value); v.obs = $('vObs').value.trim();
}
async function guardarVisita(auto) {
  clearTimeout(_deb); const v = S.v; if (!v) return;
  leerVisita();
  const vacio = !Object.keys(v.med).length && !v.gps && !v.fotos.length && !v.estado_obra && !v.obs && !v.pla.some(l => l.d || parcial(l) !== null);
  if (auto && vacio && !v.guardada) return;
  if (!S.user) { if (!auto) { toast('Primero escriba su nombre en Ajustes'); cambiarTab('tab-cfg'); } return; }
  const enviada = v.estado === 'enviado';
  v.usuario = v.usuario || S.user; if (v.guardada) v.editado = ahoraISO(); v.estado = 'pendiente'; v.guardada = true;
  const { guardada, ...rec } = v; await put('vis', JSON.parse(JSON.stringify(rec)));
  const i = S.vis.findIndex(x => x.id === v.id); if (i >= 0) S.vis[i] = JSON.parse(JSON.stringify(rec)); else S.vis.push(JSON.parse(JSON.stringify(rec)));
  if (enviada && !auto) toast('La visita ya se había enviado: quedará pendiente para reenviarla');
  $('btnBorrarVis').classList.remove('hidden'); renderBadge();
}
async function guardarYSalir() {
  leerVisita();
  if (!S.v.estado_obra) { msg('vMsg', 'Elija el estado de la estructura (construida / por concluir / no ejecutada).', 'err'); $('vEstado').focus(); return; }
  await guardarVisita(false); if (!S.user) return;
  const n = Object.keys(S.v.med).length;
  toast(`✔ ${S.est0.id}: ${n} medidas, ${S.v.fotos.length} fotos${S.v.gps ? ', con GPS' : ', SIN GPS'}`);
  S.v = null; S.est0 = null; cambiarTab('tab-est');
}
async function borrarVisita() {
  const v = S.v; if (!v || !confirm(`¿Eliminar esta visita de ${v.est} y sus fotos del teléfono?` + (S.idsVis.has(v.id) ? '\n(Ya está en el Excel: allí no se borra.)' : ''))) return;
  for (const fid of v.fotos) await del('fotos', fid);
  await del('vis', v.id); S.vis = S.vis.filter(x => x.id !== v.id); S.v = null; toast('Visita eliminada'); cambiarTab('tab-est');
}

/* ---------------- modal: elegir tipos / nueva estructura ---------------- */
function modal(html) { $('mcard').innerHTML = html; $('modal').classList.remove('hidden'); }
function cerrarModal() { $('modal').classList.add('hidden'); $('mcard').innerHTML = ''; }
function elegirTipos(titulo, marcados) {
  return new Promise(ok => {
    modal(`<h3>${esc(titulo)}</h3><input id="mq" type="search" placeholder="Filtrar tipos"><div class="mlist" id="ml">${S.cat.tipos.map(t => `<label data-n="${esc(norm(t.nom + ' ' + t.id))}"><input type="checkbox" value="${t.id}" ${marcados.includes(t.id) ? 'checked' : ''}>${esc(t.nom)}</label>`).join('')}</div>
      <div class="actions"><button class="btn primary" id="mok">Aceptar</button><button class="btn light" id="mno">Cancelar</button></div>`);
    $('mq').oninput = e => { const q = norm(e.target.value); $('ml').querySelectorAll('label').forEach(l => l.classList.toggle('hidden', !l.dataset.n.includes(q))); };
    $('mok').onclick = () => { const v = [...$('ml').querySelectorAll('input:checked')].map(i => i.value); cerrarModal(); ok(v); };
    $('mno').onclick = () => { cerrarModal(); ok(null); };
  });
}
async function nuevaEstructura() {
  if (!S.cat) { toast('Primero cargue el catálogo'); return; }
  const comps = await elegirTipos('Nueva estructura: ¿qué tipo es?', []); if (!comps || !comps.length) return;
  const pref = (comps[0].split('_')[0] || 'EST').replace('GEN', 'EST');
  let k = 1, id; do { id = `${pref}-N${pad(k++)}`; } while (S.est.has(id));
  modal(`<h3>Nueva estructura</h3><label>Código<input id="nId" value="${id}"></label><label>Nombre / referencia<input id="nNom" placeholder="Ej. Válvula de purga junto a quebrada"></label>
    <div class="actions"><button class="btn primary" id="mok">Crear y abrir ficha</button><button class="btn light" id="mno">Cancelar</button></div>`);
  $('mno').onclick = cerrarModal;
  $('mok').onclick = async () => {
    const nid = $('nId').value.trim().toUpperCase(); if (!nid) return; if (S.est.has(nid)) { alert('Ese código ya existe.'); return; }
    const e = { id: nid, nom: $('nNom').value.trim() || S.tipo.get(comps[0]).nom, comps, x: null, y: null, z: null, prog: '', benef: '', cond: '', nota: 'Agregada en campo (no figura en el catálogo del Excel).', plano: '', conf: '', creado: ahoraISO() };
    await put('est', e); S.nuevas.push(e); reindexEst(); cerrarModal(); abrirFicha(nid);
  };
}

/* ---------------- recorrido ---------------- */
function largo(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].e - pts[i - 1].e, pts[i].n - pts[i - 1].n); return d; }
async function pedirWake() { try { if ('wakeLock' in navigator) S.wake = await navigator.wakeLock.request('screen'); } catch (e) { S.wake = null; } }
async function trkIniciar(t) {
  if (!navigator.geolocation) { toast('GPS no disponible'); return; }
  if (!S.user) { toast('Primero escriba su nombre en Ajustes'); cambiarTab('tab-cfg'); return; }
  if (!t) {
    const tramo = $('tTramo').value.trim(); if (!tramo) { toast('Escriba el nombre del tramo'); $('tTramo').focus(); return; }
    t = { id: uuid(), tramo, diam: $('tDiam').value.trim(), mat: $('tMat').value, clase: $('tClase').value.trim(), paso: num($('tPaso').value) || 5,
      pts: [], inicio: ahoraISO(), fin: null, estado: 'pendiente', usuario: S.user };
    S.trk.push(t);
  } else { t.estado = 'pendiente'; t.fin = null; }
  await put('trk', t); S.trkAct = t; await pedirWake();
  gpsVivo();
  $('btnTrkIni').disabled = true; $('btnTrkFin').disabled = false; $('btnTrkPto').disabled = false; renderTrkEstado(); renderTrks();
}
function trkFix(p) {
  const c = p.coords, u = utmDe(c.latitude, c.longitude);
  S.trkUlt = { lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, e: u.e, n: u.n, t: ahoraISO() };
  const A = S.trkAct; if (!A) return;
  if (c.accuracy <= TRK_ACC_MAX) {
    const last = A.pts.filter(x => x.tipo === 'TRAZO').pop();
    if (!last || Math.hypot(u.e - last.e, u.n - last.n) >= A.paso) { A.pts.push({ ...S.trkUlt, tipo: 'TRAZO', obs: '' }); put('trk', A); }
  }
  renderTrkEstado();
}
async function trkTerminar() {
  try { S.wake && S.wake.release(); } catch (e) { /* nada */ } S.wake = null;
  if (S.trkAct) { S.trkAct.fin = ahoraISO(); await put('trk', S.trkAct); toast(`Recorrido guardado: ${S.trkAct.pts.length} puntos, ${fmt(largo(S.trkAct.pts), 1)} m`); }
  S.trkAct = null; $('btnTrkIni').disabled = false; $('btnTrkFin').disabled = true; $('btnTrkPto').disabled = true; renderTrkEstado(); renderTrks(); renderBadge();
}
async function trkPunto() {
  const A = S.trkAct, u = S.trkUlt; if (!A || !u) { toast('Esperando señal GPS…'); return; }
  const tipo = $('tPtoTipo').value, obs = (prompt(`${tipo}: observación (opcional)`, '') || '').trim();
  A.pts.push({ ...u, tipo, obs }); await put('trk', A); toast(`📌 ${tipo} marcado (±${Math.round(u.acc)} m)`); renderTrkEstado();
}
function renderTrkEstado() {
  const A = S.trkAct, u = S.trkUlt;
  $('tEstado').innerHTML = A ? `<b>Grabando:</b> ${esc(A.tramo)} · ${A.pts.length} puntos · ${fmt(largo(A.pts.filter(p => p.tipo === 'TRAZO')), 1)} m<br>${u ? `Última lectura ±${Math.round(u.acc)} m ${u.acc > TRK_ACC_MAX ? '(se ignora: precisión baja)' : ''}` : 'Esperando señal GPS…'}${S.wake ? ' · pantalla encendida' : ''}` : 'Sin recorrido activo.';
}
function renderTrks() {
  const L = [...S.trk].sort((a, b) => b.inicio.localeCompare(a.inicio));
  $('tLista').innerHTML = L.map(t => `<div class="rec ${t.estado === 'enviado' ? 'env' : ''}"><div class="l1"><span class="code">${esc(t.tramo)}</span><span class="met">${fmt(largo(t.pts.filter(p => p.tipo === 'TRAZO')), 1)} m</span></div>
    <div class="d">${esc([t.diam && 'Ø' + t.diam, t.mat, t.clase].filter(Boolean).join(' · '))} · ${t.pts.length} puntos (${t.pts.filter(p => p.tipo !== 'TRAZO').length} marcados)</div>
    <div class="l3"><span>${fechaTxt(t.inicio)} ${t.inicio.slice(11, 16)}${t.fin ? '–' + t.fin.slice(11, 16) : ' (en curso)'}</span><span class="tag ${t.estado === 'enviado' ? 'env' : ''}">${t.estado === 'enviado' ? 'enviado' : 'por enviar'}</span></div>
    <div class="btns">${S.trkAct ? '' : `<button data-tc="${t.id}">Continuar</button>`}<button data-td="${t.id}">Eliminar</button></div></div>`).join('');
}
async function onTrks(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tc) { const t = S.trk.find(x => x.id === b.dataset.tc); if (t) trkIniciar(t); }
  if (b.dataset.td) { const t = S.trk.find(x => x.id === b.dataset.td); if (!t || !confirm(`¿Eliminar el recorrido «${t.tramo}»?`)) return; await del('trk', t.id); S.trk = S.trk.filter(x => x !== t); renderTrks(); renderBadge(); }
}

/* ---------------- envío ---------------- */
function csv(cols, rows) {
  const c = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map(r => cols.map(k => c(r[k])).join(','))].join('\r\n') + '\r\n';
}
async function filasVisita(v) {
  const e = S.est.get(v.est) || { id: v.est, nom: '', comps: [] };
  const fotos = []; for (const fid of v.fotos) { const f = await get1('fotos', fid); if (f) { if (f.anot) fotos.push(f.base + '.jpg'); if (S.opts.orig || !f.anot) fotos.push(f.base + '_ORIG.jpg'); } }
  const g = v.gps; const dd = g && e.x != null ? Math.round(Math.hypot(g.e - e.x, g.nn - e.y) * 100) / 100 : null;
  const meds = [];
  for (const tid of v.comps) for (const c of (S.campos.get(tid) || [])) {
    const m = v.med[c.id]; if (!medido(m)) continue;
    const dif = c.td === 'NUM' && typeof c.dis === 'number' && m.v !== null && m.v !== undefined ? r3(m.v - c.dis) : null;
    meds.push({ MED_ID: v.id + '|' + c.id, VISITA_ID: v.id, FECHA: v.fecha, EST_ID: v.est, TIPO_ID: tid, CAMPO_ID: c.id, GRUPO: c.grupo, CAMPO: c.campo, UND: c.und,
      TIPO_DATO: c.td, DISENO: c.dis, MEDIDO: m.v ?? null, DIFERENCIA: dif, VERIFICACION: m.verif || '', TEXTO_CAMPO: m.t || '', USUARIO: v.usuario, CREADO: v.creado });
  }
  const pla = v.pla.filter(l => l.d || parcial(l) !== null).map((l, i) => ({ LIN_ID: v.id + '|' + (i + 1), VISITA_ID: v.id, FECHA: v.fecha, EST_ID: v.est, ITEM: i + 1, DESCRIPCION: l.d,
    UND: l.u, N_VECES: l.n, LARGO: l.l, ANCHO: l.a, ALTO: l.h, PARCIAL: parcial(l), USUARIO: v.usuario }));
  const vis = { VISITA_ID: v.id, FECHA: v.fecha, EST_ID: v.est, NOMBRE: e.nom, NUEVA: e.nueva ? 'SI' : '', COMPONENTES: v.comps.join(','), ESTADO_OBRA: v.estado_obra, AVANCE: v.avance,
    LATITUD: g?.lat, LONGITUD: g?.lon, ALTITUD: g?.alt, PRECISION_M: g?.acc, N_LECTURAS: g?.n, ESTE: g ? g.e.toFixed(3) : null, NORTE: g ? g.nn.toFixed(3) : null, DIST_DISENO_M: dd,
    OBSERVACION: v.obs, FOTOS: fotos.join(' | '), N_MEDIDAS: meds.length, USUARIO: v.usuario, CREADO: v.creado, EDITADO: v.editado };
  return { vis, meds, pla };
}
function filasTrk(t) {
  let acc = 0, prev = null;
  return t.pts.map((p, i) => { if (prev && p.tipo === 'TRAZO') acc += Math.hypot(p.e - prev.e, p.n - prev.n); if (p.tipo === 'TRAZO') prev = p;
    return { TRK_ID: t.id, TRAMO: t.tramo, DIAMETRO: t.diam, MATERIAL: t.mat, CLASE: t.clase, PTO_N: i + 1, FECHA_HORA: p.t, TIPO_PTO: p.tipo, OBS: p.obs,
      LATITUD: +p.lat.toFixed(7), LONGITUD: +p.lon.toFixed(7), ALTITUD: p.alt === null || p.alt === undefined ? null : Math.round(p.alt * 10) / 10, PRECISION_M: Math.round(p.acc * 10) / 10,
      ESTE: p.e.toFixed(3), NORTE: p.n.toFixed(3), DIST_ACUM_M: Math.round(acc * 100) / 100, USUARIO: t.usuario }; });
}
async function fotosPendientes() {
  const out = [];
  for (const f of (await getAll('fotos')).sort((a, b) => a.base.localeCompare(b.base))) {
    if (f.anot && !f.env_a) out.push({ f, k: 'a', file: new File([f.anot], f.base + '.jpg', { type: 'image/jpeg' }) });
    if ((S.opts.orig || !f.anot) && !f.env_o) out.push({ f, k: 'o', file: new File([f.orig], f.base + '_ORIG.jpg', { type: 'image/jpeg' }) });
  }
  return out;
}
async function prepararEnvio() {
  const pv = S.vis.filter(v => v.estado === 'pendiente').sort((a, b) => a.creado.localeCompare(b.creado));
  const pt = S.trk.filter(t => t.estado === 'pendiente' && t !== S.trkAct && t.pts.length);
  const V = [], M = [], P = [], T = [];
  for (const v of pv) { const r = await filasVisita(v); V.push(r.vis); M.push(...r.meds); P.push(...r.pla); }
  for (const t of pt) T.push(...filasTrk(t));
  const d = new Date(), stamp = `${hoy(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`, user = slug(S.user) || 'USUARIO';
  const files = [];
  if (V.length) files.push(new File([csv(COLS.vis, V)], `rep_vis_${stamp}_${user}.csv`, { type: 'text/csv' }));
  if (M.length) files.push(new File([csv(COLS.med, M)], `rep_med_${stamp}_${user}.csv`, { type: 'text/csv' }));
  if (P.length) files.push(new File([csv(COLS.pla, P)], `rep_pla_${stamp}_${user}.csv`, { type: 'text/csv' }));
  if (T.length) files.push(new File([csv(COLS.trk, T)], `rep_trk_${stamp}_${user}.csv`, { type: 'text/csv' }));
  const fp = await fotosPendientes();
  S.prep = { pv, pt, files, fp, lote: fp.slice(0, FOTOS_POR_ENVIO) };
  const mb = (fp.reduce((a, x) => a + x.file.size, 0) / 1048576).toFixed(1);
  $('sendResumen').innerHTML = `<b>${pv.length}</b> visitas (${M.length} medidas, ${P.length} líneas de planilla) · <b>${pt.length}</b> recorridos (${T.length} puntos)<br>
    ${files.length ? 'Archivos: ' + files.map(f => `<i>${esc(f.name)}</i>`).join(', ') : 'Nada pendiente.'}<br><b>${fp.length}</b> fotos por enviar (${mb} MB), en grupos de ${FOTOS_POR_ENVIO}.`;
  $('btnEnviarDatos').disabled = !files.length; $('btnEnviarFotos').disabled = !fp.length;
  $('btnEnviarFotos').textContent = fp.length ? `2. Enviar fotos (${Math.min(FOTOS_POR_ENVIO, fp.length)} de ${fp.length})` : '2. Enviar fotos';
}
function puedeCompartir(files) { try { return !!(navigator.canShare && navigator.canShare({ files })); } catch (e) { return false; } }
function descargar(file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
async function compartir(files, titulo) {
  if (puedeCompartir(files)) { try { await navigator.share({ files, title: titulo }); return true; } catch (e) { if (e.name === 'AbortError') return false; throw e; } }
  files.forEach(descargar);
  return confirm('Los archivos se descargaron. ¿Ya los subió a Google Drive → REPLANTEO POROTOBANGO?');
}
async function enviarDatos() {
  const P = S.prep; if (!P || !P.files.length) return; msg('sendMsg');
  try {
    if (!await compartir(P.files, 'Replanteo — datos')) { msg('sendMsg', 'Envío cancelado. Todo sigue pendiente.', 'warn'); return; }
    if (!confirm('¿Guardó los archivos en Google Drive → REPLANTEO POROTOBANGO? (Aceptar = marcar como enviados)')) { msg('sendMsg', 'No se marcó nada: puede volver a enviar.', 'warn'); return; }
    const lote = { id: uuid(), cuando: ahoraISO(), nv: P.pv.length, nt: P.pt.length, files: P.files.map(f => f.name), ids: P.pv.map(v => v.id) };
    for (const v of P.pv) { v.estado = 'enviado'; v.lote = lote.id; await put('vis', v); }
    for (const t of P.pt) { t.estado = 'enviado'; await put('trk', t); }
    S.lotes.unshift(lote); await setMeta('lotes', S.lotes.slice(0, 200));
    msg('sendMsg', `✔ Enviado: ${P.pv.length} visitas y ${P.pt.length} recorridos. Ahora envíe las fotos. En la PC: Datos → Actualizar todo.`, 'ok');
  } catch (e) { msg('sendMsg', '✖ No se pudo compartir: ' + e.message, 'err'); }
  renderTodo();
}
async function enviarFotos() {
  const P = S.prep; if (!P || !P.lote.length) return;
  try {
    if (!await compartir(P.lote.map(x => x.file), 'Replanteo — fotos')) { msg('sendMsg', 'Envío de fotos cancelado.', 'warn'); return; }
    for (const x of P.lote) { const f = await get1('fotos', x.f.id); if (f) { if (x.k === 'a') f.env_a = true; else f.env_o = true; await put('fotos', f); } }
    msg('sendMsg', `✔ ${P.lote.length} fotos enviadas.` + (P.fp.length > P.lote.length ? ' Toque otra vez para el siguiente grupo.' : ''), 'ok');
  } catch (e) { msg('sendMsg', '✖ No se pudo compartir: ' + e.message, 'err'); }
  renderTodo();
}
function renderLotes() {
  $('lotes').innerHTML = S.lotes.length ? S.lotes.slice(0, 30).map(l => { const car = l.ids.filter(i => S.idsVis.has(i)).length;
    return `<div class="lote">${l.cuando.replace('T', ' ')} · <b>${l.nv}</b> visitas · <b>${l.nt}</b> recorridos · ${l.nv && car === l.nv ? '✔ en el Excel' : car ? car + ' en el Excel' : 'aún no confirmado en el Excel'}<br><span class="muted">${esc(l.files.join(', '))}</span></div>`; }).join('')
    : '<span class="muted">Aún no hay envíos.</span>';
}

/* ---------------- exportar (AutoCAD / KML / PENZD) ---------------- */
const CAPA_COLOR = { 'REP-UBS': 3, 'REP-PASES': 4, 'REP-VALVULAS': 1, 'REP-CAPTACION': 5, 'REP-TRATAMIENTO': 6, 'REP-ALMACENAMIENTO': 30, 'REP-CERCOS': 8, 'REP-OTROS': 7, 'REP-BM': 2, 'REP-RECORRIDO': 140, 'REP-RECORRIDO-PTOS': 1 };
function puntosCampo() {
  const out = [];
  for (const e of S.est.values()) {
    const v = visitasDe(e.id).filter(x => x.gps).pop(); if (!v) continue;
    out.push({ e, v, capa: (S.tipo.get(e.comps[0])?.capa) || 'REP-OTROS' });
  }
  return out.sort((a, b) => a.e.id.localeCompare(b.e.id, 'es', { numeric: true }));
}
const ascii = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/°/g, ' gr').replace(/[^\x20-\x7e]/g, '');
function exportScr() {
  const P = puntosCampo(), T = S.trk.filter(t => t.pts.length > 1);
  if (!P.length && !T.length) { toast('No hay puntos GPS ni recorridos en este teléfono'); return; }
  const L = ['_.CMDECHO 0', '_.OSMODE 0', '_.PDMODE 35', '_.PDSIZE 0.8'];
  const capas = [...new Set([...P.map(p => p.capa), ...(T.length ? ['REP-RECORRIDO', 'REP-RECORRIDO-PTOS'] : [])])];
  for (const c of capas) L.push(`_.-LAYER _M ${c} _C ${CAPA_COLOR[c] || 7} ${c}`, '');
  let cur = '';
  const capa = c => { if (c !== cur) { L.push(`_.-LAYER _S ${c}`, ''); cur = c; } };
  for (const p of P) { capa(p.capa); const g = p.v.gps; L.push(`_.POINT ${g.e.toFixed(3)},${g.nn.toFixed(3)}`, `_.-TEXT ${(g.e + 0.8).toFixed(3)},${(g.nn + 0.8).toFixed(3)} 1.0 0 ${ascii(p.e.id)}`); }
  for (const t of T) {
    capa('REP-RECORRIDO'); L.push('_.PLINE'); for (const p of t.pts.filter(p => p.tipo === 'TRAZO')) L.push(`${p.e.toFixed(3)},${p.n.toFixed(3)}`); L.push('');
    capa('REP-RECORRIDO-PTOS'); for (const p of t.pts.filter(p => p.tipo !== 'TRAZO')) L.push(`_.POINT ${p.e.toFixed(3)},${p.n.toFixed(3)}`, `_.-TEXT ${(p.e + 0.6).toFixed(3)},${(p.n + 0.6).toFixed(3)} 0.8 0 ${ascii(p.tipo + (p.obs ? ' - ' + p.obs.replace(/[\r\n]/g, ' ') : ''))}`);
  }
  L.push('_.ZOOM _E', '_.CMDECHO 1');
  compartir([new File([L.join('\r\n') + '\r\n'], `REPLANTEO_${hoy().replace(/-/g, '')}.scr`, { type: 'text/plain' })], 'Script AutoCAD').catch(e => toast(e.message));
}
function exportKml() {
  const P = puntosCampo(), T = S.trk.filter(t => t.pts.length > 1);
  const pm = (nm, d, lat, lon, st) => `<Placemark><name>${esc(nm)}</name><description>${esc(d)}</description><styleUrl>#${st}</styleUrl><Point><coordinates>${lon.toFixed(7)},${lat.toFixed(7)},0</coordinates></Point></Placemark>`;
  const dis = [...S.est.values()].filter(e => e.x != null).map(e => { const g = UTM.aGeo(e.x, e.y); return pm(e.id, `PLANO · ${e.nom}`, g.lat, g.lon, 'dis'); });
  const cam = P.map(p => pm(p.e.id, `CAMPO ${fechaTxt(p.v.fecha)} · ${p.e.nom} · ${p.v.estado_obra} · ±${p.v.gps.acc} m`, p.v.gps.lat, p.v.gps.lon, 'cam'));
  const lin = T.map(t => `<Placemark><name>${esc(t.tramo)}</name><description>${esc([t.diam && 'Ø' + t.diam, t.mat, t.clase].filter(Boolean).join(' · '))}</description><styleUrl>#trk</styleUrl><LineString><tessellate>1</tessellate><coordinates>${t.pts.filter(p => p.tipo === 'TRAZO').map(p => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},0`).join(' ')}</coordinates></LineString></Placemark>`
    + t.pts.filter(p => p.tipo !== 'TRAZO').map(p => pm(p.tipo, p.obs || t.tramo, p.lat, p.lon, 'pto')).join(''));
  const k = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Replanteo Porotobango ${hoy()}</name>
<Style id="dis"><IconStyle><color>ff00a5ff</color><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="cam"><IconStyle><color>ff00ff00</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>
<Style id="pto"><IconStyle><color>ff0000ff</color><scale>0.7</scale></IconStyle></Style>
<Style id="trk"><LineStyle><color>ffff7f00</color><width>3</width></LineStyle></Style>
<Folder><name>Plano (diseño)</name>${dis.join('')}</Folder><Folder><name>Campo (GPS)</name>${cam.join('')}</Folder><Folder><name>Recorridos</name>${lin.join('')}</Folder></Document></kml>\n`;
  compartir([new File([k], `REPLANTEO_${hoy().replace(/-/g, '')}.kml`, { type: 'application/vnd.google-earth.kml+xml' })], 'KML').catch(e => toast(e.message));
}
function exportPenz() {
  const P = puntosCampo(); let n = 0; const L = [];
  for (const p of P) L.push([++n, p.v.gps.nn.toFixed(3), p.v.gps.e.toFixed(3), p.v.gps.alt ?? 0, p.e.id].join(','));
  for (const t of S.trk) for (const p of t.pts.filter(p => p.tipo !== 'TRAZO')) L.push([++n, p.n.toFixed(3), p.e.toFixed(3), p.alt ?? 0, (p.tipo + (p.obs ? ' ' + p.obs : '')).replace(/,/g, ' ')].join(','));
  if (!L.length) { toast('No hay puntos GPS en este teléfono'); return; }
  compartir([new File([L.join('\r\n') + '\r\n'], `PUNTOS_PENZD_${hoy().replace(/-/g, '')}.csv`, { type: 'text/csv' })], 'Puntos').catch(e => toast(e.message));
}

/* ---------------- ajustes ---------------- */
async function renderCfg() {
  $('cfgUsuario').value = S.user; $('cfgOrig').checked = S.opts.orig; $('cfgSello').checked = S.opts.sello;
  $('catInfo').innerHTML = S.cat ? `✔ <b>${S.cat.est.length}</b> estructuras · ${S.cat.tipos.length} tipos · ${S.cat.campos.length} campos · tolerancia ±${fmt(S.cat.tol, 3)} m<br>Archivo: ${esc(S.cat.file)} · cargado ${S.cat.cargado.replace('T', ' ')}` : '<b style="color:var(--red)">Sin catálogo</b>';
  const fotos = await getAll('fotos'); let t = `Visitas: ${S.vis.length} · fotos: ${fotos.length} · recorridos: ${S.trk.length}`;
  if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); t += ` · espacio usado ${(e.usage / 1048576).toFixed(1)} MB`; }
  $('stoInfo').textContent = t;
}
async function liberar() {
  const fotos = (await getAll('fotos')).filter(f => (!f.anot || f.env_a) && (f.env_o || (!S.opts.orig && f.anot)) && S.idsVis.has(f.vis));
  if (!fotos.length) { toast('No hay fotos enviadas y confirmadas en el Excel para borrar'); return; }
  if (!confirm(`Se borrarán del teléfono ${fotos.length} fotos ya enviadas cuyas visitas están en el Excel. ¿Continuar?`)) return;
  for (const f of fotos) { await del('fotos', f.id); const v = S.vis.find(x => x.id === f.vis); if (v) { v.fotos = v.fotos.filter(x => x !== f.id); await put('vis', v); } }
  toast(`${fotos.length} fotos borradas`); renderCfg();
}
function respaldo() {
  const f = new File([JSON.stringify({ version: APP_VERSION, usuario: S.user, exportado: ahoraISO(), visitas: S.vis, nuevas: S.nuevas, recorridos: S.trk }, null, 1)], `respaldo_replanteo_${hoy()}.json`, { type: 'application/json' });
  compartir([f], f.name).catch(e => toast(e.message));
}

/* ---------------- navegación y arranque ---------------- */
async function cambiarTab(id) {
  if (document.querySelector('#tab-ficha.active') && id !== 'tab-ficha' && S.v) { await guardarVisita(true); S.v = null; }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === id));
  const nav = id === 'tab-ficha' ? 'tab-est' : id;
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === nav));
  if (id === 'tab-est') renderLista(); if (id === 'tab-trk') { renderTrks(); renderTrkEstado(); renderDlTramos(); }
  if (id === 'tab-send') { prepararEnvio(); renderLotes(); } if (id === 'tab-cfg') renderCfg();
  window.scrollTo(0, 0);
}
function renderDlTramos() {
  const s = new Set(S.trk.map(t => t.tramo)); $('dlTramos').innerHTML = [...s].map(t => `<option value="${esc(t)}">`).join('');
}
function renderBadge() {
  const n = S.vis.filter(v => v.estado === 'pendiente').length + S.trk.filter(t => t.estado === 'pendiente' && t.pts.length).length;
  $('pendBadge').textContent = n || '';
  $('hdrInfo').textContent = `${S.user || 'sin responsable'} · ${S.cat ? S.est.size + ' estructuras' : 'sin catálogo'} · ${n} por enviar`;
}
function renderTodo() {
  renderBadge(); $('noCat').classList.toggle('hidden', !!S.cat); renderCats();
  const act = document.querySelector('.tab.active').id;
  if (act === 'tab-est') renderLista(); if (act === 'tab-send') { prepararEnvio(); renderLotes(); } if (act === 'tab-cfg') renderCfg(); if (act === 'tab-trk') renderTrks();
}
function red() { const on = navigator.onLine, b = $('netBadge'); b.textContent = on ? 'con señal' : 'sin señal'; b.className = 'badge ' + (on ? 'on' : 'off'); }

async function init() {
  $('ver').textContent = APP_VERSION;
  DB = await idb();
  S.vis = await getAll('vis'); S.trk = await getAll('trk'); S.nuevas = await getAll('est');
  S.user = (await getMeta('user')) || ''; S.lotes = (await getMeta('lotes')) || []; S.opts = { ...S.opts, ...((await getMeta('opts')) || {}) };
  const cat = await getMeta('cat'); if (cat) aplicarCatalogo(cat); else reindexEst();
  // un recorrido que quedó abierto (app cerrada) se marca como terminado
  for (const t of S.trk) if (!t.fin) { t.fin = t.pts.length ? t.pts[t.pts.length - 1].t : t.inicio; await put('trk', t); }
  document.querySelectorAll('nav.bottom button').forEach(b => b.onclick = () => cambiarTab(b.dataset.tab));
  $('eBuscar').oninput = renderLista; $('eFiltro').onchange = renderLista;
  $('eOrden').onchange = () => { if ($('eOrden').value === 'cerca') gpsVivo(); renderLista(); };
  $('eCats').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; S.cat0 = b.dataset.k; renderCats(); renderLista(); };
  $('eLista').onclick = e => { const d = e.target.closest('[data-id]'); if (d) abrirFicha(d.dataset.id); };
  $('btnGpsLive').onclick = gpsVivo; $('btnNueva').onclick = nuevaEstructura;
  $('btnVolver').onclick = () => cambiarTab('tab-est');
  $('btnGpsProm').onclick = gpsPromedio; $('btnGpsQuitar').onclick = () => { if (S.v && S.v.gps && confirm('¿Quitar el GPS de esta visita?')) { S.v.gps = null; renderGpsFicha(); cambio(); } };
  $('vEstado').onchange = () => { $('vAvWrap').classList.toggle('hidden', $('vEstado').value !== 'POR CONCLUIR'); msg('vMsg'); cambio(); };
  ['vFecha', 'vAvance', 'vObs'].forEach(i => $(i).oninput = cambio);
  $('fComps').addEventListener('input', onCampo); $('fComps').addEventListener('change', e => { if (e.target.dataset.alt) onAlt(e); else if (e.target.dataset.ver) onCampo(e); });
  $('fComps').addEventListener('click', onCompsClick);
  $('btnPla').onclick = () => { S.v.pla.push({ d: '', u: 'm3', n: null, l: null, a: null, h: null }); renderPla(); };
  $('plaLista').addEventListener('input', onPla); $('plaLista').addEventListener('change', onPla);
  $('plaLista').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; S.v.pla.splice(+b.dataset.del, 1); renderPla(); cambio(); });
  $('fFotoCam').onchange = agregarFoto; $('fFotoGal').onchange = agregarFoto; $('fThumbs').onclick = onThumbs;
  $('btnGuardar').onclick = guardarYSalir; $('btnBorrarVis').onclick = borrarVisita;
  $('btnTrkIni').onclick = () => trkIniciar(null); $('btnTrkFin').onclick = trkTerminar; $('btnTrkPto').onclick = trkPunto; $('tLista').onclick = onTrks;
  $('btnEnviarDatos').onclick = enviarDatos; $('btnEnviarFotos').onclick = enviarFotos;
  $('btnScr').onclick = exportScr; $('btnKml').onclick = exportKml; $('btnPenz').onclick = exportPenz;
  $('btnUsuario').onclick = async () => { S.user = $('cfgUsuario').value.trim().toUpperCase(); await setMeta('user', S.user); toast('Nombre guardado'); renderTodo(); };
  $('cfgOrig').onchange = $('cfgSello').onchange = async () => { S.opts = { orig: $('cfgOrig').checked, sello: $('cfgSello').checked }; await setMeta('opts', S.opts); };
  $('cfgXlsx').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) cargarCatalogo(f); };
  $('btnRespaldo').onclick = respaldo; $('btnLiberar').onclick = liberar;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarModal(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.trkAct && !S.wake) pedirWake(); if (document.visibilityState === 'hidden' && S.v) guardarVisita(true); });
  window.addEventListener('online', red); window.addEventListener('offline', red); red();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  renderTodo();
  if (!S.user || !S.cat) cambiarTab('tab-cfg');
}
document.addEventListener('DOMContentLoaded', () => init().catch(e => { console.error(e); alert('Error al iniciar: ' + e.message); }));
