'use strict';
/* SPM-15: U-I-Kennlinie – Spannung in Schritten hochfahren, je Schritt Spannung und Strom messen,
   als Kurve „Strom über Spannung“ zeichnen. Mehrere Kurven bleiben zum Vergleich stehen, jede als CSV. */

const KL_FARBEN = ['--i', '--u', '--p', '--d', '--warn', '--err'];
const KL_FELDER = { 'kl-name': 'LED rot', 'kl-von': '0', 'kl-bis': '3', 'kl-schritt': '0,05', 'kl-strom': '0,02', 'kl-warten': '400' };
for (const [id, vorgabe] of Object.entries({ ...KL_FELDER, ...speicher.lesen('kennlinie', {}) })) $(id).value = vorgabe;
for (const id of Object.keys(KL_FELDER)) $(id).addEventListener('change', () => speicher.schreiben('kennlinie', Object.fromEntries(Object.keys(KL_FELDER).map(f => [f, $(f).value]))));

let klKurven = speicher.lesen('kennlinien', []);   // [{ name, zeit, punkte: [{ soll, u, i, p, modus }] }]
let klGewaehlt = klKurven.length - 1;
const kl = { laeuft: false, abbruch: null, hover: null };
const klMerken = () => speicher.schreiben('kennlinien', klKurven.slice(-12));
const klFarbe = nr => { const f = KL_FARBEN[nr % KL_FARBEN.length]; return f.startsWith('--') ? farbe(f) : f; };

function klListeZeichnen() {
  const box = $('kl-kurven');
  box.innerHTML = klKurven.length ? '' : '<p class="hinweis">Noch keine Kurve gemessen.</p>';
  klKurven.forEach((k, nr) => {
    const z = document.createElement('div');
    z.className = 'kurve-eintrag' + (nr === klGewaehlt ? ' gewaehlt' : '');
    z.innerHTML = `<span class="farbe"></span><span class="name"></span><small></small><button type="button" title="Als CSV speichern">CSV</button><button type="button" title="Kurve entfernen">×</button>`;
    z.querySelector('.farbe').style.background = klFarbe(nr);
    z.querySelector('.name').textContent = k.name;
    z.querySelector('.name').title = `${k.name} – ${new Date(k.zeit).toLocaleString('de-DE')}`;
    z.querySelector('small').textContent = `${k.punkte.length} Punkte`;
    z.addEventListener('click', () => { klGewaehlt = nr; klAlles(); });
    const [csv, weg] = z.querySelectorAll('button');
    csv.addEventListener('click', e => { e.stopPropagation(); klCsv(k); });
    weg.disabled = kl.laeuft && nr === klKurven.length - 1;
    weg.addEventListener('click', e => {
      e.stopPropagation();
      klKurven.splice(nr, 1);
      klGewaehlt = Math.min(klGewaehlt, klKurven.length - 1);
      klMerken(); klAlles();
    });
    box.appendChild(z);
  });
}

function klPunkteZeichnen() {
  const k = klKurven[klGewaehlt];
  $('kl-punkte-titel').textContent = k ? k.name : '';
  const modi = { 0: 'Standby', 1: 'CV', 2: 'CC', 3: 'Fehler' };
  $('kl-punkte').innerHTML = !k?.punkte.length ? '<div class="leer">Noch keine Messpunkte.</div>' : k.punkte.map((p, n) =>
    `<div class="raster-kl"><div>${n + 1}</div><div>${zahl(p.soll, 3)} V</div><div>${zahl(p.u, 3)} V</div><div>${zahl(p.i, 3)} A</div>`
    + `<div>${zahl(p.p, 3)} W</div><div>${p.i > 1e-6 ? escapeHtml(mitEinheitText(p.u / p.i, 'Ω')) : '–'}</div><div>${modi[p.modus] ?? '–'}</div></div>`).join('');
  const liste = $('kl-punkte');
  if (kl.laeuft) liste.scrollTop = liste.scrollHeight;
}

function klDiagramm() {
  const f = leinwand($('kl-canvas'));
  if (!f) return;
  const alle = klKurven.flatMap(k => k.punkte);
  const umax = Math.max(0.1, ...alle.map(p => p.u)), imax = Math.max(1e-3, ...alle.map(p => p.i));
  const ie = technisch(imax, 'A');   // gemeinsamer Vorsatz für die Stromachse (A oder mA)
  const fak = ie.einheit === 'mA' ? 1e-3 : ie.einheit === 'µA' ? 1e-6 : 1;
  const ach = achsenZeichnen(f, [0, umax * 1.05], [0, imax * 1.08], (v, s) => zahl(v, stellenFuer(s)) + ' V', (v, s) => zahl(v / fak, stellenFuer(s / fak)) + ' ' + ie.einheit);
  const { g } = f;
  klKurven.forEach((k, nr) => {
    const c = klFarbe(nr);
    g.strokeStyle = c; g.fillStyle = c; g.lineWidth = nr === klGewaehlt ? 2.2 : 1.3;
    g.globalAlpha = nr === klGewaehlt ? 1 : 0.55;
    g.beginPath();
    k.punkte.forEach((p, n) => n ? g.lineTo(ach.x(p.u), ach.y(p.i)) : g.moveTo(ach.x(p.u), ach.y(p.i)));
    g.stroke();
    if (nr === klGewaehlt) for (const p of k.punkte) { g.beginPath(); g.arc(ach.x(p.u), ach.y(p.i), 2.5, 0, Math.PI * 2); g.fill(); }
  });
  g.globalAlpha = 1;
  const h = kl.hover;
  if (h) {
    g.strokeStyle = farbe('--text'); g.lineWidth = 1;
    g.beginPath(); g.arc(ach.x(h.u), ach.y(h.i), 5, 0, Math.PI * 2); g.stroke();
  }
  kl.achsen = ach;
}

function klAlles() { klListeZeichnen(); klPunkteZeichnen(); klDiagramm(); }

$('kl-canvas').addEventListener('mousemove', e => {
  const k = klKurven[klGewaehlt];
  if (!k?.punkte.length || !kl.achsen) return;
  const r = e.target.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, abstand = Infinity;
  for (const p of k.punkte) {
    const d = Math.hypot(kl.achsen.x(p.u) - mx, kl.achsen.y(p.i) - my);
    if (d < abstand) { abstand = d; best = p; }
  }
  kl.hover = abstand < 40 ? best : null;
  $('kl-hover').textContent = kl.hover ? `${zahl(best.u, 3)} V · ${zahl(best.i, 3)} A` + (best.i > 1e-6 ? ` · ${mitEinheitText(best.u / best.i, 'Ω')}` : '') : '';
  klDiagramm();
});
$('kl-canvas').addEventListener('mouseleave', () => { kl.hover = null; $('kl-hover').textContent = ''; klDiagramm(); });

function klCsv(k) {
  const z = csvZahl;
  const zeilen = ['Nr;Soll [V];Spannung [V];Strom [A];Leistung [W];Widerstand [Ohm];Modus',
    ...k.punkte.map((p, n) => [n + 1, z(p.soll), z(p.u), z(p.i), z(p.p), p.i > 1e-6 ? z(+(p.u / p.i).toPrecision(6)) : '', { 1: 'CV', 2: 'CC' }[p.modus] ?? ''].join(';'))];
  const name = `Kennlinie_${k.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${new Date(k.zeit).toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;
  window.spm?.csvSpeichern(name, '﻿' + zeilen.join('\r\n')).then(pfad => { if (pfad) $('kl-info').textContent = 'Gespeichert: ' + pfad; });
}

function klLesen() {
  const w = {
    name: $('kl-name').value.trim() || `Kurve ${klKurven.length + 1}`,
    von: zahlLesen($('kl-von').value), bis: zahlLesen($('kl-bis').value), schritt: zahlLesen($('kl-schritt').value),
    strom: zahlLesen($('kl-strom').value), warten: zahlLesen($('kl-warten').value),
  };
  if (!(w.von >= 0 && w.bis <= GRENZE.volt && w.bis > w.von)) return { fehler: `Start und Ende zwischen 0 und ${GRENZE.volt} V, Ende größer als Start.` };
  if (!(w.schritt > 0) || (w.bis - w.von) / w.schritt > 2000) return { fehler: 'Schrittweite größer null, höchstens 2000 Schritte.' };
  if (!(w.strom > 0 && w.strom <= GRENZE.curr)) return { fehler: `Strombegrenzung zwischen 0 und ${GRENZE.curr} A.` };
  if (!(w.warten >= 100)) return { fehler: 'Wartezeit mindestens 100 ms.' };
  return w;
}

async function klMessen() {
  if (!zustand.geraet) { $('kl-info').textContent = 'Erst verbinden.'; return; }
  const w = klLesen();
  if (w.fehler) { $('kl-info').textContent = w.fehler; return; }
  if (zustand.ausgang && !await bestaetigen('Kennlinie messen', `Der Ausgang ist eingeschaltet. Die Messung beginnt bei ${feldZahl(w.von)} V mit höchstens ${feldZahl(w.strom)} A.`, 'Messen')) return;
  if (!automatikBelegen('kennlinie', 'Kennlinie', g => { kl.abbruch = g ?? 'gestoppt'; })) return;
  kl.laeuft = true; kl.abbruch = null;
  const kurve = { name: w.name, zeit: Date.now(), punkte: [] };
  klKurven.push(kurve);
  klGewaehlt = klKurven.length - 1;
  for (const id of [...Object.keys(KL_FELDER), 'kl-messen', 'kl-cc', 'kl-aus']) $(id).disabled = true;
  $('kl-stopp').disabled = false;
  statusPille('kl-status', 'misst', 'laeuft');
  const anzahl = Math.floor((w.bis - w.von) / w.schritt + 1e-9) + 1;
  let grund = null;
  try {
    await sollwerteSetzen({ volt: w.von, curr: w.strom, ovp: ovpZu(w.bis), ocp: ocpZu(w.strom) }, true);
    await ausgangSchalten(true, true);
    ereignisSetzen(`Kennlinie: ${w.name}`);
    for (let n = 0; n < anzahl && !kl.abbruch; n++) {
      const soll = +(w.von + n * w.schritt).toFixed(4);
      await befehl(`VOLT ${scpiZahl(soll)}`, true);
      const gesetzt = Date.now();
      await warten(w.warten);
      const rec = await messungAb(gesetzt + w.warten);
      kurve.punkte.push({ soll, u: rec.u, i: rec.i, p: rec.p ?? rec.u * rec.i, modus: rec.modus });
      balken('kl-balken', (n + 1) / anzahl);
      $('kl-info').textContent = `Punkt ${n + 1}/${anzahl}: ${zahl(rec.u, 3)} V, ${zahl(rec.i, 3)} A`;
      chipSetzen('kennlinie', 'Kennlinie', `${n + 1}/${anzahl}`);
      klAlles();
      if ($('kl-cc').checked && rec.modus === 2) { grund = `Strombegrenzung ${feldZahl(w.strom)} A erreicht bei ${zahl(rec.u, 2)} V`; break; }
    }
  } catch (e) {
    kl.abbruch = e.message;
  } finally {
    if ($('kl-aus').checked || kl.abbruch) await ausgangSchalten(false, true);
    kl.laeuft = false;
    automatikFreigeben('kennlinie');
    for (const id of [...Object.keys(KL_FELDER), 'kl-messen', 'kl-cc', 'kl-aus']) $(id).disabled = false;
    $('kl-stopp').disabled = true;
    klMerken();
    const text = kl.abbruch ? `Abgebrochen (${kl.abbruch}) nach ${kurve.punkte.length} Punkten.` : `Fertig: ${kurve.punkte.length} Punkte` + (grund ? ` – ${grund}.` : '.');
    statusPille('kl-status', kl.abbruch ? 'abgebrochen' : 'fertig', kl.abbruch ? 'fehler' : 'fertig');
    $('kl-info').textContent = text;
    ereignisSetzen(`Kennlinie ${w.name}: ${text}`);
    await sollwerteLesen().catch(() => {});
    anzeigeAktualisieren();
    klAlles();
  }
}

$('kl-messen').addEventListener('click', klMessen);
$('kl-stopp').addEventListener('click', () => { if (kl.laeuft) kl.abbruch = 'gestoppt'; });
$('kl-stopp').disabled = true;
seitenHoerer['seite-kennlinie'] = klAlles;
window.addEventListener('resize', () => { if (tabAktiv('seite-kennlinie')) klDiagramm(); });
