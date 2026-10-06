'use strict';
/* SPM-19: Bauteilprüfung Gut/Schlecht – Sollwert mit Toleranz (oder Bereich), das Multimeter zeigt
   groß Grün oder Rot, zählt gute und schlechte Teile und schreibt ein Protokoll.
   Automatisch gezählt wird, wenn der Wert dreimal ruhig steht; das nächste Teil erst nach „OL“
   (nichts angeschlossen) oder einer deutlichen Änderung. Gezählt wird nur, solange der Tab offen ist. */

const BT_VORGABE = { funktion: 'RES', art: 'toleranz', soll: '4,7k', tol: '5', min: '0,55', max: '0,7', auto: true, ton: true };
const btEinst = { ...BT_VORGABE, ...speicher.lesen('bauteile', {}) };
const bt = { phase: 'warten', fenster: [], letzter: null, protokoll: [], gut: 0, schlecht: 0, aktuell: NaN };

for (const [k, f] of Object.entries(FUNKTIONEN)) $('bt-funktion').add(new Option(f.name, k));
$('bt-funktion').value = btEinst.funktion;
$('bt-art').value = btEinst.art;
$('bt-soll').value = btEinst.soll; $('bt-tol').value = btEinst.tol;
$('bt-min').value = btEinst.min; $('bt-max').value = btEinst.max;
$('bt-auto').checked = btEinst.auto; $('bt-ton').checked = btEinst.ton;

function btMerken() {
  Object.assign(btEinst, {
    funktion: $('bt-funktion').value, art: $('bt-art').value, soll: $('bt-soll').value, tol: $('bt-tol').value,
    min: $('bt-min').value, max: $('bt-max').value, auto: $('bt-auto').checked, ton: $('bt-ton').checked,
  });
  speicher.schreiben('bauteile', btEinst);
}
function btArtZeigen() {
  document.querySelectorAll('#seite-bauteile [data-art]').forEach(el => { el.hidden = el.dataset.art !== $('bt-art').value; });
}
for (const id of ['bt-art', 'bt-soll', 'bt-tol', 'bt-min', 'bt-max', 'bt-auto', 'bt-ton']) $(id).addEventListener('change', () => { btMerken(); btArtZeigen(); btAnzeigen(); });
$('bt-funktion').addEventListener('change', async () => {
  btMerken();
  const f = FUNKTIONEN[btEinst.funktion];
  if (zustand.geraet && f) { await befehl(f.befehl); if (f.auto) await befehl(f.auto + ' ON'); }
  bt.fenster = []; bt.phase = 'warten';
  btAnzeigen();
});
btArtZeigen();

const btEinheit = () => FUNKTIONEN[btEinst.funktion]?.einheit ?? '';

// Untere und obere Grenze, dazu der Sollwert für die Abweichung (bei „Bereich“ die Mitte)
function btGrenzen() {
  if (btEinst.art === 'bereich') {
    const a = zahlLesen(btEinst.min), b = zahlLesen(btEinst.max);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
    return { min: a, max: b, soll: (a + b) / 2, text: `${mitEinheitText(a, btEinheit())} … ${mitEinheitText(b, btEinheit())}` };
  }
  const s = zahlLesen(btEinst.soll), t = zahlLesen(btEinst.tol);
  if (!Number.isFinite(s) || !(t >= 0)) return null;
  const d = Math.abs(s) * t / 100;
  return { min: s - d, max: s + d, soll: s, text: `${mitEinheitText(s, btEinheit())} ± ${feldZahl(t, 2)} %` };
}

function btUrteil(v) {
  const g = btGrenzen();
  if (!g || !Number.isFinite(v)) return null;
  return { gut: v >= g.min && v <= g.max, abw: g.soll ? (v - g.soll) / Math.abs(g.soll) * 100 : NaN };
}

function btZaehlen(v, wie = 'automatisch') {
  const u = btUrteil(v);
  if (!u) { $('bt-abw').textContent = 'Sollwert/Toleranz bzw. Bereich prüfen'; return; }
  u.gut ? bt.gut++ : bt.schlecht++;
  bt.protokoll.push({ nr: bt.protokoll.length + 1, t: Date.now(), v, abw: u.abw, gut: u.gut, wie });
  if (btEinst.ton) u.gut ? ton(1320, 0.12) : ton(330, 0.35);
  const urteil = $('bt-urteil');
  urteil.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 250 });
  btAnzeigen();
}

function btAnzeigen() {
  const urteil = $('bt-urteil'), v = bt.aktuell, f = FUNKTIONEN[btEinst.funktion];
  const g = btGrenzen();
  urteil.classList.remove('gut', 'schlecht');
  if (!zustand.geraet) {
    $('bt-wert').textContent = '–'; $('bt-text').textContent = 'Nicht verbunden'; $('bt-abw').textContent = '';
  } else if (zustand.funktion !== btEinst.funktion) {
    $('bt-wert').textContent = '–';
    $('bt-text').textContent = `Multimeter auf „${f?.name}“ stellen`;
    $('bt-abw').textContent = 'Messfunktion oben links wählen – das stellt das Gerät um';
  } else if (!Number.isFinite(v)) {
    $('bt-wert').textContent = 'OL';
    $('bt-text').textContent = 'Bauteil anlegen …';
    $('bt-abw').textContent = g ? g.text : 'Sollwert/Toleranz bzw. Bereich prüfen';
  } else {
    const u = btUrteil(v);
    $('bt-wert').textContent = bt.anzeige ?? mitEinheitText(v, btEinheit());
    $('bt-text').textContent = !u ? 'Sollwert fehlt' : u.gut ? 'GUT' : 'AUSSERHALB';
    $('bt-abw').textContent = u ? `${Number.isFinite(u.abw) ? (u.abw >= 0 ? '+' : '') + zahl(u.abw, 2) + ' %' : ''}  ·  ${g.text}` + (bt.phase === 'gezaehlt' ? '  ·  gezählt' : '') : '';
    if (u) urteil.classList.add(u.gut ? 'gut' : 'schlecht');
  }
  const n = bt.gut + bt.schlecht;
  $('bt-gut').textContent = bt.gut.toLocaleString('de-DE');
  $('bt-schlecht').textContent = bt.schlecht.toLocaleString('de-DE');
  $('bt-gesamt').textContent = n.toLocaleString('de-DE');
  $('bt-ausbeute').textContent = n ? zahl(bt.gut / n * 100, 1) + ' %' : '–';
  const liste = $('bt-protokoll');
  liste.innerHTML = bt.protokoll.length ? bt.protokoll.slice(-300).reverse().map(p =>
    `<div class="raster-bt"><div>${p.nr}</div><div>${uhrzeit(p.t)}</div><div>${escapeHtml(mitEinheitText(p.v, btEinheit()))}</div>`
    + `<div>${Number.isFinite(p.abw) ? (p.abw >= 0 ? '+' : '') + zahl(p.abw, 2) + ' %' : '–'}</div><div class="${p.gut ? 'gut-text' : 'schlecht-text'}">${p.gut ? 'gut' : 'außerhalb'}</div></div>`).join('')
    : '<div class="leer">Noch keine Bauteile gezählt.</div>';
}

messHoerer.push(rec => {
  if (!tabAktiv('seite-bauteile')) return;
  const passt = rec.dmmFunktion === btEinst.funktion;
  const v = passt ? rec.dmm : NaN;
  bt.aktuell = v;
  bt.anzeige = passt && rec.dmmText ? rec.dmmText : null;
  if (passt && btEinst.auto) {
    if (!Number.isFinite(v)) { bt.phase = 'warten'; bt.fenster = []; }
    else {
      bt.fenster = [...bt.fenster.slice(-2), v];
      const lo = Math.min(...bt.fenster), hi = Math.max(...bt.fenster), mitte = (lo + hi) / 2;
      const ruhig = bt.fenster.length === 3 && hi - lo <= Math.max(Math.abs(mitte) * 0.003, 1e-12);
      if (bt.phase === 'gezaehlt' && Math.abs(v - bt.letzter) > Math.abs(bt.letzter) * 0.05) { bt.phase = 'warten'; bt.fenster = [v]; }
      else if (bt.phase === 'warten' && ruhig) { bt.phase = 'gezaehlt'; bt.letzter = mitte; btZaehlen(mitte); return; }
    }
  }
  btAnzeigen();
});

$('bt-zaehlen').addEventListener('click', () => {
  if (Number.isFinite(bt.aktuell)) { bt.phase = 'gezaehlt'; bt.letzter = bt.aktuell; btZaehlen(bt.aktuell, 'von Hand'); }
});
window.addEventListener('keydown', e => {
  const tippt = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  if (e.code === 'Space' && tabAktiv('seite-bauteile') && !tippt && !document.querySelector('dialog[open]')) { e.preventDefault(); $('bt-zaehlen').click(); }
});
$('bt-zurueck').addEventListener('click', async () => {
  if (bt.protokoll.length && !await bestaetigen('Zähler zurücksetzen', `${bt.protokoll.length} gezählte Bauteile und das Protokoll verwerfen?`, 'Zurücksetzen')) return;
  Object.assign(bt, { gut: 0, schlecht: 0, protokoll: [], phase: 'warten', fenster: [] });
  btAnzeigen();
});
$('bt-csv').addEventListener('click', async () => {
  const g = btGrenzen();
  const zeilen = ['Nr;Zeit;Wert;Einheit;Abweichung [%];Urteil;Prüfung;Gezählt',
    ...bt.protokoll.map(p => [p.nr, new Date(p.t).toLocaleString('de-DE'), csvZahl(p.v), btEinheit(), csvZahl(+p.abw.toFixed(3)), p.gut ? 'gut' : 'außerhalb', csvText(g?.text), p.wie].join(';'))];
  const pfad = await window.spm?.csvSpeichern(`Bauteilpruefung_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`, '﻿' + zeilen.join('\r\n'));
  if (pfad) log('Protokoll gespeichert: ' + pfad, 'info');
});
seitenHoerer['seite-bauteile'] = () => { bt.fenster = []; btAnzeigen(); };
trennHoerer.push(() => setTimeout(btAnzeigen));
btAnzeigen();
