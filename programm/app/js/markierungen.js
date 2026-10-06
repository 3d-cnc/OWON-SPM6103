'use strict';
/* SPM-17: Markierungen – per Taste M oder Knopf einen Zeitpunkt mit Notiz markieren.
   Erscheint als Linie in den Kurven, in der Tabelle der Aufzeichnung und als Spalte in der CSV-Datei.
   Die Automatiken setzen über ereignisSetzen() ihre eigenen Markierungen. */

async function markierungSetzen() {
  const zeit = Date.now();
  const nr = zustand.ereignisse.filter(e => e.art === 'notiz').length + 1;
  const text = await eingabeFragen('Markierung setzen', `Notiz für ${uhrzeit(zeit)} – erscheint in den Kurven, der Tabelle und der CSV-Datei.`, `Markierung ${nr}`);
  if (text === null) return;
  // Zeitpunkt des Tastendrucks, nicht des Bestätigens
  zustand.ereignisse.push({ t: zeit, text: text.trim() || `Markierung ${nr}`, art: 'notiz' });
  zustand.offeneNotizen.push(text.trim() || `Markierung ${nr}`);
  log('Markierung: ' + (text.trim() || `Markierung ${nr}`), 'info');
  zeichnenAnfordern();
  aufzeichnungAnzeigen();
}

$('markierung-knopf').addEventListener('click', markierungSetzen);
window.addEventListener('keydown', e => {
  const ziel = e.target;
  const tippt = ziel instanceof HTMLInputElement || ziel instanceof HTMLTextAreaElement || ziel instanceof HTMLSelectElement;
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.altKey && !e.metaKey && !tippt && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    markierungSetzen();
  }
});
