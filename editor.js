/* Editor de fotos: cotas (vinculadas a la ficha), flechas, texto, lápiz, círculos, colores, deshacer y sello automático.
   Guarda la foto original intacta y genera la copia anotada; los trazos se guardan como vectores para volver a editar. */
'use strict';
const Editor = (() => {
  const COLORES = ['#ff1f1f', '#ffd400', '#ffffff', '#111111', '#19a7ff'];
  const HERR = [['cota', '↔', 'Cota'], ['flecha', '➚', 'Flecha'], ['texto', 'T', 'Texto'], ['lapiz', '✎', 'Lápiz'], ['circulo', '◯', 'Círculo']];
  let E = null;   // estado de la sesión de edición

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function construir() {
    const ov = el('div', 'ed hidden'); ov.id = 'ed';
    ov.innerHTML = `
      <div class="ed-top"><button class="ed-b" data-a="cancel">✕</button><span class="ed-tit">Anotar</span><button class="ed-b" data-a="undo" title="Deshacer">↶</button><button class="ed-b" data-a="redo" title="Rehacer">↷</button>
        <button class="ed-b" data-a="discard" title="Descartar foto">🗑</button><button class="ed-b ok" data-a="save">✔ Guardar</button></div>
      <div class="ed-wrap"><canvas></canvas></div>
      <div class="ed-bar">
        <div class="ed-row ed-tools">${HERR.map(([k, i, t]) => `<button data-h="${k}"><b>${i}</b><span>${t}</span></button>`).join('')}</div>
        <div class="ed-row"><span class="ed-cols">${COLORES.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</span>
          <span class="ed-sz"><button data-s="1">S</button><button data-s="2">M</button><button data-s="3">L</button></span>
          <label class="ed-st"><input type="checkbox" id="edStamp"> Sello</label></div>
        <div class="ed-hint" id="edHint"></div>
      </div>
      <div class="ed-modal hidden" id="edModal"><div class="ed-card">
        <div class="ed-mt" id="edMt">Cota</div>
        <label id="edLCampo">¿Qué medida es? (para que vaya a la ficha y al Excel)<select id="edCampo"></select></label>
        <label id="edLVal">Medida en campo (en la unidad indicada: m = metros, ej. 1.20)<input id="edVal" inputmode="decimal" autocomplete="off"></label><div id="edAviso" class="ed-dis" style="color:#c00000"></div>
        <div id="edDis" class="ed-dis"></div>
        <label>Texto en la foto<input id="edTxt" autocomplete="off" placeholder="Ej. Largo exterior"></label>
        <div id="edPrev" class="ed-prev"></div>
        <div class="ed-mb"><button data-m="no">Cancelar</button><button data-m="ok" class="ok">Aceptar</button></div>
      </div></div>`;
    document.body.appendChild(ov);
    return ov;
  }

  /* ---------- dibujo ---------- */
  function unidad() { return Math.max(E.cv.width, E.cv.height) / 400; }
  function caja(ctx, txt, x, y, ang, col, fs) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.font = `bold ${fs}px -apple-system, Roboto, Arial, sans-serif`;
    const w = ctx.measureText(txt).width, h = fs * 1.25, pad = fs * 0.25;
    ctx.fillStyle = col === '#111111' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.6)';
    ctx.fillRect(-w / 2 - pad, -h / 2 - pad / 2, w + pad * 2, h + pad);
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 0, 0);
    ctx.restore();
  }
  function punta(ctx, x0, y0, x1, y1, L) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - L * Math.cos(a - 0.45), y1 - L * Math.sin(a - 0.45));
    ctx.lineTo(x1 - L * Math.cos(a + 0.45), y1 - L * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
  }
  function forma(ctx, f) {
    const u = unidad(), lw = u * f.s * 0.8, fs = u * (3 + f.s * 2.2);
    ctx.strokeStyle = ctx.fillStyle = f.c; ctx.lineWidth = lw; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.shadowColor = f.c === '#111111' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.7)'; ctx.shadowBlur = lw * 0.8;
    const [p0, p1] = [f.p[0], f.p[f.p.length - 1]];
    if (f.t === 'cota' || f.t === 'flecha') {
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      punta(ctx, p0[0], p0[1], p1[0], p1[1], lw * 4.5);
      if (f.t === 'cota') {
        punta(ctx, p1[0], p1[1], p0[0], p0[1], lw * 4.5);
        const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), nx = -Math.sin(a) * lw * 4, ny = Math.cos(a) * lw * 4;
        for (const p of [p0, p1]) { ctx.beginPath(); ctx.moveTo(p[0] - nx, p[1] - ny); ctx.lineTo(p[0] + nx, p[1] + ny); ctx.stroke(); }
        if (f.txt) {
          let ang = a; if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          ctx.shadowBlur = 0;
          caja(ctx, f.txt, (p0[0] + p1[0]) / 2 + Math.sin(ang) * fs * 1.25, (p0[1] + p1[1]) / 2 - Math.cos(ang) * fs * 1.25, ang, f.c, fs);
        }
      }
    } else if (f.t === 'lapiz') {
      ctx.beginPath(); f.p.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    } else if (f.t === 'circulo') {
      ctx.beginPath(); ctx.ellipse((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(p1[0] - p0[0]) / 2 || 1, Math.abs(p1[1] - p0[1]) / 2 || 1, 0, 0, 2 * Math.PI); ctx.stroke();
    } else if (f.t === 'texto' && f.txt) {
      ctx.shadowBlur = 0; caja(ctx, f.txt, p0[0], p0[1], 0, f.c, fs * 1.1);
    }
    ctx.shadowBlur = 0;
  }
  function sello(ctx) {
    if (!E.stampOn || !E.stamp || !E.stamp.length) return;
    const W = E.cv.width, H = E.cv.height, fs = Math.max(14, W / 48), lh = fs * 1.3, pad = fs * 0.5, h = E.stamp.length * lh + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(0, H - h, W, h);
    E.stamp.forEach((t, i) => {
      ctx.font = `${i ? '' : 'bold '}${fs}px -apple-system, Roboto, Arial, sans-serif`; ctx.fillStyle = i ? '#ffffff' : '#ffd400';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(t, pad, H - h + pad + i * lh, W - pad * 2);
    });
  }
  function pintar(tmp) {
    const ctx = E.cv.getContext('2d');
    ctx.drawImage(E.img, 0, 0, E.cv.width, E.cv.height);
    for (const f of E.formas) forma(ctx, f);
    if (tmp) forma(ctx, tmp);
    sello(ctx);
  }
  function ajustar() {
    const w = E.ov.querySelector('.ed-wrap'), r = w.getBoundingClientRect(), k = Math.min(r.width / E.cv.width, r.height / E.cv.height);
    E.cv.style.width = Math.floor(E.cv.width * k) + 'px'; E.cv.style.height = Math.floor(E.cv.height * k) + 'px';
  }

  /* ---------- interacción ---------- */
  function pos(ev) { const r = E.cv.getBoundingClientRect(); return [(ev.clientX - r.left) * E.cv.width / r.width, (ev.clientY - r.top) * E.cv.height / r.height]; }
  function abajo(ev) {
    ev.preventDefault(); E.cv.setPointerCapture(ev.pointerId);
    const p = pos(ev);
    if (E.h === 'texto') { E.cur = null; pedirTexto({ t: 'texto', c: E.c, s: E.s, p: [p] }); return; }
    E.cur = { t: E.h, c: E.c, s: E.s, p: [p] };
  }
  function mover(ev) {
    if (!E.cur) return; ev.preventDefault();
    const p = pos(ev);
    if (E.cur.t === 'lapiz') E.cur.p.push(p); else E.cur.p[1] = p;
    pintar(E.cur);
  }
  function arriba(ev) {
    if (!E.cur) return; const f = E.cur; E.cur = null;
    if (f.p.length < 2 || Math.hypot(f.p[1][0] - f.p[0][0], f.p[1][1] - f.p[0][1]) < unidad() * 3) { pintar(); hint('Arrastre el dedo para dibujar.'); return; }
    if (f.t === 'cota') { pedirTexto(f); return; }
    E.formas.push(f); E.rehacer = []; pintar(); E.cambios = true;
  }
  function hint(t) { E.ov.querySelector('#edHint').textContent = t || ({ cota: 'Cota: arrastre de un extremo al otro; luego elija el campo y escriba la medida.',
    flecha: 'Flecha: arrastre desde el inicio hasta la punta.', texto: 'Texto: toque donde quiera escribir.', lapiz: 'Lápiz: dibuje libremente.', circulo: 'Círculo: arrastre para encerrar un detalle.' }[E.h]); }

  function pedirTexto(f) {
    const M = E.ov.querySelector('#edModal'), sel = M.querySelector('#edCampo'), val = M.querySelector('#edVal'), txt = M.querySelector('#edTxt');
    const esCota = f.t === 'cota';
    M.querySelector('#edMt').textContent = esCota ? 'Cota' : 'Texto';
    M.querySelector('#edLCampo').classList.toggle('hidden', !esCota || !E.campos.length);
    sel.innerHTML = `<option value="">— elegir el campo (o solo texto) —</option>` + E.campos.map(c => `<option value="${escH(c.id)}">${escH(c.comp ? c.comp + ' · ' : '')}${escH(c.label)}</option>`).join('');
    sel.value = f.campo || ''; txt.value = f.etq || (esCota ? '' : f.txt || ''); val.value = f.v ?? '';
    const prev = () => {
      const c = E.campos.find(x => x.id === sel.value);
      M.querySelector('#edLVal').classList.toggle('hidden', !c);
      M.querySelector('#edDis').textContent = c ? `Diseño: ${c.dis ?? '—'} ${c.und || ''}` : '';
      M.querySelector('#edPrev').textContent = componer(c, val.value, txt.value) || '';
      const sinCampo = esCota && !c && /\d/.test(txt.value);
      M.querySelector('#edAviso').textContent = sinCampo ? 'Esta medida quedará solo como texto: elija el campo para que se registre en la ficha.' : (c && c.und === 'm' && +String(val.value).replace(',', '.') >= 10 ? '¿Está en cm? Este campo va en metros (ej. 0.91).' : '');
    };
    sel.onchange = () => { const c = E.campos.find(x => x.id === sel.value); if (c) { if (!txt.value) txt.value = c.corto; if (c.med !== null && c.med !== undefined && val.value === '') val.value = c.med; } prev(); };
    val.oninput = txt.oninput = prev; prev();
    M.classList.remove('hidden'); setTimeout(() => (esCota && E.campos.length ? sel : txt).focus(), 50);
    M.onclick = ev => {
      const b = ev.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'ok') {
        const c = E.campos.find(x => x.id === sel.value);
        const v = val.value.trim().replace(',', '.');
        if (c && v !== '' && isNaN(+v)) { alert('La medida debe ser un número (ej. 2.45).'); return; }
        f.campo = c ? c.id : ''; f.v = c && v !== '' ? +v : null; f.etq = txt.value.trim();
        f.txt = componer(c, v, f.etq);
        if (!f.txt && f.t === 'texto') { M.classList.add('hidden'); pintar(); return; }
        if (E.formas.indexOf(f) < 0) E.formas.push(f);
        if (c && f.v !== null && E.onCota) { E.onCota(c.id, f.v); c.med = f.v; }
        E.rehacer = []; E.cambios = true;
      }
      M.classList.add('hidden'); pintar();
    };
  }
  function componer(c, v, t) {
    v = String(v ?? '').trim().replace(',', '.');
    if (c) return `${t || c.corto}${v !== '' ? ' = ' + (+v).toFixed(2) + (c.und ? ' ' + c.und : '') : ''}`;
    return t || '';
  }
  function setH(h) { E.h = h; E.ov.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', b.dataset.h === h)); hint(); }
  function setC(c) { E.c = c; E.ov.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === c)); }
  function setS(s) { E.s = s; E.ov.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === s)); }

  /* ---------- API ---------- */
  function abrir(o) {
    return new Promise((ok, ko) => {
      const ov = document.getElementById('ed') || construir();
      const cv = ov.querySelector('canvas'), img = new Image();
      const url = URL.createObjectURL(new Blob([o.orig], { type: 'image/jpeg' }));
      img.onload = () => {
        URL.revokeObjectURL(url);
        E = { ov, cv, img, formas: (o.ann || []).map(f => JSON.parse(JSON.stringify(f))), rehacer: [], cur: null, h: 'cota', c: COLORES[0], s: 2,
          stamp: o.stamp || [], stampOn: o.stampOn !== false, campos: o.campos || [], onCota: o.onCota, cambios: false, nueva: !!o.nueva };
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        ov.classList.remove('hidden'); document.body.classList.add('noscroll');
        ov.querySelector('#edStamp').checked = E.stampOn;
        ov.querySelector('[data-a="discard"]').classList.toggle('hidden', !o.nueva);
        setH('cota'); setC(COLORES[0]); setS(2); ajustar(); pintar();
        const cerrar = r => { ov.classList.add('hidden'); document.body.classList.remove('noscroll'); window.removeEventListener('resize', ajustar); E = null; ok(r); };
        cv.onpointerdown = abajo; cv.onpointermove = mover; cv.onpointerup = cv.onpointercancel = arriba;
        window.addEventListener('resize', ajustar);
        ov.querySelector('#edStamp').onchange = ev => { E.stampOn = ev.target.checked; E.cambios = true; pintar(); };
        ov.querySelector('.ed-bar').onclick = ev => {
          const b = ev.target.closest('button'); if (!b) return;
          if (b.dataset.h) setH(b.dataset.h); else if (b.dataset.c) setC(b.dataset.c); else if (b.dataset.s) setS(+b.dataset.s);
          else if (b.dataset.a === 'undo' && E.formas.length) { E.rehacer.push(E.formas.pop()); E.cambios = true; pintar(); }
          else if (b.dataset.a === 'redo' && E.rehacer.length) { E.formas.push(E.rehacer.pop()); E.cambios = true; pintar(); }
        };
        ov.querySelector('.ed-top').onclick = ev => {
          const b = ev.target.closest('[data-a]'); if (!b) return;
          if (b.dataset.a === 'undo') { if (E.formas.length) { E.rehacer.push(E.formas.pop()); E.cambios = true; pintar(); } return; }
          if (b.dataset.a === 'redo') { if (E.rehacer.length) { E.formas.push(E.rehacer.pop()); E.cambios = true; pintar(); } return; }
          if (b.dataset.a === 'cancel') {
            if (E.cambios && !confirm('¿Salir sin guardar las anotaciones?')) return;
            cerrar(E.nueva ? { accion: 'sin_anotar' } : null);
          } else if (b.dataset.a === 'discard') { if (confirm('¿Descartar esta foto?')) cerrar({ accion: 'descartar' }); }
          else if (b.dataset.a === 'save') {
            pintar();
            const ann = E.formas, st = E.stampOn;
            cv.toBlob(bl => bl ? bl.arrayBuffer().then(buf => cerrar({ accion: 'guardar', anot: buf, ann, stampOn: st })) : alert('No se pudo guardar la imagen'), 'image/jpeg', 0.82);
          }
        };
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('No se pudo abrir la foto')); };
      img.src = url;
    });
  }
  /* genera la copia anotada sin abrir el editor (p. ej. foto sin anotaciones pero con sello) */
  function renderSinEditor(orig, ann, stamp, stampOn) {
    return new Promise((ok, ko) => {
      const img = new Image(), url = URL.createObjectURL(new Blob([orig], { type: 'image/jpeg' }));
      img.onload = () => {
        URL.revokeObjectURL(url);
        const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const prev = E; E = { cv, img, formas: ann || [], stamp, stampOn };
        pintar(); E = prev;
        cv.toBlob(bl => bl ? bl.arrayBuffer().then(ok) : ko(new Error('canvas')), 'image/jpeg', 0.82);
      };
      img.onerror = () => ko(new Error('No se pudo leer la foto')); img.src = url;
    });
  }
  return { abrir, renderSinEditor };
})();
