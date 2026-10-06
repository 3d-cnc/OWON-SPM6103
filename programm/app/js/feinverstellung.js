'use strict';
/* SPM-22: Sollwerte feinfühlig verstellen wie am Drehknopf.
   Mausrad über einem Sollwert-Feld (oder Pfeil hoch/runter im Eingabefeld) ändert den Wert in Schritten:
   ohne Taste fein, mit Umschalt mittel, mit Strg grob. Gesendet wird, sobald das Drehen kurz ruht. */

const FEIN = {
  'VOLT': { soll: 'volt', schritte: [0.01, 0.1, 1], max: GRENZE.volt, einheit: 'V', stellen: 2 },
  'CURR': { soll: 'curr', schritte: [0.001, 0.01, 0.1], max: GRENZE.curr, einheit: 'A', stellen: 3 },
  'VOLT:LIM': { soll: 'ovp', schritte: [0.01, 0.1, 1], max: GRENZE.ovp, einheit: 'V', stellen: 2 },
  'CURR:LIM': { soll: 'ocp', schritte: [0.001, 0.01, 0.1], max: GRENZE.ocp, einheit: 'A', stellen: 3 },
};
const fein = { offen: new Map(), uhr: new Map() };   // je Befehl: noch nicht gesendeter Wert, Wartezeit

function feinSchritt(e, f) { return e.ctrlKey ? f.schritte[2] : e.shiftKey ? f.schritte[1] : f.schritte[0]; }

function feinAendern(befehlName, richtung, schritt) {
  const f = FEIN[befehlName];
  if (!zustand.geraet || !zustand.soll || automatik.name) return;
  const basis = fein.offen.get(befehlName) ?? zustand.soll[f.soll];
  if (!Number.isFinite(basis)) return;
  // einfach dazuzählen (wie ein Drehknopf), nur auf die feinste Auflösung runden – nicht auf den Schritt einrasten
  let neu = Math.round((basis + richtung * schritt) / f.schritte[0]) * f.schritte[0];
  neu = Math.min(f.max, Math.max(0, +neu.toFixed(f.stellen + 1)));
  // Sollwert nie über die eigene Schutzgrenze drehen – sonst löst OVP/OCP aus
  const grenze = befehlName === 'VOLT' ? zustand.soll.ovp : befehlName === 'CURR' ? zustand.soll.ocp : null;
  let hinweis = '';
  if (Number.isFinite(grenze) && neu >= grenze) {
    neu = +(grenze - f.schritte[0]).toFixed(f.stellen + 1);
    hinweis = ` (begrenzt: ${befehlName === 'VOLT' ? 'OVP' : 'OCP'} ${feldZahl(grenze, f.stellen)} ${f.einheit})`;
  }
  fein.offen.set(befehlName, neu);
  const anzeige = $(befehlName === 'VOLT' ? 's-volt' : befehlName === 'CURR' ? 's-curr' : befehlName === 'VOLT:LIM' ? 's-ovp' : 's-ocp');
  anzeige.textContent = `→ ${zahl(neu, f.stellen)} ${f.einheit}`;
  anzeige.style.color = 'var(--warn)';
  anzeige.title = hinweis ? 'Begrenzt' + hinweis : '';
  clearTimeout(fein.uhr.get(befehlName));
  fein.uhr.set(befehlName, setTimeout(() => feinSenden(befehlName, hinweis), 350));
}

async function feinSenden(befehlName, hinweis) {
  const wert = fein.offen.get(befehlName);
  if (wert === undefined) return;
  await befehl(`${befehlName} ${scpiZahl(wert)}`);
  fein.offen.delete(befehlName);
  if (hinweis) log('Feinverstellung' + hinweis, 'info');
  await sollwerteLesen().catch(() => {});
  for (const id of ['s-volt', 's-curr', 's-ovp', 's-ocp']) { $(id).style.color = ''; $(id).title = ''; }
  anzeigeAktualisieren();
}

document.querySelectorAll('.sollwert').forEach(box => {
  const knopf = box.querySelector('[data-setze]');
  const befehlName = knopf.dataset.setze, f = FEIN[befehlName], feld = $(knopf.dataset.feld);
  box.title = `Mausrad: ±${zahl(f.schritte[0], f.stellen)} ${f.einheit} · mit Umschalt ±${zahl(f.schritte[1], f.stellen)} · mit Strg ±${zahl(f.schritte[2], f.stellen)}`;
  box.addEventListener('wheel', e => {
    if (!zustand.geraet) return;
    e.preventDefault();
    feinAendern(befehlName, e.deltaY < 0 ? 1 : -1, feinSchritt(e, f));
  }, { passive: false });
  // Pfeiltasten im leeren Eingabefeld wirken wie das Mausrad
  feld.addEventListener('keydown', e => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !feld.value.trim()) {
      e.preventDefault();
      feinAendern(befehlName, e.key === 'ArrowUp' ? 1 : -1, feinSchritt(e, f));
    }
  });
});
