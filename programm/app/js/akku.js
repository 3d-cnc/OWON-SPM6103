'use strict';
/* SPM-14: Akku laden – das Netzteil lädt von selbst mit konstantem Strom (CC) und danach konstanter
   Spannung (CV). Das Programm stellt Ladeschluss, Strom, OVP und OCP ein, zählt die geladene Ladung
   und schaltet ab, wenn der Strom in der CV-Phase unter die Abschaltschwelle fällt (bei NiMH nach Zeit). */

const AKKU_TYPEN = {
  liion: { name: 'Li-Ion / LiPo', zelle: 4.20, c: 0.5, ende: 1 / 20 },
  lihv: { name: 'LiHV (4,35 V)', zelle: 4.35, c: 0.5, ende: 1 / 20 },
  lifepo4: { name: 'LiFePO4', zelle: 3.65, c: 0.5, ende: 1 / 20 },
  blei: { name: 'Blei / AGM / Gel', zelle: 2.40, c: 0.1, ende: 1 / 50 },
  nimh: { name: 'NiMH / NiCd (C/10 nach Zeit)', zelle: 1.55, c: 0.1, ende: 0, nachZeit: 16 },
};
// Wie lange der Strom unter der Schwelle bleiben muss, bevor „voll“ gilt (der Selbsttest verkürzt das)
const AK_BESTAETIGUNG = { s: 20 };
const ak = { laeuft: false };   // Zustand der laufenden Ladung

const akFelder = ['ak-typ', 'ak-zellen', 'ak-kap', 'ak-strom', 'ak-schluss', 'ak-ende', 'ak-limit'];
for (const [k, t] of Object.entries(AKKU_TYPEN)) $('ak-typ').add(new Option(t.name, k));

function akVorschlag(typ, zellen, kapMah) {
  const t = AKKU_TYPEN[typ], kap = kapMah / 1000;
  const strom = Math.min(GRENZE.curr, +(kap * t.c).toFixed(3));
  const limit = t.nachZeit ?? +(1 / t.c * (t.ende ? 1.5 : 1) + 1).toFixed(1);
  return { strom, schluss: +(t.zelle * zellen).toFixed(2), ende: +(kap * t.ende).toFixed(3), limit };
}

function akVorschlagEintragen() {
  const typ = $('ak-typ').value, zellen = Math.round(zahlLesen($('ak-zellen').value)), kap = zahlLesen($('ak-kap').value);
  if (!(zellen >= 1) || !(kap > 0)) return;
  const v = akVorschlag(typ, zellen, kap);
  $('ak-strom').value = feldZahl(v.strom);
  $('ak-schluss').value = feldZahl(v.schluss, 2);
  $('ak-ende').value = feldZahl(v.ende);
  $('ak-limit').value = feldZahl(v.limit, 1);
  akHinweis();
  akMerken();
}

function akHinweis() {
  const t = AKKU_TYPEN[$('ak-typ').value];
  $('ak-ende').disabled = !!t.nachZeit || ak.laeuft;
  $('ak-vorschlag').textContent = t.nachZeit
    ? `${t.name}: Ladung mit 0,1 C über ${t.nachZeit} h, Ende nach Zeit. ${feldZahl(t.zelle, 2)} V je Zelle sind nur die Obergrenze zur Sicherheit.`
    : `${t.name}: ${feldZahl(t.zelle, 2)} V je Zelle, Ladestrom üblich ${feldZahl(t.c, 1)} C, voll bei weniger als C/${Math.round(1 / t.ende)} in der CV-Phase.`;
}

const akMerken = () => speicher.schreiben('akku', Object.fromEntries(akFelder.map(f => [f, $(f).value])));
const akGespeichert = speicher.lesen('akku', null);
if (akGespeichert) for (const f of akFelder) { if (akGespeichert[f] !== undefined) $(f).value = akGespeichert[f]; }
else { $('ak-typ').value = 'liion'; $('ak-zellen').value = '1'; $('ak-kap').value = '2000'; akVorschlagEintragen(); }
for (const f of akFelder) $(f).addEventListener('change', akMerken);
for (const f of ['ak-typ', 'ak-zellen', 'ak-kap']) $(f).addEventListener('change', akVorschlagEintragen);
$('ak-vorgaben').addEventListener('click', akVorschlagEintragen);
akHinweis();


function akLesen() {
  const typ = $('ak-typ').value, t = AKKU_TYPEN[typ];
  const w = {
    typ, t, zellen: Math.round(zahlLesen($('ak-zellen').value)), kap: zahlLesen($('ak-kap').value),
    strom: zahlLesen($('ak-strom').value), schluss: zahlLesen($('ak-schluss').value),
    ende: t.nachZeit ? 0 : zahlLesen($('ak-ende').value), limit: zahlLesen($('ak-limit').value),
  };
  if (!(w.zellen >= 1 && w.zellen <= 40)) return { fehler: 'Zellenzahl zwischen 1 und 40 eingeben.' };
  if (!(w.kap > 0)) return { fehler: 'Kapazität in mAh eingeben.' };
  if (!(w.strom > 0 && w.strom <= GRENZE.curr)) return { fehler: `Ladestrom zwischen 0 und ${GRENZE.curr} A eingeben.` };
  if (!(w.schluss > 0 && w.schluss <= GRENZE.volt)) return { fehler: `Ladeschluss bis ${GRENZE.volt} V – so viele Zellen schafft das Netzteil nicht.` };
  if (!(w.ende >= 0)) return { fehler: 'Abschaltstrom eingeben.' };
  if (!(w.limit > 0)) return { fehler: 'Zeitlimit in Stunden eingeben.' };
  const zuViel = w.schluss / w.zellen - t.zelle;
  if (zuViel > 0.05) return { fehler: `${feldZahl(w.schluss / w.zellen, 2)} V je Zelle liegt über den üblichen ${feldZahl(t.zelle, 2)} V für ${t.name}.` };
  if (w.strom > w.kap / 1000 * 1.01 && !t.nachZeit) w.warnung = `Mehr als 1 C (${feldZahl(w.kap / 1000)} A) – nur, wenn der Akku dafür ausgelegt ist.`;
  return w;
}

async function akStarten() {
  if (!zustand.geraet) { $('ak-info').textContent = 'Erst verbinden.'; return; }
  const w = akLesen();
  if (w.fehler) { $('ak-info').textContent = w.fehler; return; }
  const ohneLast = zustand.letzter && !zustand.ausgang ? zustand.letzter.u : NaN;
  let frage = `${w.t.name}, ${w.zellen} Zelle${w.zellen > 1 ? 'n' : ''}, ${feldZahl(w.kap, 0)} mAh: laden mit ${feldZahl(w.strom)} A bis ${feldZahl(w.schluss, 2)} V`
    + (w.t.nachZeit ? `, Ende nach ${feldZahl(w.limit, 1)} h.` : `, Ende unter ${feldZahl(w.ende)} A, spätestens nach ${feldZahl(w.limit, 1)} h.`);
  if (Number.isFinite(ohneLast) && ohneLast > w.schluss + 0.05) frage += ` Achtung: An den Klemmen liegen schon ${feldZahl(ohneLast, 2)} V – mehr als der Ladeschluss. Typ und Zellenzahl prüfen!`;
  if (w.warnung) frage += ' ' + w.warnung;
  if (zustand.ausgang) frage += ' Der Ausgang ist gerade eingeschaltet.';
  if (!await bestaetigen('Akku laden', frage, 'Laden starten')) return;
  if (!automatikBelegen('akku', 'Akku', g => akStoppen(g ?? 'abgebrochen'))) return;

  Object.assign(ak, { laeuft: true, w, start: Date.now(), ladung: 0, energie: 0, vorher: null, unterSeit: null, phase: 'Start' });
  for (const f of [...akFelder, 'ak-vorgaben', 'ak-start']) $(f).disabled = true;
  $('ak-stopp').disabled = false;
  statusPille('ak-status', 'lädt', 'laeuft');
  $('ak-info').textContent = '';
  try {
    await sollwerteSetzen({ volt: w.schluss, curr: w.strom, ovp: Math.min(GRENZE.ovp, +(w.schluss * 1.03 + 0.2).toFixed(2)), ocp: ocpZu(w.strom) });
    await ausgangSchalten(true);
    ereignisSetzen(`Akku laden: ${w.t.name} ${w.zellen}S ${feldZahl(w.kap, 0)} mAh, ${feldZahl(w.strom)} A bis ${feldZahl(w.schluss, 2)} V`);
  } catch (e) {
    akEnde('Fehler beim Einstellen: ' + e.message, false);
  }
}

async function akEnde(grund, gut) {
  if (!ak.laeuft) return;
  ak.laeuft = false;
  await ausgangSchalten(false);
  automatikFreigeben('akku');
  for (const f of [...akFelder, 'ak-vorgaben', 'ak-start']) $(f).disabled = false;
  $('ak-stopp').disabled = true;
  akHinweis();
  const geladen = `${feldZahl(ak.ladung / 3.6, 0)} mAh, ${mitEinheitText(ak.energie / 3600, 'Wh')} in ${dauerKurz((Date.now() - ak.start) / 1000)}`;
  statusPille('ak-status', gut ? 'fertig' : 'abgebrochen', gut ? 'fertig' : 'fehler');
  $('ak-phase').textContent = gut ? 'fertig' : 'abgebrochen';
  $('ak-info').textContent = `${uhrzeit(Date.now())}: ${grund} – geladen ${geladen}.`;
  ereignisSetzen(`Akku ${gut ? 'fertig' : 'abgebrochen'}: ${grund}, ${geladen}`);
  if (gut) { ton(880, 0.15); setTimeout(() => ton(1320, 0.3), 180); } else { ton(440, 0.4); }
  aufmerksamkeit();
}
const akStoppen = grund => akEnde(grund === 'abgebrochen' ? 'von Hand abgebrochen' : grund, false);

messHoerer.push(rec => {
  if (!Number.isFinite(rec.u)) return;
  if (!ak.laeuft) {
    // Vor dem Laden: bei ausgeschaltetem Ausgang zeigt das Netzteil meist die Akkuspannung an den Klemmen
    if (!rec.ausgang) $('ak-spannung').textContent = `${feldZahl(rec.u, 2)} V (Ausgang aus)`;
    return;
  }
  const w = ak.w, v = ak.vorher, laufzeit = (rec.t - ak.start) / 1000;
  if (v) {
    const dt = (rec.t - v.t) / 1000;
    if (dt > 0 && dt <= 10) {
      ak.ladung += (rec.i + v.i) / 2 * dt;
      if (Number.isFinite(rec.p) && Number.isFinite(v.p)) ak.energie += (rec.p + v.p) / 2 * dt;
    }
  }
  ak.vorher = rec;
  const cv = rec.modus === 1 || (rec.modus === undefined && rec.u >= w.schluss - 0.02);
  ak.phase = rec.modus === 2 ? 'CC – konstanter Strom' : cv ? 'CV – konstante Spannung' : rec.modus === 0 ? 'Ausgang aus' : '…';
  const mah = ak.ladung / 3.6;
  $('ak-phase').textContent = ak.phase;
  $('ak-geladen').textContent = `${feldZahl(mah, 0)} mAh (${feldZahl(mah / w.kap * 100, 0)} %)`;
  $('ak-dauer').textContent = `${dauerKurz(laufzeit)} von max. ${feldZahl(w.limit, 1)} h`;
  $('ak-spannung').textContent = `${feldZahl(rec.u, 3)} V · ${feldZahl(rec.i, 3)} A`;
  balken('ak-balken', w.t.nachZeit ? laufzeit / (w.limit * 3600) : mah / w.kap);
  chipSetzen('akku', 'Akku', `${ak.phase.split(' ')[0]} · ${feldZahl(mah, 0)} mAh`);

  if (laufzeit > 3 && zustand.ausgang === false) return akEnde('Ausgang wurde ausgeschaltet (Taste, OVP/OCP oder Alarm)', false);
  if (rec.u > w.schluss + 0.15) return akEnde(`Spannung ${feldZahl(rec.u, 2)} V über dem Ladeschluss`, false);
  if (laufzeit >= w.limit * 3600) return akEnde(w.t.nachZeit ? `Ladezeit ${feldZahl(w.limit, 1)} h erreicht` : `Zeitlimit ${feldZahl(w.limit, 1)} h erreicht – Akku prüfen`, !!w.t.nachZeit);
  if (!w.t.nachZeit && cv && rec.i < w.ende) {
    ak.unterSeit ??= rec.t;
    if (rec.t - ak.unterSeit >= AK_BESTAETIGUNG.s * 1000) return akEnde(`voll, Strom unter ${feldZahl(w.ende)} A`, true);
  } else ak.unterSeit = null;
});

$('ak-start').addEventListener('click', akStarten);
$('ak-stopp').addEventListener('click', () => akStoppen('abgebrochen'));
$('ak-stopp').disabled = true;
