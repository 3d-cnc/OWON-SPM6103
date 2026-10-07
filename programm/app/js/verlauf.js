'use strict';
/* SPM-25: Verlauf zoomen und verschieben, Ausschnitt auswerten, Kurven als Bild.
   Mausrad zoomt um die Mausposition, Ziehen verschiebt, Umschalt+Ziehen markiert einen Ausschnitt
   (Min/Max/Mittel im Kopf jeder Kurve gelten dann dafür), Doppelklick kehrt zum Mitlaufen zurück.
   Der Kern zeichnet zustand.ansicht statt des Zeitfensters und schattiert zustand.auswahl. */

const vz = { ziehen: null };

function vzZeit(canvas, clientX) {
  const r = canvas.getBoundingClientRect(), b = zustand.bereichT;
  const anteil = (clientX - r.left - RAND_L) / (r.width - RAND_L - RAND_R);
  return b[0] + (b[1] - b[0]) * Math.min(Math.max(anteil, 0), 1);
}

function vzAuffrischen() { anhaltenKnopf(); zeichnenAnfordern(); vzInfo(); }

function vzInfo() {
  const a = zustand.auswahl, el = $('auswahl-info');
  if (!a) { el.textContent = ''; el.title = ''; return; }
  // Energie und Ladung nur im Ausschnitt (Trapezregel wie in der Aufzeichnung)
  const d = zustand.live;
  let energie = 0, ladung = 0;
  for (let j = Math.max(ersterIndexAb(d, a[0]), 1); j < d.length && d[j].t <= a[1]; j++) {
    const v = d[j - 1], r = d[j], dt = (r.t - v.t) / 1000;
    if (v.t < a[0] || !(dt > 0 && dt <= 10)) continue;
    if (Number.isFinite(r.p) && Number.isFinite(v.p)) energie += (r.p + v.p) / 2 * dt;
    if (Number.isFinite(r.i) && Number.isFinite(v.i)) ladung += (r.i + v.i) / 2 * dt;
  }
  el.textContent = `Ausschnitt ${uhrzeit(a[0])}–${uhrzeit(a[1])} · ${dauerKurz((a[1] - a[0]) / 1000)} · ${mitEinheitText(energie / 3600, 'Wh')} · ${mitEinheitText(ladung / 3600, 'Ah')} ✕`;
  el.title = 'Klick: Ausschnitt aufheben';
}
$('auswahl-info').style.cursor = 'pointer';
$('auswahl-info').addEventListener('click', () => { zustand.auswahl = null; vzAuffrischen(); });

for (const k of KURVEN) {
  const c = k.canvas;
  c.addEventListener('wheel', e => {
    if (!zustand.bereichT || !zustand.live.length) return;
    e.preventDefault();
    const [t0, t1] = zustand.bereichT, mitte = vzZeit(c, e.clientX), f = e.deltaY < 0 ? 0.8 : 1.25;
    let a = mitte - (mitte - t0) * f, b = mitte + (t1 - mitte) * f;
    if (b - a < 2000) { const m = (a + b) / 2; a = m - 1000; b = m + 1000; }   // nicht enger als 2 s
    zustand.ansicht = [a, b];
    vzAuffrischen();
  }, { passive: false });

  c.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !zustand.bereichT) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* ohne Festhalten geht es auch */ }
    const t = vzZeit(c, e.clientX);
    vz.ziehen = e.shiftKey ? { art: 'auswahl', start: t, canvas: c } : { art: 'schieben', x: e.clientX, bereich: [...zustand.bereichT], canvas: c };
    if (e.shiftKey) zustand.auswahl = [t, t];
  });
  c.addEventListener('pointermove', e => {
    const z = vz.ziehen;
    if (!z || z.canvas !== c) return;
    if (z.art === 'auswahl') {
      const t = vzZeit(c, e.clientX);
      zustand.auswahl = [Math.min(z.start, t), Math.max(z.start, t)];
    } else if (Math.abs(e.clientX - z.x) > 3) {
      const r = c.getBoundingClientRect();
      const dt = (e.clientX - z.x) / (r.width - RAND_L - RAND_R) * (z.bereich[1] - z.bereich[0]);
      zustand.ansicht = [z.bereich[0] - dt, z.bereich[1] - dt];
      c.classList.add('ziehen');
    }
    vzAuffrischen();
  });
  const ende = () => {
    const z = vz.ziehen;
    if (!z) return;
    vz.ziehen = null;
    c.classList.remove('ziehen');
    // ein bloßer Klick mit Umschalt markiert nichts
    if (z.art === 'auswahl' && zustand.auswahl && zustand.auswahl[1] - zustand.auswahl[0] < 300) zustand.auswahl = null;
    vzAuffrischen();
  };
  c.addEventListener('pointerup', ende);
  c.addEventListener('pointercancel', ende);
  c.addEventListener('dblclick', () => { zustand.ansicht = null; zustand.angehalten = null; zustand.auswahl = null; vzAuffrischen(); });
}

/* ---------- Kurven als Bild ---------- */

// Setzt Leinwände untereinander zu einem PNG zusammen, jede mit ihrer Überschrift (im aktuellen Design)
function bildAusLeinwaenden(teile) {
  const dpr = window.devicePixelRatio || 1, kopf = Math.round(24 * dpr), rand = Math.round(12 * dpr);
  const breite = Math.max(...teile.map(t => t.canvas.width)) + 2 * rand;
  const hoehe = teile.reduce((s, t) => s + kopf + t.canvas.height, 0) + 2 * rand;
  const bild = document.createElement('canvas');
  bild.width = breite; bild.height = hoehe;
  const g = bild.getContext('2d');
  g.fillStyle = farbe('--panel'); g.fillRect(0, 0, breite, hoehe);
  let y = rand;
  for (const t of teile) {
    g.fillStyle = t.farbe ? farbe(t.farbe) : farbe('--text');
    g.font = `600 ${Math.round(13 * dpr)}px "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(t.titel, rand, y + kopf / 2);
    if (t.zusatz) {
      const w = g.measureText(t.titel).width;
      g.fillStyle = farbe('--muted'); g.font = `${Math.round(12 * dpr)}px ${farbe('--mono')}`;
      g.fillText(t.zusatz, rand + w + 14 * dpr, y + kopf / 2);
    }
    y += kopf;
    g.drawImage(t.canvas, rand, y);
    y += t.canvas.height;
  }
  return bild.toDataURL('image/png');
}

const stempel = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

function verlaufTeile() {
  return KURVEN.map(k => ({
    canvas: k.canvas, farbe: k.farbe,
    titel: k.box.querySelector('.titel').textContent,
    zusatz: [...k.box.querySelectorAll('.kopf > span:not(.titel):not(.hover)')].map(s => s.textContent.replace(/\s+/g, ' ').trim()).join('   '),
  }));
}

async function bildSpeichern(teile, name) {
  const pfad = await window.spm?.bildSpeichern(`${name}_${stempel()}.png`, bildAusLeinwaenden(teile));
  if (pfad) log('Bild gespeichert: ' + pfad, 'info');
}
async function bildKopieren(teile) {
  if (await window.spm?.bildKopieren(bildAusLeinwaenden(teile))) log('Bild in die Zwischenablage kopiert', 'info');
}

$('bild-speichern').addEventListener('click', () => bildSpeichern(verlaufTeile(), 'Verlauf'));
$('bild-kopieren').addEventListener('click', () => bildKopieren(verlaufTeile()));

// Auch für Kennlinie und Vergleich: Knöpfe in die Überschrift
for (const [canvasId, name, titelEl] of [['kl-canvas', 'Kennlinie', null], ['vg-canvas', 'Vergleich', 'vg-titel']]) {
  // in die Überschrift selbst – der rechte Teil enthält die Mausanzeige und wird laufend überschrieben
  const h2 = $(canvasId).closest('section').querySelector('h2');
  const teile = () => [{ canvas: $(canvasId), titel: titelEl ? `Vergleich · ${$(titelEl).textContent}` : 'Kennlinie: Strom über Spannung' }];
  for (const [text, tun] of [['Bild', () => bildSpeichern(teile(), name)], ['Kopieren', () => bildKopieren(teile())]]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.style.marginLeft = '8px';
    b.addEventListener('click', tun);
    h2.appendChild(b);
  }
}
