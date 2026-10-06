'use strict';
/* SPM-18: Aufzeichnungen laden und vergleichen – CSV-Dateien dieses Programms (auch laufend
   gespeicherte) und die aktuelle Aufzeichnung übereinanderlegen. Zeitachse ab Beginn jeder
   Aufzeichnung oder ab dem ersten Einschalten des Ausgangs. */

const VG_FARBEN = ['--u', '--i', '--p', '--d', '--warn', '--err'];
const VG_GROESSEN = { u: ['Spannung', 'V'], i: ['Strom', 'A'], p: ['Leistung', 'W'], dmm: ['Multimeter', ''] };
const vg = { reihen: [], groesse: 'u', hoverS: null, achsen: null, bereich: null };

// CSV im Format von „Als CSV speichern“ → Reihe; Spalten werden über die Kopfzeile gefunden
function vgCsvLesen(name, text) {
  const zeilen = text.replace(/^﻿/, '').split(/\r?\n/).filter(z => z.trim());
  if (zeilen.length < 2) throw new Error('keine Messzeilen');
  const kopf = zeilen[0].split(';').map(s => s.trim());
  const spalte = n => kopf.indexOf(n);
  const s = { sek: spalte('Sekunden'), u: spalte('Spannung [V]'), i: spalte('Strom [A]'), p: spalte('Leistung [W]'), aus: spalte('Ausgang'), df: spalte('Multimeter-Funktion'), dmm: spalte('Multimeter-Wert (SI)') };
  if (s.sek < 0) throw new Error('keine Spalte „Sekunden“ – ist das eine Datei dieses Programms?');
  const zahlAus = (teile, i) => { if (i < 0) return NaN; const t = (teile[i] ?? '').trim(); return t === '' ? NaN : Number(t.replace(',', '.')); };
  const punkte = [];
  for (const z of zeilen.slice(1)) {
    const t = z.split(';');
    const sek = zahlAus(t, s.sek);
    if (!Number.isFinite(sek)) continue;
    punkte.push({ s: sek, u: zahlAus(t, s.u), i: zahlAus(t, s.i), p: zahlAus(t, s.p), ausgang: s.aus >= 0 ? t[s.aus] === 'EIN' : null, df: s.df >= 0 ? t[s.df] : '', dmm: zahlAus(t, s.dmm) });
  }
  if (!punkte.length) throw new Error('keine lesbaren Messzeilen');
  return vgReihe(name.replace(/\.csv$/i, ''), punkte);
}

function vgReihe(name, punkte) {
  // häufigste Multimeter-Funktion - nur deren Werte werden als „Multimeter“ gezeichnet
  const zaehler = {};
  for (const p of punkte) if (p.df && Number.isFinite(p.dmm)) zaehler[p.df] = (zaehler[p.df] || 0) + 1;
  const df = Object.entries(zaehler).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const an = punkte.find(p => p.ausgang === true);
  return { name, punkte, df, ausgangAb: an ? an.s : null };
}

function vgAktuell() {
  const d = zustand.daten;
  if (!d.length) { meldung('Die aktuelle Aufzeichnung ist leer.'); return; }
  const t0 = d[0].t;
  const punkte = d.map(r => ({ s: (r.t - t0) / 1000, u: r.u, i: r.i, p: r.p, ausgang: r.ausgang, df: FUNKTIONEN[r.dmmFunktion]?.name ?? r.dmmFunktion ?? '', dmm: r.dmm }));
  vgHinzu(vgReihe(`Aktuell (${uhrzeit(t0)}, ${d.length.toLocaleString('de-DE')} Punkte)`, punkte));
}

function vgHinzu(reihe) {
  if (vg.reihen.length >= VG_FARBEN.length) vg.reihen.shift();
  vg.reihen.push(reihe);
  vgAlles();
}

const vgVersatz = r => $('vg-ausrichten').checked && r.ausgangAb !== null ? r.ausgangAb : 0;
const vgWert = (p, g, r) => g === 'dmm' ? (p.df === r.df ? p.dmm : NaN) : p[g];
const vgFarbe = n => farbe(VG_FARBEN[n % VG_FARBEN.length]);
const vgZeit = s => (s < 0 ? '−' : '') + dauerKurz(Math.abs(s));

function vgEinheit() {
  if (vg.groesse !== 'dmm') return VG_GROESSEN[vg.groesse][1];
  const df = vg.reihen[0]?.df ?? '';
  const f = Object.values(FUNKTIONEN).find(x => x.name === df) ?? FUNKTIONEN[df];
  return f?.einheit ?? '';
}

function vgListe() {
  const box = $('vg-liste');
  box.innerHTML = vg.reihen.length ? '' : '<p class="hinweis">Noch nichts geladen.</p>';
  const e = vgEinheit();
  vg.reihen.forEach((r, n) => {
    const werte = r.punkte.map(p => vgWert(p, vg.groesse, r)).filter(Number.isFinite);
    let energie = 0;
    for (let k = 1; k < r.punkte.length; k++) {
      const a = r.punkte[k - 1], b = r.punkte[k], dt = b.s - a.s;
      if (dt > 0 && dt <= 10 && Number.isFinite(a.p) && Number.isFinite(b.p)) energie += (a.p + b.p) / 2 * dt;
    }
    // Spannung, Strom, Leistung wie im Tab Live mit drei Nachkommastellen; Multimeter mit passendem Vorsatz
    const fmt = x => !Number.isFinite(x) ? '–' : vg.groesse === 'dmm' ? mitEinheitText(x, e) : zahl(x, 3) + ' ' + e;
    const el = document.createElement('div');
    el.className = 'vg-eintrag';
    el.innerHTML = `<div class="kopf"><span class="farbe"></span><span class="name"></span><button type="button" title="Entfernen">×</button></div>
      <div class="werte"><div>Dauer<b></b></div><div>Punkte<b></b></div><div>Energie<b></b></div><div>Min<b></b></div><div>Max<b></b></div><div>Mittel<b></b></div></div>`;
    el.querySelector('.farbe').style.background = vgFarbe(n);
    el.querySelector('.name').textContent = r.name;
    el.querySelector('.name').title = r.name + (r.df ? ` – Multimeter: ${r.df}` : '');
    const b = el.querySelectorAll('.werte b');
    b[0].textContent = vgZeit(r.punkte.at(-1).s - r.punkte[0].s);
    b[1].textContent = r.punkte.length.toLocaleString('de-DE');
    b[2].textContent = mitEinheitText(energie / 3600, 'Wh');
    // ohne Spread: lange Aufzeichnungen sprengen sonst die Argumentliste
    b[3].textContent = fmt(werte.reduce((a, x) => Math.min(a, x), Infinity));
    b[4].textContent = fmt(werte.reduce((a, x) => Math.max(a, x), -Infinity));
    b[5].textContent = fmt(werte.reduce((a, x) => a + x, 0) / werte.length);
    el.querySelector('button').addEventListener('click', () => { vg.reihen.splice(n, 1); vgAlles(); });
    box.appendChild(el);
  });
}

function vgDiagramm() {
  const f = leinwand($('vg-canvas'), { l: 80, r: 16, o: 12, u: 30 });
  if (!f) return;
  const g = vg.groesse, e = vgEinheit();
  $('vg-titel').textContent = g === 'dmm' && vg.reihen[0]?.df ? `Multimeter · ${vg.reihen[0].df}` : VG_GROESSEN[g][0];
  if (!vg.reihen.length) {
    f.g.fillStyle = farbe('--muted'); f.g.font = '14px "Segoe UI", sans-serif'; f.g.textAlign = 'center';
    f.g.fillText('„Aufzeichnung laden …“ oder „Aktuelle Aufzeichnung dazu“', f.w / 2, f.h / 2);
    return;
  }
  let smin = Infinity, smax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const r of vg.reihen) {
    const v0 = vgVersatz(r);
    for (const p of r.punkte) {
      const s = p.s - v0, w = vgWert(p, g, r);
      if (s < smin) smin = s; if (s > smax) smax = s;
      if (Number.isFinite(w)) { if (w < ymin) ymin = w; if (w > ymax) ymax = w; }
    }
  }
  if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
  const luft = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.01 || 1;
  ymin -= luft; ymax += luft;
  const fak = (() => { const t = technisch(Math.max(Math.abs(ymin), Math.abs(ymax)), e); return t.einheit.length > e.length ? VORSATZ[t.einheit[0]] : 1; })();
  const yEinheit = technisch(Math.max(Math.abs(ymin), Math.abs(ymax)), e).einheit;
  vg.achsen = achsenZeichnen(f, [smin, smax], [ymin, ymax], vgZeit, (v, s) => zahl(v / fak, stellenFuer(s / fak)) + ' ' + yEinheit);
  vg.bereich = [smin, smax];
  const { g: c } = f;
  c.save(); c.beginPath(); c.rect(f.x0, f.y0, f.iw, f.ih); c.clip();
  vg.reihen.forEach((r, n) => {
    c.strokeStyle = vgFarbe(n); c.lineWidth = 1.6; c.beginPath();
    const v0 = vgVersatz(r);
    let offen = false, spalte = null, lo = 0, hi = 0;
    const raus = () => { if (spalte === null) return; if (!offen) { c.moveTo(spalte, vg.achsen.y(lo)); offen = true; } else c.lineTo(spalte, vg.achsen.y(lo)); if (hi !== lo) c.lineTo(spalte, vg.achsen.y(hi)); };
    for (const p of r.punkte) {
      const w = vgWert(p, g, r);
      if (!Number.isFinite(w)) { raus(); spalte = null; offen = false; continue; }
      const px = Math.round(vg.achsen.x(p.s - v0));
      if (px !== spalte) { raus(); spalte = px; lo = hi = w; } else { lo = Math.min(lo, w); hi = Math.max(hi, w); }
    }
    raus();
    c.stroke();
  });
  if (vg.hoverS !== null) {
    const xx = Math.round(vg.achsen.x(vg.hoverS)) + 0.5;
    c.strokeStyle = farbe('--muted'); c.setLineDash([3, 3]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(xx, f.y0); c.lineTo(xx, f.y0 + f.ih); c.stroke(); c.setLineDash([]);
  }
  c.restore();
}

function vgAlles() { vgListe(); vgDiagramm(); }

$('vg-canvas').addEventListener('mousemove', e => {
  if (!vg.achsen || !vg.reihen.length) return;
  const r = e.target.getBoundingClientRect();
  const [s0, s1] = vg.bereich, f = { x0: 80, iw: r.width - 96 };
  const s = s0 + (s1 - s0) * Math.min(Math.max((e.clientX - r.left - f.x0) / f.iw, 0), 1);
  vg.hoverS = s;
  const e2 = vgEinheit();
  const teile = vg.reihen.map((reihe, n) => {
    const ziel = s + vgVersatz(reihe);
    let best = null;
    for (const p of reihe.punkte) if (!best || Math.abs(p.s - ziel) < Math.abs(best.s - ziel)) best = p;
    const w = best ? vgWert(best, vg.groesse, reihe) : NaN;
    return `${n + 1}: ${Number.isFinite(w) ? mitEinheitText(w, e2) : '–'}`;
  });
  $('vg-hover').textContent = `${vgZeit(s)}  ·  ${teile.join('  ·  ')}`;
  vgDiagramm();
});
$('vg-canvas').addEventListener('mouseleave', () => { vg.hoverS = null; $('vg-hover').textContent = ''; vgDiagramm(); });

$('vg-laden').addEventListener('click', async () => {
  const dateien = await window.spm?.csvOeffnen();
  for (const d of dateien ?? []) {
    try { vgHinzu(vgCsvLesen(d.name, d.text)); }
    catch (e) { meldung(`„${d.name}“ lässt sich nicht lesen: ${e.message}`); }
  }
});
$('vg-aktuell').addEventListener('click', vgAktuell);
$('vg-groesse').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  vg.groesse = b.dataset.g;
  $('vg-groesse').querySelectorAll('button').forEach(x => x.classList.toggle('aktiv', x === b));
  vgAlles();
}));
$('vg-ausrichten').addEventListener('change', vgAlles);
seitenHoerer['seite-vergleich'] = vgAlles;
window.addEventListener('resize', () => { if (tabAktiv('seite-vergleich')) vgDiagramm(); });
