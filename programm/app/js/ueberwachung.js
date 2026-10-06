'use strict';
/* SPM-11: Abschaltbedingungen – Ausgang aus nach Zeit, Energie, Ladung oder wenn der Strom unter einen Wert fällt.
   SPM-12: Grenzwerte mit Alarm – eigene Schwellen für U, I, P und Multimeter; Ton, rote Leiste,
   blinkende Taskleiste, wahlweise Ausgang aus. Beide laufen neben den anderen Automatiken her. */

/* ======================= Abschalten ======================= */

const AB_FELDER = ['ab-zeit-an', 'ab-h', 'ab-min', 'ab-s', 'ab-wh-an', 'ab-wh', 'ab-ah-an', 'ab-mah', 'ab-unter-an', 'ab-unter', 'ab-unter-s'];
const abVorgabe = { 'ab-zeit-an': true, 'ab-h': '0', 'ab-min': '30', 'ab-s': '0', 'ab-wh-an': false, 'ab-wh': '10', 'ab-ah-an': false, 'ab-mah': '1000', 'ab-unter-an': false, 'ab-unter': '0,05', 'ab-unter-s': '10' };
const abGespeichert = { ...abVorgabe, ...speicher.lesen('abschalten', {}) };
for (const id of AB_FELDER) {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = !!abGespeichert[id]; else el.value = abGespeichert[id];
  el.addEventListener('change', () => {
    speicher.schreiben('abschalten', Object.fromEntries(AB_FELDER.map(f => [f, $(f).type === 'checkbox' ? $(f).checked : $(f).value])));
  });
}

const ab = { aktiv: false, ziele: null, zeitAn: 0, energie: 0, ladung: 0, warUeber: false, unterSeit: null, vorher: null };

function abZieleLesen() {
  const z = {};
  if ($('ab-zeit-an').checked) {
    const s = (zahlLesen($('ab-h').value) || 0) * 3600 + (zahlLesen($('ab-min').value) || 0) * 60 + (zahlLesen($('ab-s').value) || 0);
    if (!(s > 0)) return { fehler: 'Bitte eine Zeit größer null eingeben.' };
    z.zeit = s;
  }
  if ($('ab-wh-an').checked) {
    const wh = zahlLesen($('ab-wh').value);
    if (!(wh > 0)) return { fehler: 'Bitte eine Energie in Wh eingeben.' };
    z.energie = wh * 3600;
  }
  if ($('ab-ah-an').checked) {
    const mah = zahlLesen($('ab-mah').value);
    if (!(mah > 0)) return { fehler: 'Bitte eine Ladung in mAh eingeben.' };
    z.ladung = mah * 3.6;
  }
  if ($('ab-unter-an').checked) {
    const a = zahlLesen($('ab-unter').value), s = zahlLesen($('ab-unter-s').value);
    if (!(a > 0) || !(s >= 0)) return { fehler: 'Bitte Strom und Dauer für „Strom fällt unter“ eingeben.' };
    z.unter = a; z.unterS = s;
  }
  if (!Object.keys(z).length) return { fehler: 'Mindestens eine Bedingung anhaken.' };
  return z;
}

function abStarten() {
  if (!zustand.geraet) { $('ab-info').textContent = 'Erst verbinden.'; return; }
  const z = abZieleLesen();
  if (z.fehler) { $('ab-info').textContent = z.fehler; return; }
  Object.assign(ab, { aktiv: true, ziele: z, zeitAn: 0, energie: 0, ladung: 0, warUeber: false, unterSeit: null, vorher: null, start: Date.now() });
  for (const id of AB_FELDER) $(id).disabled = true;
  $('ab-info').textContent = `Überwacht seit ${uhrzeit(ab.start)}.` + (zustand.ausgang ? '' : ' Der Ausgang ist aus – die Zeit läuft, sobald er an ist.');
  statusPille('ab-status', 'überwacht', 'laeuft');
  chipSetzen('abschalten', 'Abschalten', '', () => abBeenden('beendet'));
  abAnzeigen();
}

function abBeenden(grund) {
  if (!ab.aktiv) return;
  ab.aktiv = false;
  for (const id of AB_FELDER) $(id).disabled = false;
  chipEntfernen('abschalten');
  if (grund === 'beendet') { statusPille('ab-status', 'aus'); $('ab-info').textContent = 'Überwachung beendet, ohne abzuschalten.'; }
  else if (grund) { statusPille('ab-status', 'aus'); $('ab-info').textContent = 'Überwachung beendet: ' + grund; }
}

async function abAusloesen(grund) {
  ab.aktiv = false;
  for (const id of AB_FELDER) $(id).disabled = false;
  chipEntfernen('abschalten');
  await ausgangSchalten(false);
  ereignisSetzen('Abgeschaltet: ' + grund);
  statusPille('ab-status', 'abgeschaltet', 'fertig');
  $('ab-info').textContent = `${uhrzeit(Date.now())}: Ausgang ausgeschaltet – ${grund}.`;
  ton(660, 0.2); setTimeout(() => ton(660, 0.2), 300); setTimeout(() => ton(880, 0.35), 600);
  aufmerksamkeit();
}

function abAnzeigen() {
  const z = ab.ziele || {};
  const zeile = (balkenId, wertId, aktiv, anteil, text) => {
    balken(balkenId, aktiv ? anteil : 0);
    $(wertId).textContent = aktiv ? text : '';
  };
  zeile('ab-zeit-balken', 'ab-zeit-wert', ab.aktiv && z.zeit, ab.zeitAn / z.zeit, `noch ${dauerKurz(z.zeit - ab.zeitAn)}`);
  zeile('ab-wh-balken', 'ab-wh-wert', ab.aktiv && z.energie, ab.energie / z.energie, `${mitEinheitText(ab.energie / 3600, 'Wh')} von ${feldZahl(z.energie / 3600)} Wh`);
  zeile('ab-ah-balken', 'ab-ah-wert', ab.aktiv && z.ladung, ab.ladung / z.ladung, `${feldZahl(ab.ladung / 3.6, 1)} von ${feldZahl(z.ladung / 3.6, 0)} mAh`);
  const unterAnteil = ab.unterSeit ? (Date.now() - ab.unterSeit) / 1000 / Math.max(z.unterS, 0.001) : 0;
  zeile('ab-unter-balken', 'ab-unter-wert', ab.aktiv && z.unter, unterAnteil,
    !ab.warUeber ? 'wartet, bis der Strom darüber war' : ab.unterSeit ? `seit ${dauerKurz((Date.now() - ab.unterSeit) / 1000)} darunter` : 'Strom darüber');
  if (ab.aktiv && z.zeit) chipSetzen('abschalten', 'Abschalten', `noch ${dauerKurz(z.zeit - ab.zeitAn)}`);
}

messHoerer.push(rec => {
  if (!ab.aktiv || !Number.isFinite(rec.u)) return;
  const v = ab.vorher, z = ab.ziele;
  if (v) {
    const dt = (rec.t - v.t) / 1000;
    if (dt > 0 && dt <= 10) {
      if (v.ausgang) ab.zeitAn += dt;
      if (Number.isFinite(rec.p) && Number.isFinite(v.p)) ab.energie += (rec.p + v.p) / 2 * dt;
      if (Number.isFinite(rec.i) && Number.isFinite(v.i)) ab.ladung += (rec.i + v.i) / 2 * dt;
    }
  }
  ab.vorher = rec;
  if (z.unter !== undefined) {
    if (rec.i > z.unter) { ab.warUeber = true; ab.unterSeit = null; }
    else if (ab.warUeber && rec.ausgang) ab.unterSeit ??= rec.t;
  }
  abAnzeigen();
  if (z.zeit && ab.zeitAn >= z.zeit) return abAusloesen(`Zeit ${dauerKurz(z.zeit)} erreicht`);
  if (z.energie && ab.energie >= z.energie) return abAusloesen(`${feldZahl(z.energie / 3600)} Wh erreicht`);
  if (z.ladung && ab.ladung >= z.ladung) return abAusloesen(`${feldZahl(z.ladung / 3.6, 0)} mAh erreicht`);
  if (z.unter !== undefined && ab.unterSeit && rec.t - ab.unterSeit >= z.unterS * 1000) return abAusloesen(`Strom ${z.unterS} s unter ${feldZahl(z.unter)} A`);
});
trennHoerer.push(() => abBeenden('Verbindung getrennt'));
$('ab-start').addEventListener('click', abStarten);
$('ab-stopp').addEventListener('click', () => abBeenden('beendet'));
abAnzeigen();

/* ======================= Grenzwerte und Alarme ======================= */

const AL_GROESSEN = {
  u: { name: 'Spannung', einheit: () => 'V' },
  i: { name: 'Strom', einheit: () => 'A' },
  p: { name: 'Leistung', einheit: () => 'W' },
  dmm: { name: 'Multimeter', einheit: () => FUNKTIONEN[zustand.funktion]?.einheit ?? '' },
};
let alRegeln = speicher.lesen('alarme', [
  { an: true, groesse: 'i', vergleich: 'ueber', wert: '1,5', aktion: 'alarm' },
  { an: false, groesse: 'u', vergleich: 'unter', wert: '11', aktion: 'alarm' },
]);
const alLaufzeit = new WeakMap();   // je Regel: Treffer in Folge, schon ausgelöst?
const alZeilen = new WeakMap();     // je Regel: ihre Zeile im Fenster (nicht mitspeichern)
$('al-aktiv').checked = speicher.lesen('alarme-aktiv', false);
$('al-ton').checked = speicher.lesen('alarme-ton', true);

const alSpeichern = () => speicher.schreiben('alarme', alRegeln);

function alZeichnen() {
  const box = $('al-regeln');
  box.innerHTML = '';
  if (!alRegeln.length) box.innerHTML = '<p class="hinweis">Keine Regeln – mit „+ Regel“ anlegen.</p>';
  for (const r of alRegeln) {
    const z = document.createElement('div');
    z.className = 'regel';
    z.innerHTML = `<input type="checkbox" title="Regel an/aus">
      <select data-f="groesse">${Object.entries(AL_GROESSEN).map(([k, g]) => `<option value="${k}">${g.name}</option>`).join('')}</select>
      <select data-f="vergleich"><option value="ueber">über</option><option value="unter">unter</option></select>
      <input type="text" data-f="wert" inputmode="decimal"><span class="einheit"></span>
      <select data-f="aktion"><option value="alarm">nur Alarm</option><option value="aus">Alarm + Ausgang aus</option></select>
      <button type="button" title="Regel löschen">×</button>`;
    const cb = z.querySelector('input[type=checkbox]');
    cb.checked = r.an;
    cb.addEventListener('change', () => { r.an = cb.checked; alSpeichern(); });
    for (const el of z.querySelectorAll('[data-f]')) {
      el.value = r[el.dataset.f];
      el.addEventListener('change', () => {
        r[el.dataset.f] = el.value;
        alLaufzeit.delete(r);
        alSpeichern();
        z.querySelector('.einheit').textContent = AL_GROESSEN[r.groesse].einheit();
        z.querySelector('[data-f=wert]').style.borderColor = Number.isFinite(zahlLesen(r.wert)) ? '' : 'var(--err)';
      });
    }
    z.querySelector('.einheit').textContent = AL_GROESSEN[r.groesse].einheit();
    z.querySelector('button').addEventListener('click', () => { alRegeln.splice(alRegeln.indexOf(r), 1); alSpeichern(); alZeichnen(); });
    alZeilen.set(r, z);
    box.appendChild(z);
  }
}

// Ton wiederholen, bis quittiert
let alTonUhr = null;
function alarmZeigen(text) {
  $('alarm-text').textContent = '⚠ ' + text;
  $('alarm-leiste').classList.add('sichtbar');
  clearInterval(alTonUhr);
  if ($('al-ton').checked) {
    const piep = () => { ton(1200, 0.18, 0.2); setTimeout(() => ton(900, 0.25, 0.2), 220); };
    piep();
    alTonUhr = setInterval(piep, 1500);
  }
  aufmerksamkeit();
}
function alarmQuittieren() {
  $('alarm-leiste').classList.remove('sichtbar');
  clearInterval(alTonUhr); alTonUhr = null;
  document.querySelectorAll('.regel.ausgeloest').forEach(el => el.classList.remove('ausgeloest'));
}

async function alAusloesen(r, wert, grenze) {
  const g = AL_GROESSEN[r.groesse], e = g.einheit();
  let text = `${g.name} ${mitEinheitText(wert, e)} ${r.vergleich === 'ueber' ? 'über' : 'unter'} ${mitEinheitText(grenze, e)}`;
  alZeilen.get(r)?.classList.add('ausgeloest');
  if (r.aktion === 'aus' && zustand.ausgang) { await ausgangSchalten(false); text += ' – Ausgang ausgeschaltet'; }
  ereignisSetzen('Alarm: ' + text);
  $('al-info').textContent = `Letzter Alarm ${uhrzeit(Date.now())}: ${text}`;
  alarmZeigen(text + ' (' + uhrzeit(Date.now()) + ')');
}

messHoerer.push(rec => {
  if (!$('al-aktiv').checked) return;
  for (const r of alRegeln) {
    if (!r.an) continue;
    const grenze = zahlLesen(r.wert);
    const wert = rec[r.groesse];
    if (!Number.isFinite(grenze) || !Number.isFinite(wert)) continue;
    // „unter“ für Spannung, Strom und Leistung zählt nur bei eingeschaltetem Ausgang – sonst Dauer-Alarm
    if (r.vergleich === 'unter' && r.groesse !== 'dmm' && !rec.ausgang) continue;
    const z = alLaufzeit.get(r) ?? { folge: 0, ausgeloest: false };
    const trifft = r.vergleich === 'ueber' ? wert > grenze : wert < grenze;
    if (trifft) {
      z.folge++;
      if (z.folge >= 2 && !z.ausgeloest) { z.ausgeloest = true; alAusloesen(r, wert, grenze); }
    } else {
      z.folge = 0; z.ausgeloest = false;
    }
    alLaufzeit.set(r, z);
  }
});

$('al-neu').addEventListener('click', () => {
  alRegeln.push({ an: true, groesse: 'i', vergleich: 'ueber', wert: '1', aktion: 'alarm' });
  alSpeichern(); alZeichnen();
});
$('al-aktiv').addEventListener('change', e => {
  speicher.schreiben('alarme-aktiv', e.target.checked);
  if (e.target.checked) chipSetzen('alarme', 'Alarme aktiv', '', () => { $('al-aktiv').checked = false; $('al-aktiv').dispatchEvent(new Event('change')); });
  else { chipEntfernen('alarme'); alarmQuittieren(); }
});
$('al-ton').addEventListener('change', e => speicher.schreiben('alarme-ton', e.target.checked));
$('alarm-quittieren').addEventListener('click', alarmQuittieren);
alZeichnen();
if ($('al-aktiv').checked) chipSetzen('alarme', 'Alarme aktiv', '', () => { $('al-aktiv').checked = false; $('al-aktiv').dispatchEvent(new Event('change')); });
// Einheit der Multimeter-Regeln folgt der Messfunktion
seitenHoerer['seite-auto'] = () => alRegeln.forEach(r => { const z = alZeilen.get(r); if (z) z.querySelector('.einheit').textContent = AL_GROESSEN[r.groesse].einheit(); });
