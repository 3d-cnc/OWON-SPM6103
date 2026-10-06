'use strict';
/* SPM-16: Laufend speichern – die Aufzeichnung wandert schon während der Messung Zeile für Zeile
   in eine CSV-Datei (gleiches Format wie „Als CSV speichern“). Entweder eine Datei für die ganze
   Sitzung (beginnt mit allem, was schon aufgezeichnet ist) oder je Einschalten des Ausgangs eine. */

const ls = { oeffnet: false, datei: null, pfad: '', ab: 0, bis: null, t0: 0, geschrieben: 0, zuletzt: null, daten: null, schreibt: false, fehler: '' };
const lsEinst = { an: false, modus: 'sitzung', ordner: '', ...speicher.lesen('laufend', {}) };
const lsMerken = () => speicher.schreiben('laufend', lsEinst);

$('ls-an').checked = lsEinst.an;
document.querySelector(`input[name=ls-modus][value=${lsEinst.modus === 'ausgang' ? 'ausgang' : 'sitzung'}]`).checked = true;

const lsDateiname = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `SPM6103_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.csv`;
};

async function lsOeffnen(abIndex) {
  if (!window.spm || ls.datei || ls.oeffnet) return;   // nur eine Datei zur Zeit, auch während sie noch angelegt wird
  const erster = zustand.daten[abIndex];
  if (!erster) return;
  ls.oeffnet = true;
  try {
    const r = await window.spm.dateiBeginnen(lsEinst.ordner, lsDateiname(erster.t), CSV_KOPF);
    Object.assign(ls, { datei: r.id, pfad: r.pfad, ab: abIndex, bis: null, t0: erster.t, geschrieben: 0, daten: zustand.daten, fehler: '' });
    log('Laufendes Speichern: ' + r.pfad, 'info');
  } catch (e) {
    ls.fehler = 'Datei lässt sich nicht anlegen: ' + e.message;
    lsEinst.an = false; $('ls-an').checked = false; lsMerken();
  } finally {
    ls.oeffnet = false;
  }
  lsAnzeigen();
}

// Schreibt alles Neue; mit bis wird die Datei danach geschlossen
async function lsSchreiben(schliessen = false) {
  if (!ls.datei || ls.schreibt) return;
  ls.schreibt = true;
  try {
    const ende = ls.bis ?? ls.daten.length;
    if (ende > ls.ab) {
      const text = ls.daten.slice(ls.ab, ende).map(r => csvZeile(r, ls.t0)).join('\r\n') + '\r\n';
      if (!await window.spm.dateiAnhaengen(ls.datei, text)) throw new Error('Datei nicht mehr offen');
      ls.geschrieben += ende - ls.ab;
      ls.ab = ende;
      ls.zuletzt = Date.now();
      // Ganze Sitzung in der Datei: dann gilt die Aufzeichnung als gespeichert (keine Rückfrage beim Beenden)
      if (lsEinst.modus === 'sitzung' && ls.daten === zustand.daten && ls.t0 === zustand.daten[0]?.t) zustand.gespeichert = Math.max(zustand.gespeichert, ende);
    }
    if (schliessen || ls.bis !== null) {
      await window.spm.dateiSchliessen(ls.datei);
      log(`Laufendes Speichern beendet: ${ls.geschrieben.toLocaleString('de-DE')} Zeilen in ${ls.pfad}`, 'info');
      ls.datei = null; ls.bis = null;
    }
  } catch (e) {
    ls.fehler = 'Schreiben fehlgeschlagen: ' + e.message;
    ls.datei = null;
  } finally {
    ls.schreibt = false;
    lsAnzeigen();
  }
}

messHoerer.push(rec => {
  if (!lsEinst.an || !window.spm) return;
  // Aufzeichnung geleert? Dann die alte Datei abschließen, die nächste Messung beginnt eine neue
  if (ls.datei && ls.daten !== zustand.daten) { ls.bis = ls.daten.length; lsSchreiben(true); return; }
  const index = zustand.daten.length - 1;
  if (lsEinst.modus === 'sitzung') {
    if (!ls.datei) lsOeffnen(0);
  } else if (rec.ausgang && !ls.datei) {
    lsOeffnen(index);
  } else if (!rec.ausgang && ls.datei && ls.bis === null) {
    ls.bis = index + 1;   // die Messung mit Ausgang aus noch mitnehmen
    lsSchreiben(true);
  }
});
setInterval(() => { if (ls.datei) lsSchreiben(); }, 1000);
trennHoerer.push(() => { if (ls.datei) { ls.bis = ls.daten.length; lsSchreiben(true); } });
window.addEventListener('beforeunload', () => { if (ls.datei) lsSchreiben(true); });

function lsAnzeigen() {
  $('ls-ordner').textContent = lsEinst.ordner || '–';
  const status = !lsEinst.an ? ['aus', ''] : ls.datei ? ['schreibt', 'laeuft'] : lsEinst.modus === 'ausgang' ? ['wartet auf Ausgang', ''] : zustand.geraet ? ['startet …', ''] : ['wartet auf Verbindung', ''];
  statusPille('ls-status', ...status);
  $('ls-info').textContent = ls.fehler || (ls.datei
    ? `${ls.pfad.split(/[\\/]/).pop()} · ${ls.geschrieben.toLocaleString('de-DE')} Zeilen${ls.zuletzt ? ' · zuletzt ' + uhrzeit(ls.zuletzt) : ''}`
    : 'Nach einem Absturz oder Stromausfall ist dann nichts verloren.');
  $('ls-info').style.color = ls.fehler ? 'var(--err)' : '';
  if (lsEinst.an && ls.datei) chipSetzen('laufend', 'Speichert', `${ls.geschrieben.toLocaleString('de-DE')} Zeilen`, () => { $('ls-an').checked = false; $('ls-an').dispatchEvent(new Event('change')); });
  else chipEntfernen('laufend');
}

$('ls-an').addEventListener('change', e => {
  lsEinst.an = e.target.checked; ls.fehler = '';
  lsMerken();
  if (!lsEinst.an && ls.datei) { ls.bis = ls.daten.length; lsSchreiben(true); }
  else if (lsEinst.an && lsEinst.modus === 'sitzung' && zustand.daten.length) lsOeffnen(0);
  lsAnzeigen();
});
document.querySelectorAll('input[name=ls-modus]').forEach(r => r.addEventListener('change', () => {
  lsEinst.modus = document.querySelector('input[name=ls-modus]:checked').value;
  lsMerken();
  if (ls.datei) { ls.bis = ls.daten.length; lsSchreiben(true); }
  lsAnzeigen();
}));
$('ls-ordner-waehlen').addEventListener('click', async () => {
  const ordner = await window.spm?.ordnerWaehlen(lsEinst.ordner);
  if (!ordner) return;
  lsEinst.ordner = ordner; lsMerken();
  if (ls.datei) { ls.bis = ls.daten.length; await lsSchreiben(true); }
  lsAnzeigen();
});
$('ls-ordner-oeffnen').addEventListener('click', () => window.spm?.ordnerOeffnen(lsEinst.ordner));

(async () => {
  if (!lsEinst.ordner && window.spm) { lsEinst.ordner = await window.spm.ordnerVorgabe(); lsMerken(); }
  lsAnzeigen();
})();
