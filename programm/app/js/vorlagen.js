'use strict';
/* SPM-10: Sollwert-Vorlagen – Lieblingswerte als Knöpfe im Netzteil-Feld.
   Klick setzt Spannung, Strom, OVP und OCP; bei eingeschaltetem Ausgang erst nach Rückfrage.
   „+“ speichert die aktuellen Sollwerte als neue Vorlage, Rechtsklick löscht eine. */

const VORLAGEN_VORGABE = [
  { name: '3,3 V Logik', volt: 3.3, curr: 0.5 },
  { name: '5 V USB', volt: 5, curr: 1 },
  { name: '12 V', volt: 12, curr: 2 },
  { name: '24 V', volt: 24, curr: 1 },
];
let vorlagen = speicher.lesen('vorlagen', VORLAGEN_VORGABE);

function vorlagenZeichnen() {
  const box = $('vorlagen');
  box.innerHTML = '<span class="titel">Vorlagen</span>';
  for (const [nr, v] of vorlagen.entries()) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'vorlage';
    k.dataset.nr = nr;
    k.title = `${v.name}: ${feldZahl(v.volt)} V, ${feldZahl(v.curr)} A, OVP ${feldZahl(v.ovp ?? ovpZu(v.volt), 2)} V, OCP ${feldZahl(v.ocp ?? ocpZu(v.curr), 2)} A – Rechtsklick: löschen`;
    k.innerHTML = '<span></span><small></small>';
    k.querySelector('span').textContent = v.name;
    k.querySelector('small').textContent = `${feldZahl(v.volt, 2)} V · ${feldZahl(v.curr, 3)} A`;
    k.disabled = !zustand.geraet;
    k.addEventListener('click', () => vorlageAnwenden(v));
    k.addEventListener('contextmenu', async e => {
      e.preventDefault();
      if (await bestaetigen('Vorlage löschen', `„${v.name}“ aus den Vorlagen entfernen?`, 'Löschen')) {
        vorlagen.splice(nr, 1);
        speicher.schreiben('vorlagen', vorlagen);
        vorlagenZeichnen();
      }
    });
    box.appendChild(k);
  }
  const neu = document.createElement('button');
  neu.type = 'button';
  neu.className = 'vorlage neu';
  neu.textContent = '+';
  neu.title = 'Aktuelle Sollwerte als Vorlage speichern';
  neu.disabled = !zustand.geraet || !zustand.soll;
  neu.addEventListener('click', vorlageAnlegen);
  box.appendChild(neu);
}

async function vorlageAnwenden(v) {
  if (!zustand.geraet) return;
  if (automatik.name) { meldung('Während eine Automatik läuft, bitte keine Vorlage setzen – erst stoppen.'); return; }
  const text = `${feldZahl(v.volt)} V, ${feldZahl(v.curr)} A, OVP ${feldZahl(v.ovp ?? ovpZu(v.volt), 2)} V, OCP ${feldZahl(v.ocp ?? ocpZu(v.curr), 2)} A`;
  if (zustand.ausgang && !await bestaetigen('Vorlage setzen', `Der Ausgang ist eingeschaltet. „${v.name}“ jetzt setzen? (${text})`, 'Setzen')) return;
  await sollwerteSetzen({ volt: v.volt, curr: v.curr, ovp: v.ovp ?? ovpZu(v.volt), ocp: v.ocp ?? ocpZu(v.curr) });
  log(`Vorlage „${v.name}“: ${text}`, 'info');
}

async function vorlageAnlegen() {
  const s = zustand.soll;
  if (!s) return;
  const vorschlag = `${feldZahl(s.volt, 2)} V`;
  const name = await eingabeFragen('Vorlage speichern', `Spannung ${feldZahl(s.volt)} V, Strom ${feldZahl(s.curr)} A, OVP ${feldZahl(s.ovp, 2)} V, OCP ${feldZahl(s.ocp, 2)} A – unter welchem Namen?`, vorschlag);
  if (!name?.trim()) return;
  vorlagen.push({ name: name.trim().slice(0, 30), volt: s.volt, curr: s.curr, ovp: s.ovp, ocp: s.ocp });
  speicher.schreiben('vorlagen', vorlagen);
  vorlagenZeichnen();
}

vorlagenZeichnen();
// Knöpfe freigeben, sobald verbunden; nach dem Trennen sperren
let vorlagenVerbunden = null;
messHoerer.push(() => { const an = !!zustand.geraet && !!zustand.soll; if (an !== vorlagenVerbunden) { vorlagenVerbunden = an; vorlagenZeichnen(); } });
trennHoerer.push(() => { vorlagenVerbunden = null; setTimeout(vorlagenZeichnen); });
