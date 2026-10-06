'use strict';
/* SPM-13: Ablaufprogramm – Schritte mit Spannung, Strom und Dauer, wahlweise als Rampe
   (Spannung gleichmäßig vom vorigen Wert aus), wiederholbar und unter Namen speicherbar. */

const AP_VORGABE = {
  schritte: [
    { volt: 5, curr: 1, dauer: 10, rampe: false },
    { volt: 12, curr: 1, dauer: 20, rampe: true },
    { volt: 12, curr: 1, dauer: 10, rampe: false },
    { volt: 0, curr: 1, dauer: 5, rampe: true },
  ],
  wdh: 1, ende: 'aus',
};
let apProgramm = speicher.lesen('programm-aktuell', structuredClone(AP_VORGABE));
let apListe = speicher.lesen('programme', []);   // [{ name, schritte, wdh, ende }]
let apName = speicher.lesen('programm-name', '');
const ap = { laeuft: false, abbruch: null };

const apMerken = () => { speicher.schreiben('programm-aktuell', apProgramm); speicher.schreiben('programm-name', apName); };

function apZeichnen() {
  const box = $('ap-schritte');
  box.innerHTML = '';
  apProgramm.schritte.forEach((s, nr) => {
    const z = document.createElement('div');
    z.className = 'raster-schritte';
    z.dataset.nr = nr;
    z.innerHTML = `<div>${nr + 1}</div><input type="text" data-f="volt" inputmode="decimal"><input type="text" data-f="curr" inputmode="decimal">
      <input type="text" data-f="dauer" inputmode="decimal"><label class="klein"><input type="checkbox" data-f="rampe"></label><button type="button" title="Schritt löschen">×</button>`;
    for (const el of z.querySelectorAll('[data-f]')) {
      const f = el.dataset.f;
      if (f === 'rampe') el.checked = s.rampe; else el.value = feldZahl(s[f]);
      el.disabled = ap.laeuft;
      el.addEventListener('change', () => {
        if (f === 'rampe') s.rampe = el.checked;
        else {
          const v = zahlLesen(el.value);
          const ok = Number.isFinite(v) && v >= 0 && (f !== 'volt' || v <= GRENZE.volt) && (f !== 'curr' || v <= GRENZE.curr) && (f !== 'dauer' || v > 0);
          el.style.borderColor = ok ? '' : 'var(--err)';
          if (ok) s[f] = v;
        }
        apMerken(); apSumme();
      });
    }
    const loeschen = z.querySelector('button');
    loeschen.disabled = ap.laeuft;
    loeschen.addEventListener('click', () => { apProgramm.schritte.splice(nr, 1); apMerken(); apZeichnen(); });
    box.appendChild(z);
  });
  $('ap-wdh').value = apProgramm.wdh;
  $('ap-ende').value = apProgramm.ende;
  for (const id of ['ap-wdh', 'ap-ende', 'ap-neu', 'ap-liste', 'ap-speichern', 'ap-speichern-unter', 'ap-loeschen', 'ap-start']) $(id).disabled = ap.laeuft;
  $('ap-stopp').disabled = !ap.laeuft;
  apListeZeichnen();
  apSumme();
}

function apListeZeichnen() {
  const sel = $('ap-liste');
  sel.innerHTML = '';
  sel.add(new Option(apName ? `${apName}` : '(nicht gespeichert)', ''));
  for (const p of apListe) if (p.name !== apName) sel.add(new Option(p.name, p.name));
  sel.value = '';
  $('ap-loeschen').disabled = ap.laeuft || !apName;
}

function apSumme() {
  const s = apProgramm.schritte.reduce((a, x) => a + (x.dauer || 0), 0);
  $('ap-summe').textContent = `${apProgramm.schritte.length} Schritte · ${dauerKurz(s)} je Durchlauf`;
}

async function apSpeichernUnter(name) {
  name = (name ?? await eingabeFragen('Programm speichern', 'Unter welchem Namen?', apName || 'Mein Ablauf'))?.trim();
  if (!name) return;
  apListe = apListe.filter(p => p.name !== name);
  apListe.push({ name, ...structuredClone(apProgramm) });
  apListe.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  apName = name;
  speicher.schreiben('programme', apListe); apMerken(); apListeZeichnen();
  $('ap-info').textContent = `Gespeichert als „${name}“.`;
}

$('ap-liste').addEventListener('change', e => {
  const p = apListe.find(x => x.name === e.target.value);
  if (!p) return;
  apProgramm = { schritte: structuredClone(p.schritte), wdh: p.wdh, ende: p.ende };
  apName = p.name;
  apMerken(); apZeichnen();
});
$('ap-speichern').addEventListener('click', () => apSpeichernUnter(apName || undefined));
$('ap-speichern-unter').addEventListener('click', () => apSpeichernUnter());
$('ap-loeschen').addEventListener('click', async () => {
  if (!apName || !await bestaetigen('Programm löschen', `„${apName}“ löschen? Die Schritte bleiben im Fenster stehen.`, 'Löschen')) return;
  apListe = apListe.filter(p => p.name !== apName);
  apName = '';
  speicher.schreiben('programme', apListe); apMerken(); apListeZeichnen();
});
$('ap-neu').addEventListener('click', () => {
  const letzter = apProgramm.schritte.at(-1) ?? { volt: 5, curr: 1, dauer: 10, rampe: false };
  apProgramm.schritte.push({ ...letzter, rampe: false });
  apMerken(); apZeichnen();
});
$('ap-wdh').addEventListener('change', e => {
  const n = Math.round(zahlLesen(e.target.value));
  if (n >= 0) apProgramm.wdh = n;
  e.target.value = apProgramm.wdh;
  apMerken();
});
$('ap-ende').addEventListener('change', e => { apProgramm.ende = e.target.value; apMerken(); });

function apSchrittMarkieren(nr) {
  document.querySelectorAll('#ap-schritte .raster-schritte').forEach(z => z.classList.toggle('laufend', +z.dataset.nr === nr));
}

async function apStarten() {
  const schritte = apProgramm.schritte;
  if (!zustand.geraet) { $('ap-info').textContent = 'Erst verbinden.'; return; }
  if (!schritte.length) { $('ap-info').textContent = 'Das Programm hat keine Schritte.'; return; }
  if (!automatikBelegen('ablauf', 'Ablauf', g => apStoppen(g ?? 'gestoppt'))) return;
  ap.laeuft = true; ap.abbruch = null;
  apZeichnen();
  statusPille('ap-status', 'läuft', 'laeuft');
  const wdh = apProgramm.wdh;
  const proDurchlauf = schritte.reduce((a, s) => a + s.dauer, 0) * 1000;
  const maxU = Math.max(...schritte.map(s => s.volt)), maxI = Math.max(...schritte.map(s => s.curr));
  ereignisSetzen(`Ablauf gestartet${apName ? ': ' + apName : ''}`);
  let vorherU = zustand.soll?.volt ?? 0;
  let ausgangGeschaltet = false;
  try {
    // Schutzgrenzen einmal für das ganze Programm
    await sollwerteSetzen({ ovp: ovpZu(maxU), ocp: ocpZu(maxI) }, true);
    for (let durchlauf = 1; (wdh === 0 || durchlauf <= wdh) && !ap.abbruch; durchlauf++) {
      for (const [nr, s] of schritte.entries()) {
        if (ap.abbruch) break;
        apSchrittMarkieren(nr);
        await sollwerteSetzen({ curr: s.curr, ...(s.rampe ? {} : { volt: s.volt }) }, true);
        if (!ausgangGeschaltet) { await ausgangSchalten(true, true); ausgangGeschaltet = true; }
        const t0 = Date.now(), dauer = s.dauer * 1000;
        while (!ap.abbruch) {
          const vergangen = Date.now() - t0;
          if (s.rampe) await befehl(`VOLT ${scpiZahl(vorherU + (s.volt - vorherU) * Math.min(1, vergangen / dauer))}`, true);
          const gesamt = (durchlauf - 1) * proDurchlauf + schritte.slice(0, nr).reduce((a, x) => a + x.dauer * 1000, 0) + vergangen;
          const text = `Schritt ${nr + 1}/${schritte.length}` + (wdh !== 1 ? ` · Durchlauf ${durchlauf}${wdh ? '/' + wdh : ''}` : '') + ` · noch ${dauerKurz((dauer - vergangen) / 1000)}`;
          $('ap-info').textContent = `${text} · ${feldZahl(s.volt)} V, ${feldZahl(s.curr)} A${s.rampe ? ' (Rampe)' : ''}`;
          chipSetzen('ablauf', 'Ablauf', text);
          balken('ap-balken', wdh ? gesamt / (wdh * proDurchlauf) : vergangen / dauer);
          if (vergangen >= dauer) break;
          // Von außen ausgeschaltet (Taste am Gerät, OVP/OCP, Alarm)? Dann nicht weiterfahren
          if (ausgangGeschaltet && zustand.ausgang === false && vergangen > 1500) { ap.abbruch = 'Ausgang wurde ausgeschaltet'; break; }
          await warten(s.rampe ? 250 : 200);
        }
        if (s.rampe && !ap.abbruch) await befehl(`VOLT ${scpiZahl(s.volt)}`, true);
        vorherU = s.volt;
        zustand.soll = { ...zustand.soll, volt: s.volt };
      }
    }
    if (!ap.abbruch && apProgramm.ende === 'aus') await ausgangSchalten(false, true);
    if (ap.abbruch === 'gestoppt') await ausgangSchalten(false);
  } catch (e) {
    ap.abbruch = e.message;
  } finally {
    const grund = ap.abbruch;
    ap.laeuft = false;
    automatikFreigeben('ablauf');
    apSchrittMarkieren(-1);
    await sollwerteLesen().catch(() => {});
    anzeigeAktualisieren();
    apZeichnen();
    if (grund) {
      statusPille('ap-status', grund === 'gestoppt' ? 'gestoppt' : 'abgebrochen', grund === 'gestoppt' ? '' : 'fehler');
      $('ap-info').textContent = grund === 'gestoppt' ? 'Gestoppt, Ausgang aus.' : `Abgebrochen: ${grund}.`;
      ereignisSetzen(`Ablauf ${grund === 'gestoppt' ? 'gestoppt' : 'abgebrochen: ' + grund}`);
    } else {
      statusPille('ap-status', 'fertig', 'fertig');
      balken('ap-balken', 1);
      $('ap-info').textContent = `Fertig um ${uhrzeit(Date.now())}` + (apProgramm.ende === 'aus' ? ', Ausgang aus.' : ', Ausgang bleibt an.');
      ereignisSetzen('Ablauf fertig');
      ton(880, 0.15); setTimeout(() => ton(1320, 0.25), 180);
    }
  }
}

function apStoppen(grund = 'gestoppt') { if (ap.laeuft) ap.abbruch = grund; }

$('ap-start').addEventListener('click', apStarten);
$('ap-stopp').addEventListener('click', () => apStoppen('gestoppt'));
apZeichnen();
