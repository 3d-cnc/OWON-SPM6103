'use strict';
/* Gemeinsame Bausteine der Zusatzfunktionen (SPM-10 bis SPM-19).
   Läuft nach dem Hauptskript in index.html und nutzt dessen zustand, befehl, frage, log … */

// Einstellungen der Zusatzfunktionen bleiben im Benutzerordner des Programms (localStorage)
const speicher = {
  lesen(name, vorgabe) {
    try { const t = localStorage.getItem('spm6103.' + name); return t === null ? vorgabe : JSON.parse(t); } catch { return vorgabe; }
  },
  schreiben(name, wert) {
    try { localStorage.setItem('spm6103.' + name, JSON.stringify(wert)); } catch {}
  },
};

// „4,7k“ → 4700, „500 mA“ → 0,5, „2,2µ“ → 2,2e-6; die Einheit hinter dem Vorsatz wird ignoriert
function zahlLesen(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  const m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuµμmkKMG]?)([a-zA-ZΩ]*)$/);
  if (!m) return NaN;
  // „5m“ heißt milli, „5 Ohm“ hat keinen Vorsatz: ein Buchstabe gilt nur als Vorsatz, wenn danach nichts oder eine Einheit kommt
  let vorsatz = m[2];
  if (vorsatz && m[3] && !/^(V|A|W|F|Ohm|Ω|Hz|Wh|Ah|s)$/i.test(m[3])) return NaN;
  return parseFloat(m[1]) * (vorsatz ? VORSATZ[vorsatz] : 1);
}

// Zahl für Eingabefelder: deutsch, ohne überflüssige Nullen
const feldZahl = (x, stellen = 3) => Number.isFinite(x) ? String(+x.toFixed(stellen)).replace('.', ',') : '';
// Zahl für SCPI-Befehle: Punkt, höchstens drei Nachkommastellen
const scpiZahl = x => String(+(+x).toFixed(3));
// Dauer als 1:02:03 bzw. 2:03
const dauerKurz = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sek = s % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sek)}` : `${m}:${p(sek)}`;
};
const mitEinheitText = (x, e) => { const t = technisch(x, e); return t.zahl + ' ' + t.einheit; };

/* ---------- Dialoge: bestätigen und Text eingeben ---------- */

const dialogBox = (() => {
  const d = document.createElement('dialog');
  d.className = 'fenster';
  d.id = 'frage-dialog';
  d.innerHTML = `<h3></h3><p class="hinweis"></p><input type="text" hidden>
    <div class="zeile rechtsbuendig"><button type="button" data-a="nein">Abbrechen</button><button type="button" class="haupt" data-a="ja">OK</button></div>`;
  document.body.appendChild(d);
  return d;
})();

function dialogZeigen({ titel, text, ja = 'OK', nein = 'Abbrechen', eingabe = null }) {
  const d = dialogBox, feld = d.querySelector('input');
  d.querySelector('h3').textContent = titel;
  d.querySelector('p').textContent = text || '';
  d.querySelector('[data-a=ja]').textContent = ja;
  d.querySelector('[data-a=nein]').textContent = nein;
  feld.hidden = eingabe === null;
  feld.value = eingabe ?? '';
  return new Promise(fertig => {
    const ende = ergebnis => { d.close(); aufraeumen(); fertig(ergebnis); };
    const jaKlick = () => ende(eingabe === null ? true : feld.value);
    const neinKlick = () => ende(eingabe === null ? false : null);
    const taste = e => { if (e.key === 'Enter' && e.target === feld) { e.preventDefault(); jaKlick(); } };
    const abbruch = e => { e.preventDefault(); neinKlick(); };
    const aufraeumen = () => {
      d.querySelector('[data-a=ja]').removeEventListener('click', jaKlick);
      d.querySelector('[data-a=nein]').removeEventListener('click', neinKlick);
      d.removeEventListener('keydown', taste); d.removeEventListener('cancel', abbruch);
    };
    d.querySelector('[data-a=ja]').addEventListener('click', jaKlick);
    d.querySelector('[data-a=nein]').addEventListener('click', neinKlick);
    d.addEventListener('keydown', taste); d.addEventListener('cancel', abbruch);
    d.showModal();
    (eingabe === null ? d.querySelector('[data-a=ja]') : feld).focus();
    if (eingabe !== null) feld.select();
  });
}
const bestaetigen = (titel, text, ja = 'OK') => dialogZeigen({ titel, text, ja });
const eingabeFragen = (titel, text, vorgabe = '') => dialogZeigen({ titel, text, eingabe: vorgabe, ja: 'Übernehmen' });

/* ---------- Ton und Aufmerksamkeit ---------- */

const ton = (() => {
  let ctx = null;
  return (frequenz = 880, dauer = 0.15, lautstaerke = 0.15) => {
    try {
      ctx ??= new AudioContext();
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sine'; o.frequency.value = frequenz;
      g.gain.setValueAtTime(lautstaerke, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dauer + 0.02);
    } catch {}
  };
})();
// Taskleiste blinken lassen, wenn das Fenster nicht vorn ist
const aufmerksamkeit = () => window.spm?.aufmerksamkeit?.();

/* ---------- Markierungen (Ereignisse in Kurven, Tabelle und CSV) ---------- */

function ereignisSetzen(text, art = 'auto') {
  zustand.ereignisse.push({ t: Date.now(), text, art });
  zustand.offeneNotizen.push(text);
  log((art === 'notiz' ? 'Markierung: ' : '') + text, 'info');
  zeichnenAnfordern();
}

/* ---------- Netzteil sicher einstellen ---------- */

const GRENZE = { volt: 60, curr: 10, ovp: 66, ocp: 11 };
// Schutzgrenzen knapp über dem Sollwert: OVP + 5 % + 0,5 V, OCP + 10 % + 0,1 A
const ovpZu = u => Math.min(GRENZE.ovp, +(u * 1.05 + 0.5).toFixed(2));
const ocpZu = i => Math.min(GRENZE.ocp, +(i * 1.1 + 0.1).toFixed(3));

// Setzt Spannung, Strom und die Schutzgrenzen in einer Reihenfolge, in der eine Grenze nie
// kurzzeitig unter dem neuen Sollwert liegt: steigt die Grenze, kommt sie zuerst, sonst danach.
async function sollwerteSetzen({ volt, curr, ovp, ocp }, leise = false) {
  if (!zustand.geraet) throw new Error('Nicht verbunden');
  const alt = zustand.soll || {};
  const paar = async (soll, grenze, befSoll, befGrenze, alteGrenze) => {
    const grenzeZuerst = grenze !== undefined && !(grenze <= alteGrenze);
    if (grenzeZuerst) await befehl(`${befGrenze} ${scpiZahl(grenze)}`, leise);
    if (soll !== undefined) await befehl(`${befSoll} ${scpiZahl(soll)}`, leise);
    if (grenze !== undefined && !grenzeZuerst) await befehl(`${befGrenze} ${scpiZahl(grenze)}`, leise);
  };
  await paar(volt, ovp, 'VOLT', 'VOLT:LIM', alt.ovp);
  await paar(curr, ocp, 'CURR', 'CURR:LIM', alt.ocp);
  zustand.soll = { ...alt, ...(volt !== undefined && { volt }), ...(curr !== undefined && { curr }), ...(ovp !== undefined && { ovp }), ...(ocp !== undefined && { ocp }) };
  if (!leise) await sollwerteLesen().catch(() => {});
  anzeigeAktualisieren();
}

/* ---------- Warten auf Messungen ---------- */

const messWarter = [];
messHoerer.push(rec => {
  for (const w of [...messWarter]) {
    if (rec.t >= w.ab && rec.u !== undefined) { messWarter.splice(messWarter.indexOf(w), 1); clearTimeout(w.uhr); w.ok(rec); }
  }
});
// Liefert die erste Messung, deren Abfrage nach dem Zeitpunkt ab begonnen hat
function messungAb(ab, zeitlimit = 6000) {
  return new Promise((ok, fehler) => {
    const w = { ab, ok };
    w.uhr = setTimeout(() => { messWarter.splice(messWarter.indexOf(w), 1); fehler(new Error('Keine Messung vom Netzteil')); }, zeitlimit);
    messWarter.push(w);
  });
}
const warten = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Automatiken: immer nur eine zur Zeit, Anzeige im Tab Live ---------- */

const automatik = { name: null, stoppen: null };
const automatikChips = new Map();

function automatikBelegen(name, titel, stoppen) {
  if (automatik.name && automatik.name !== name) {
    meldung(`Erst „${automatikChips.get(automatik.name)?.titel ?? automatik.name}“ beenden – es läuft immer nur eine Automatik.`);
    return false;
  }
  meldung('');
  automatik.name = name; automatik.stoppen = stoppen;
  chipSetzen(name, titel, '', stoppen);
  return true;
}
function automatikFreigeben(name) {
  if (automatik.name === name) { automatik.name = null; automatik.stoppen = null; }
  chipEntfernen(name);
}

// Kleine Anzeige im Tab Live (neben CV/CC), mit Stopp-Knopf
function chipSetzen(name, titel, text, stoppen) {
  let c = automatikChips.get(name);
  if (!c) {
    const el = document.createElement('span');
    el.className = 'chip-auto';
    el.innerHTML = '<span></span><button type="button">Stopp</button>';
    el.querySelector('button').addEventListener('click', () => c.stoppen?.());
    $('automatik-chips').appendChild(el);
    c = { el, titel, stoppen };
    automatikChips.set(name, c);
  }
  c.titel = titel; if (stoppen) c.stoppen = stoppen;
  c.el.querySelector('span').textContent = text ? `${titel} · ${text}` : titel;
  $('tab-auto').textContent = automatikChips.size ? '●' : '';
}
function chipEntfernen(name) {
  automatikChips.get(name)?.el.remove();
  automatikChips.delete(name);
  $('tab-auto').textContent = automatikChips.size ? '●' : '';
}

function statusPille(id, text, art = '') {
  const el = $(id);
  el.textContent = text;
  el.className = 'status-pille' + (art ? ' ' + art : '');
}
const balken = (id, anteil) => { $(id).style.width = Math.max(0, Math.min(1, anteil || 0)) * 100 + '%'; };

// Beim Trennen alle Automatiken anhalten (das Netzteil hört dann nicht mehr zu)
trennHoerer.push(() => { automatik.stoppen?.('Verbindung getrennt'); });

/* ---------- Demo-Last ---------- */

$('demo-last').addEventListener('change', e => {
  if (zustand.demo && zustand.geraet) zustand.geraet.lastArt = e.target.value;
});
const demoWahlZeigen = () => { $('demo-last-wahl').hidden = !(zustand.demo && zustand.geraet); };
messHoerer.push(demoWahlZeigen);
trennHoerer.push(() => setTimeout(demoWahlZeigen));

/* ---------- Diagramme für Kennlinie und Vergleich ---------- */

// Bereitet eine Leinwand in Bildschirmauflösung vor; liefert Kontext, Maße und die Zeichenfläche
function leinwand(canvas, rand = { l: 70, r: 16, o: 12, u: 30 }) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h, x0: rand.l, y0: rand.o, iw: w - rand.l - rand.r, ih: h - rand.o - rand.u };
}

// Raster und Beschriftung; xText/yText bekommen Wert und Rasterschritt. Liefert die Umrechnung Wert → Pixel
function achsenZeichnen(f, [xmin, xmax], [ymin, ymax], xText, yText) {
  const { g, x0, y0, iw, ih } = f;
  if (!(xmax > xmin)) xmax = xmin + 1;
  if (!(ymax > ymin)) ymax = ymin + 1;
  const x = v => x0 + (v - xmin) / (xmax - xmin) * iw;
  const y = v => y0 + ih - (v - ymin) / (ymax - ymin) * ih;
  g.font = '11px ' + farbe('--mono');
  g.strokeStyle = farbe('--line'); g.fillStyle = farbe('--muted'); g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  const ry = schoeneSchritte(ymin, ymax, 6);
  for (const v of ry.werte) {
    const yy = Math.round(y(v)) + 0.5;
    g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + iw, yy); g.stroke();
    g.fillText(yText(v, ry.schritt), x0 - 6, yy);
  }
  g.textAlign = 'center'; g.textBaseline = 'top';
  const rx = schoeneSchritte(xmin, xmax, Math.max(3, Math.floor(iw / 110)));
  for (const v of rx.werte) {
    const xx = Math.round(x(v)) + 0.5;
    g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y0 + ih); g.stroke();
    g.fillText(xText(v, rx.schritt), xx, y0 + ih + 6);
  }
  return { x, y };
}
