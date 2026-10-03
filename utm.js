/* Conversión geográficas WGS84 ⇄ UTM (zona fija 18 Sur, la del expediente). Fórmulas de Snyder / USGS. */
'use strict';
const UTM = (() => {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), ZONA = 18, SUR = true;
  const lon0 = (ZONA * 6 - 183) * Math.PI / 180;
  function M(p) {
    return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  }
  function aUTM(lat, lon) {
    const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = Math.cos(p) * (l - lon0);
    const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let Y = k0 * (M(p) + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (SUR) Y += 10000000;
    return { e: Math.round(E * 1000) / 1000, n: Math.round(Y * 1000) / 1000 };
  }
  function aGeo(E, Y) {
    const x = E - 500000, y = SUR ? Y - 10000000 : Y;
    const mu = (y / k0) / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2;
    const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
    return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
  }
  function rumbo(de, a_) {   // de/a = {e,n} → distancia (m) y rumbo en texto
    const dx = a_.e - de.e, dy = a_.n - de.n, d = Math.hypot(dx, dy);
    const az = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const R = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return { d, az, txt: R[Math.round(az / 45) % 8] };
  }
  return { aUTM, aGeo, rumbo, ZONA: '18S', DATUM: 'WGS84' };
})();
