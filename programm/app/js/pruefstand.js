'use strict';
/* SPM-23: Erst-Einschalten-Assistent – neue Platine mit kleiner Strombegrenzung langsam hochfahren,
   bei Auffälligkeiten sofort abschalten, Ruhestrom messen, Ergebnis ins Protokoll.
   SPM-24: Zyklentest – Ausgang n-mal an und aus, in jeder An-Phase den Strom gegen ein Fenster prüfen. */

/* ======================= Erst-Einschalten ======================= */

const EE_FELDER = { 'ee-name': '', 'ee-ziel': '5', 'ee-strom': '0,1', 'ee-rampe': '5', 'ee-grenze': '0,05', 'ee-halten': '3' };
for (const [id, w] of Object.entries({ ...EE_FELDER, ...speicher.lesen('erstein', {}) })) if (id in EE_FELDER) $(id).value = w;
$('ee-anlassen').checked = speicher.lesen('erstein-anlassen', false);
for (const id of Object.keys(EE_FELDER)) $(id).addEventListener('change', () => speicher.schreiben('erstein', Object.fromEntries(Object.keys(EE_FELDER).map(f => [f, $(f).value]))));
$('ee-anlassen').addEventListener('change', e => speicher.schreiben('erstein-anlassen', e.target.checked));

const ee = { laeuft: false, abbruch: null, punkte: [], protokoll: speicher.lesen('erstein-protokoll', []) };

function eeLesen() {
  const w = { name: $('ee-name').value.trim() || 'Platine', ziel: zahlLesen($('ee-ziel').value), strom: zahlLesen($('ee-strom').value),
    rampe: zahlLesen($('ee-rampe').value), grenze: zahlLesen($('ee-grenze').value), halten: zahlLesen($('ee-halten').value) };
  if (!(w.ziel > 0 && w.ziel <= GRENZE.volt)) return { fehler: `Zielspannung zwischen 0 und ${GRENZE.volt} V.` };
  if (!(w.strom > 0 && w.strom <= GRENZE.curr)) return { fehler: `Strombegrenzung zwischen 0 und ${GRENZE.curr} A.` };
  if (!(w.grenze > 0 && w.grenze < w.strom)) return { fehler: 'Ruhestrom-Grenze größer null und kleiner als die Strombegrenzung.' };
  if (!(w.rampe >= 0.5)) return { fehler: 'Hochfahren mindestens 0,5 s.' };
  if (!(w.halten >= 0.5)) return { fehler: 'Ruhestrom mindestens 0,5 s messen.' };
  return w;
}

function eeDiagramm() {
  const f = leinwand($('ee-canvas'), { l: 64, r: 12, o: 10, u: 26 });
  if (!f) return;
  const w = eeLesen();
  const umax = Math.max(w.ziel || 1, ...ee.punkte.map(p => p.u)) * 1.05;
  const imax = Math.max(w.strom || 0.01, ...ee.punkte.map(p => p.i)) * 1.1;
  const ie = technisch(imax, 'A'), fak = ie.einheit === 'mA' ? 1e-3 : ie.einheit === 'µA' ? 1e-6 : 1;
  const a = achsenZeichnen(f, [0, umax], [0, imax], (v, s) => zahl(v, stellenFuer(s)) + ' V', (v, s) => zahl(v / fak, stellenFuer(s / fak)) + ' ' + ie.einheit);
  const { g } = f;
  if (Number.isFinite(w.grenze)) {   // Ruhestrom-Grenze und Strombegrenzung als Linien
    g.setLineDash([5, 4]); g.lineWidth = 1;
    g.strokeStyle = farbe('--warn'); g.beginPath(); g.moveTo(f.x0, a.y(w.grenze)); g.lineTo(f.x0 + f.iw, a.y(w.grenze)); g.stroke();
    g.strokeStyle = farbe('--err'); g.beginPath(); g.moveTo(f.x0, a.y(w.strom)); g.lineTo(f.x0 + f.iw, a.y(w.strom)); g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = farbe('--i'); g.lineWidth = 2; g.beginPath();
  ee.punkte.forEach((p, n) => n ? g.lineTo(a.x(p.u), a.y(p.i)) : g.moveTo(a.x(p.u), a.y(p.i)));
  g.stroke();
}

function eeProtokollZeichnen() {
  $('ee-protokoll').innerHTML = ee.protokoll.length ? ee.protokoll.slice().reverse().map(p =>
    `<div class="raster-ee"><div>${uhrzeit(p.t)}</div><div>${escapeHtml(p.name)}</div><div class="${p.gut ? 'gut-text' : 'schlecht-text'}">${escapeHtml(p.kurz)}</div>`
    + `<div>${Number.isFinite(p.ruhe) ? zahl(p.ruhe, 3) + ' A' : '–'}</div><div>${zahl(p.max, 3)} A</div></div>`).join('')
    : '<div class="leer">Noch kein Durchgang.</div>';
}

async function eeStarten() {
  if (!zustand.geraet) { $('ee-ergebnis').textContent = 'Erst verbinden.'; return; }
  const w = eeLesen();
  if (w.fehler) { $('ee-ergebnis').textContent = w.fehler; return; }
  if (zustand.ausgang && !await bestaetigen('Erst-Einschalten', 'Der Ausgang ist eingeschaltet. Für den Test wird er erst ausgeschaltet und dann von 0 V an langsam hochgefahren.', 'Starten')) return;
  if (!automatikBelegen('erstein', 'Erst-Einschalten', g => { ee.abbruch = g ?? 'abgebrochen'; })) return;
  Object.assign(ee, { laeuft: true, abbruch: null, punkte: [] });
  for (const id of [...Object.keys(EE_FELDER), 'ee-start', 'ee-anlassen']) $(id).disabled = true;
  $('ee-stopp').disabled = false;
  statusPille('ee-status', 'läuft', 'laeuft');
  $('ee-ergebnis').className = 'ee-ergebnis';
  let ergebnis = null, ruhe = NaN, maxI = 0;
  try {
    await ausgangSchalten(false, true);
    await sollwerteSetzen({ volt: 0, curr: w.strom, ovp: ovpZu(w.ziel), ocp: ocpZu(w.strom) }, true);
    await ausgangSchalten(true, true);
    ereignisSetzen(`Erst-Einschalten: ${w.name}, bis ${feldZahl(w.ziel)} V, höchstens ${feldZahl(w.strom)} A`);
    const start = Date.now(), dauer = w.rampe * 1000;
    // Hochfahren: Spannung schrittweise, nach jedem Schritt eine frische Messung prüfen
    while (!ee.abbruch) {
      const anteil = Math.min(1, (Date.now() - start) / dauer);
      const soll = w.ziel * anteil;
      await befehl(`VOLT ${scpiZahl(soll)}`, true);
      const rec = await messungAb(Date.now());
      ee.punkte.push({ u: rec.u, i: rec.i });
      maxI = Math.max(maxI, rec.i);
      $('ee-ergebnis').textContent = `Hochfahren: ${zahl(rec.u, 2)} V · ${zahl(rec.i, 3)} A`;
      balken('ee-balken', anteil * 0.7);
      chipSetzen('erstein', 'Erst-Einschalten', `${zahl(rec.u, 1)} V`);
      eeDiagramm();
      if (rec.modus === 2 || rec.i >= w.strom * 0.98) { ergebnis = { gut: false, kurz: 'Strombegrenzung', text: `Strombegrenzung ${feldZahl(w.strom)} A erreicht bei ${zahl(rec.u, 2)} V – Kurzschluss oder zu große Last?` }; break; }
      if (rec.i > w.grenze && anteil < 1) { ergebnis = { gut: false, kurz: 'Strom zu früh', text: `Strom ${zahl(rec.i, 3)} A schon bei ${zahl(rec.u, 2)} V – über der Ruhestrom-Grenze ${feldZahl(w.grenze)} A` }; break; }
      if (anteil >= 1) break;
    }
    // Ruhestrom bei Zielspannung messen
    if (!ergebnis && !ee.abbruch) {
      const werte = [], ende = Date.now() + w.halten * 1000;
      while (Date.now() < ende && !ee.abbruch) {
        const rec = await messungAb(Date.now());
        werte.push(rec.i); maxI = Math.max(maxI, rec.i);
        ee.punkte.push({ u: rec.u, i: rec.i });
        balken('ee-balken', 0.7 + 0.3 * (1 - (ende - Date.now()) / (w.halten * 1000)));
        $('ee-ergebnis').textContent = `Ruhestrom messen: ${zahl(rec.i, 3)} A`;
        if (rec.modus === 2) { ergebnis = { gut: false, kurz: 'Strombegrenzung', text: `Strombegrenzung bei Zielspannung erreicht` }; break; }
      }
      if (!ergebnis && werte.length) {
        ruhe = werte.reduce((a, x) => a + x, 0) / werte.length;
        ergebnis = ruhe <= w.grenze
          ? { gut: true, kurz: 'in Ordnung', text: `In Ordnung: Ruhestrom ${zahl(ruhe, 3)} A bei ${feldZahl(w.ziel)} V (Grenze ${feldZahl(w.grenze)} A)` }
          : { gut: false, kurz: 'Ruhestrom zu hoch', text: `Ruhestrom ${zahl(ruhe, 3)} A über der Grenze ${feldZahl(w.grenze)} A` };
      }
    }
  } catch (e) {
    ee.abbruch = e.message;
  } finally {
    if (ee.abbruch) ergebnis = { gut: false, kurz: 'abgebrochen', text: `Abgebrochen: ${ee.abbruch}` };
    if (!(ergebnis?.gut && $('ee-anlassen').checked)) await ausgangSchalten(false, true);
    ee.laeuft = false;
    automatikFreigeben('erstein');
    for (const id of [...Object.keys(EE_FELDER), 'ee-start', 'ee-anlassen']) $(id).disabled = false;
    $('ee-stopp').disabled = true;
    balken('ee-balken', 1);
    $('ee-ergebnis').textContent = ergebnis.text;
    $('ee-ergebnis').className = 'ee-ergebnis ' + (ergebnis.gut ? 'gut' : 'schlecht');
    statusPille('ee-status', ergebnis.gut ? 'in Ordnung' : ergebnis.kurz, ergebnis.gut ? 'fertig' : 'fehler');
    ee.protokoll.push({ t: Date.now(), name: w.name, gut: ergebnis.gut, kurz: ergebnis.kurz, text: ergebnis.text, ruhe, max: maxI, ziel: w.ziel, strom: w.strom, grenze: w.grenze });
    speicher.schreiben('erstein-protokoll', ee.protokoll.slice(-200));
    eeProtokollZeichnen();
    eeDiagramm();
    ereignisSetzen(`Erst-Einschalten ${w.name}: ${ergebnis.text}`);
    ergebnis.gut ? (ton(880, 0.15), setTimeout(() => ton(1320, 0.25), 180)) : ton(330, 0.5);
    await sollwerteLesen().catch(() => {});
    anzeigeAktualisieren();
  }
}

$('ee-start').addEventListener('click', eeStarten);
$('ee-stopp').addEventListener('click', () => { if (ee.laeuft) ee.abbruch = 'von Hand abgebrochen'; });
$('ee-stopp').disabled = true;
$('ee-csv').addEventListener('click', async () => {
  const z = csvZahl;
  const zeilen = ['Zeit;Platine;Ergebnis;Ruhestrom [A];Höchster Strom [A];Zielspannung [V];Strombegrenzung [A];Ruhestrom-Grenze [A];Text',
    ...ee.protokoll.map(p => [new Date(p.t).toLocaleString('de-DE'), csvText(p.name), p.gut ? 'in Ordnung' : 'nicht in Ordnung', z(p.ruhe), z(p.max), z(p.ziel), z(p.strom), z(p.grenze), csvText(p.text)].join(';'))];
  const pfad = await window.spm?.csvSpeichern(`Erst-Einschalten_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + zeilen.join('\r\n'));
  if (pfad) log('Protokoll gespeichert: ' + pfad, 'info');
});

/* ======================= Zyklentest ======================= */

const ZT_FELDER = { 'zt-volt': '12', 'zt-curr': '1', 'zt-an': '5', 'zt-aus': '5', 'zt-zyklen': '100', 'zt-einschwing': '1', 'zt-min': '0,1', 'zt-max': '0,8', 'zt-fehler': 'halt' };
for (const [id, w] of Object.entries({ ...ZT_FELDER, ...speicher.lesen('zyklen', {}) })) if (id in ZT_FELDER) $(id).value = w;
for (const id of Object.keys(ZT_FELDER)) $(id).addEventListener('change', () => speicher.schreiben('zyklen', Object.fromEntries(Object.keys(ZT_FELDER).map(f => [f, $(f).value]))));

const zt = { laeuft: false, abbruch: null, protokoll: [], ok: 0, fehler: 0 };

function ztLesen() {
  const w = { volt: zahlLesen($('zt-volt').value), curr: zahlLesen($('zt-curr').value), an: zahlLesen($('zt-an').value), aus: zahlLesen($('zt-aus').value),
    zyklen: Math.round(zahlLesen($('zt-zyklen').value)), einschwing: zahlLesen($('zt-einschwing').value), min: zahlLesen($('zt-min').value), max: zahlLesen($('zt-max').value), beiFehler: $('zt-fehler').value };
  if (!(w.volt > 0 && w.volt <= GRENZE.volt)) return { fehler: `Spannung zwischen 0 und ${GRENZE.volt} V.` };
  if (!(w.curr > 0 && w.curr <= GRENZE.curr)) return { fehler: `Strombegrenzung zwischen 0 und ${GRENZE.curr} A.` };
  if (!(w.an >= 0.5 && w.aus >= 0.5)) return { fehler: 'An und Aus jeweils mindestens 0,5 s.' };
  if (!(w.zyklen >= 0)) return { fehler: 'Zyklen: 0 (endlos) oder mehr.' };
  if (!(w.einschwing >= 0 && w.einschwing < w.an)) return { fehler: '„Prüfen ab“ muss kürzer sein als die An-Zeit.' };
  if (!(w.min >= 0 && w.max > w.min)) return { fehler: 'Stromfenster: höchstens muss größer sein als mindestens.' };
  return w;
}

function ztZeichnen() {
  $('zt-ok').textContent = zt.ok.toLocaleString('de-DE');
  $('zt-fehl').textContent = zt.fehler.toLocaleString('de-DE');
  $('zt-protokoll').innerHTML = zt.protokoll.length ? zt.protokoll.slice(-300).reverse().map(p =>
    `<div class="raster-zt"><div>${p.nr}</div><div>${uhrzeit(p.t)}</div><div>${Number.isFinite(p.min) ? zahl(p.min, 3) + ' A' : '–'}</div><div>${Number.isFinite(p.max) ? zahl(p.max, 3) + ' A' : '–'}</div>`
    + `<div class="${p.gut ? 'gut-text' : 'schlecht-text'}">${escapeHtml(p.text)}</div></div>`).join('') : '<div class="leer">Noch keine Zyklen.</div>';
}

async function ztStarten() {
  if (!zustand.geraet) { $('zt-phase').textContent = 'erst verbinden'; return; }
  const w = ztLesen();
  if (w.fehler) { $('zt-phase').textContent = ''; meldung(w.fehler); return; }
  if (!automatikBelegen('zyklen', 'Zyklentest', g => { zt.abbruch = g ?? 'gestoppt'; })) return;
  Object.assign(zt, { laeuft: true, abbruch: null, protokoll: [], ok: 0, fehler: 0 });
  for (const id of [...Object.keys(ZT_FELDER), 'zt-start']) $(id).disabled = true;
  $('zt-stopp').disabled = false;
  statusPille('zt-status', 'läuft', 'laeuft');
  ztZeichnen();
  let haltGrund = null;
  try {
    await ausgangSchalten(false, true);
    await sollwerteSetzen({ volt: w.volt, curr: w.curr, ovp: ovpZu(w.volt), ocp: ocpZu(w.curr) }, true);
    ereignisSetzen(`Zyklentest: ${feldZahl(w.volt)} V, ${w.an} s an / ${w.aus} s aus, Strom ${feldZahl(w.min)}–${feldZahl(w.max)} A`);
    for (let nr = 1; (w.zyklen === 0 || nr <= w.zyklen) && !zt.abbruch; nr++) {
      $('zt-nr').textContent = w.zyklen ? `${nr} / ${w.zyklen}` : String(nr);
      chipSetzen('zyklen', 'Zyklentest', w.zyklen ? `${nr}/${w.zyklen}` : `${nr}`);
      balken('zt-balken', w.zyklen ? (nr - 1) / w.zyklen : 0);
      // An-Phase: einschwingen lassen, dann jede Messung gegen das Stromfenster prüfen
      await ausgangSchalten(true, true);
      const an = Date.now(), pruefAb = an + w.einschwing * 1000, ende = an + w.an * 1000;
      let lo = Infinity, hi = -Infinity, schlecht = null;
      $('zt-phase').textContent = 'an';
      while (Date.now() < ende && !zt.abbruch) {
        const ab = Math.max(Date.now(), pruefAb);
        const rec = await messungAb(ab, ab - Date.now() + 6000);
        if (rec.t > ende) break;
        lo = Math.min(lo, rec.i); hi = Math.max(hi, rec.i);
        if (!schlecht && (rec.i < w.min || rec.i > w.max)) schlecht = rec.i < w.min ? `Strom ${zahl(rec.i, 3)} A zu klein` : `Strom ${zahl(rec.i, 3)} A zu groß`;
        if (schlecht && w.beiFehler === 'halt') break;
      }
      await ausgangSchalten(false, true);
      if (zt.abbruch) break;
      const gut = !schlecht && Number.isFinite(lo);
      gut ? zt.ok++ : zt.fehler++;
      zt.protokoll.push({ nr, t: Date.now(), min: lo, max: hi, gut, text: gut ? 'in Ordnung' : schlecht ?? 'keine Messung' });
      ztZeichnen();
      if (!gut) {
        ereignisSetzen(`Zyklentest: Zyklus ${nr} – ${schlecht ?? 'keine Messung'}`);
        if (w.beiFehler === 'halt') { haltGrund = `Fehler in Zyklus ${nr}: ${schlecht ?? 'keine Messung'}`; break; }
      }
      // Aus-Phase
      $('zt-phase').textContent = 'aus';
      const ausEnde = Date.now() + w.aus * 1000;
      while (Date.now() < ausEnde && !zt.abbruch) await warten(100);
    }
  } catch (e) {
    zt.abbruch = e.message;
  } finally {
    await ausgangSchalten(false, true);
    zt.laeuft = false;
    automatikFreigeben('zyklen');
    for (const id of [...Object.keys(ZT_FELDER), 'zt-start']) $(id).disabled = false;
    $('zt-stopp').disabled = true;
    $('zt-phase').textContent = 'aus';
    const text = zt.abbruch ? `gestoppt (${zt.abbruch})` : haltGrund ?? 'fertig';
    statusPille('zt-status', haltGrund ? 'Fehler' : zt.abbruch ? 'gestoppt' : 'fertig', haltGrund ? 'fehler' : zt.abbruch ? '' : 'fertig');
    if (!zt.abbruch && !haltGrund) balken('zt-balken', 1);
    ereignisSetzen(`Zyklentest ${text}: ${zt.ok} in Ordnung, ${zt.fehler} Fehler`);
    haltGrund ? ton(330, 0.5) : ton(880, 0.2);
    aufmerksamkeit();
    await sollwerteLesen().catch(() => {});
    anzeigeAktualisieren();
  }
}

$('zt-start').addEventListener('click', ztStarten);
$('zt-stopp').addEventListener('click', () => { if (zt.laeuft) zt.abbruch = 'von Hand'; });
$('zt-stopp').disabled = true;
$('zt-csv').addEventListener('click', async () => {
  const zeilen = ['Zyklus;Zeit;Strom min [A];Strom max [A];Ergebnis',
    ...zt.protokoll.map(p => [p.nr, new Date(p.t).toLocaleString('de-DE'), csvZahl(p.min), csvZahl(p.max), csvText(p.text)].join(';'))];
  const pfad = await window.spm?.csvSpeichern(`Zyklentest_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`, '﻿' + zeilen.join('\r\n'));
  if (pfad) log('Protokoll gespeichert: ' + pfad, 'info');
});

seitenHoerer['seite-pruefstand'] = () => { eeDiagramm(); eeProtokollZeichnen(); ztZeichnen(); };
eeProtokollZeichnen();
ztZeichnen();
