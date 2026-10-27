// Real facts only, from go2Project/founder (facts.md, elevator-pitch.md, 2026-10-19). Update here when numbers change.
export const SERIES_BIBLE = {
  title: "Come vendere un'app online (in fretta)",
  premise:
    "Parodia di 'How to Sell Drugs Online (Fast)': Thomas, founder solo, racconta in prima persona e rompendo la quarta parete come prova a far usare go2match alle discoteche e a chi esce la sera. Quello che 'spaccia' e' un'app.",
  tone: [
    "Cinematico ma non troppo: voice-over in prima persona, freeze-frame, testo a schermo stile serie, una sola inquadratura 'da film' per episodio, il resto girato col telefono.",
    "Autoironico, onesto sui numeri piccoli: i fallimenti fanno ridere e creano attaccamento.",
    "Mai spot: l'app compare al massimo 2-3 secondi, come oggetto della storia.",
    "Italiano parlato, frasi brevi, durata 30-60 secondi.",
  ],
  narrator: "Thomas Favero, founder di go2match. A 15 anni ha creato Spotted per la sua scuola: 1.900 studenti raggiunti con una e-mail e cinque giorni di sospensione. Poi Teachflow, UniHelp, Remi. Infine go2match.",
  product:
    "go2match e' il social layer sopra la serata: entri in discoteca, l'app fa check-in da sola con il geofence e solo per quella notte vedi chi c'e', fai match, chatti e fai sfide con prova fotografica. Il locale scopre chi entra e chi torna. Il locale paga a consumo da 0 a 499 euro al mese, zero commissioni.",
  facts: [
    "In Italia 2.500 discoteche, 34 milioni di ingressi l'anno, ma nessun gestore sa chi e' entrato ne' chi torna.",
    "Il 64,9% dei giovani sceglie il locale dalle promozioni social; il 79% gira tra cinque o piu' locali.",
    "App live su App Store dal 5 giugno 2026 e su Google Play, versione 1.1.7.",
    "Una sola persona ha costruito app, 17 servizi backend, infrastruttura e backoffice in sei mesi.",
    "Al 19 ottobre 2026: 166 profili, 2.021 eventi da 16 fonti, 415 locali, 33 utenti con check-in verificato in 5 locali, 2 gestori, zero ricavi.",
    "19 settembre 2026: serata di lancio con magliette con QR code e gente che installava l'app in pista.",
    "Pre-seed: cerca 100 mila euro per validare. Piano: un evento a tema go2match, poi 20 discoteche founding partner in Veneto con 60 giorni gratis e 30% di sconto per 12 mesi.",
  ],
  // One beat per episode, cycled. Each beat must be told with a format taken from today's real trends.
  beats: [
    "Pilota: chi sono, cosa vendo, perche' 'in fretta'. Il cold open e' la sospensione per Spotted a 15 anni.",
    "Il problema: 2.500 discoteche e nessuno sa chi entra. Io lo spiego ai gestori, loro mi guardano come un pazzo.",
    "Sei mesi da solo: 17 servizi backend, un'app, un backoffice. Montaggio notturno, caffe', bug alle 4.",
    "Il giorno in cui l'app esce sull'App Store (5 giugno 2026) e i download che arrivano (pochi).",
    "La serata delle magliette con il QR code (19 settembre): il piano, cosa e' andato storto, cosa ha funzionato.",
    "I numeri veri: 166 profili, 33 check-in verificati, zero euro. Fare pace con i numeri piccoli.",
    "Il primo gestore che dice si'. Il primo che dice no. Imitazione di entrambi.",
    "Come funzionano le sfide in serata: ne faccio una io, dal vivo, in discoteca.",
    "Il check-in automatico spiegato come una rapina: geofence, niente QR, niente liste.",
    "Il prezzo: da 0 a 499 euro, zero commissioni. Perche' un locale dovrebbe pagarmi.",
    "La raccolta da 100 mila euro: il pitch provato davanti allo specchio, alla nonna, agli amici.",
    "20 discoteche founding partner in Veneto: la mappa, la lista, il piano di attacco.",
  ],
  defaultQueries: [
    "discoteca",
    "serata in discoteca pov",
    "sfida tra amici",
    "storytime startup",
    "founder story app",
    "vlog imprenditore",
  ],
} as const;

// Counts the days the cron "0 9 */N * *" fires (day of month 1, 1+N, ...) from startDate to today.
export function episodeNumber(startDate: string, today: Date, everyDays = 4): number {
  const day = new Date(`${startDate}T00:00:00Z`);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let count = 0;
  for (; day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) if ((day.getUTCDate() - 1) % everyDays === 0) count++;
  return Math.max(1, count);
}
