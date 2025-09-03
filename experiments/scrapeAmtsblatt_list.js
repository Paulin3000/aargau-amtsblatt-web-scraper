// Listenscraper für die Rubrik "Bau- und Rodungsgesuche" (mit optionalem Suchwort)
// Läuft auf der von dir gegebenen URL und klickt durch die Seiten.
// Ausgabe: Titel, Datum (falls sichtbar), Link zur Detailseite.

// Usage:
//   node scrapeAmtsblatt-first.js
//   node scrapeAmtsblatt-first.js "https://amtsblatt.ag.ch/publikationen/?timerange[type]=4&filter[category][]=190%2C193"
//   node scrapeAmtsblatt-first.js "https://amtsblatt.ag.ch/publikationen/?filter%5Bcategory%5D%5B0%5D=190%2C193&filter%5Btype%5D%5B0%5D=tx_ekab_publication_domain_model_publication&searchQuery=mehrfamilienhaus&timerange%5Btype%5D=4"

const { chromium } = require('playwright');

const DEFAULT_URL =
    'https://amtsblatt.ag.ch/publikationen/?timerange[type]=4&filter[category][]=190%2C193';

const START_URL = process.argv[2] || DEFAULT_URL;

// Hilfsfunktion: minimaler Normalizer
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function extractPageEntries(page) {
    // Warte, bis die Resultatliste geladen erscheint.
    // Der konkrete Selektor kann variieren, daher mehrere Fallbacks.
    await page.waitForLoadState('domcontentloaded');

    // 1) Kandidaten-Container suchen
    const containers = await page.$$('main, .main, #content, [data-list], .list, .container');
    let entries = [];

    // 2) Grobstrategie: Alle Links in Resultatbereich einsammeln, dann heuristisch filtern.
    //   Wir nehmen Links, die zu Detailseiten führen (oft enthalten sie einen Teilpfad),
    //   und lesen danebenliegende Titel/Datum.
    const links = await page.$$eval('a', (as) =>
        as.map((a) => ({
            href: a.href || '',
            text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
            // für spätere Präzisierung könnten wir hier auch parentNode.innerText ziehen
        }))
    );

    // Heuristik: Detailseiten haben meist "publikationen" im Path und/oder nicht nur Hash/JS
    const candidates = links.filter(
        (l) =>
            l.href &&
            /^https?:\/\//.test(l.href) &&
            /amtsblatt\.ag\.ch\/publikationen\//i.test(l.href) &&
            !/#/.test(l.href)
    );

    // Dedup nach URL
    const seen = new Set();
    for (const c of candidates) {
        if (seen.has(c.href)) continue;
        seen.add(c.href);
        entries.push({ title: c.text, href: c.href });
    }

    // Falls die Titel leer sind, versuchen wir, die Überschrift aus dem Link-Kontext zu erweitern:
    // (Optional, funktioniert in vielen Listenseiten)
    if (entries.some((e) => !e.title)) {
        const enhanced = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('a').forEach((a) => {
                const href = a.href || '';
                if (!href.match(/amtsblatt\.ag\.ch\/publikationen\//i)) return;
                // Nehme den nächstgelegenen Titeltext in Elternknoten
                const parentText = (a.closest('article, li, .result, .card, .publication, .list-item')?.innerText || '')
                    .replace(/\s+/g, ' ')
                    .trim();
                out.push({ href, ctx: parentText });
            });
            return out;
        });

        const map = new Map(enhanced.map((e) => [e.href, e.ctx]));
        entries = entries.map((e) => {
            if (e.title) return e;
            const ctx = map.get(e.href) || '';
            // häufig steht der Titel am Anfang der Box
            const titleGuess = ctx.split(' • ')[0].split('\n')[0];
            return { ...e, title: norm(titleGuess) };
        });
    }

    // Datum heuristisch aus dem Kontext ziehen (optional, macht die Ausgabe nützlicher)
    // Wir lassen es simpel: Datum YYYY-MM-DD oder DD.MM.YYYY im Titel/ctx erkennen.
    const dateRe = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\b/;

    entries = entries.map((e) => {
        const m = e.title.match(dateRe);
        return { ...e, date: m ? m[1] : '' };
    });

    return entries;
}

async function clickNextIfAny(page) {
    // Versuche verschiedene Selektoren/Texte für "nächste Seite"
    const candidates = [
        'a[rel="next"]',
        'button[rel="next"]',
        'a:has-text("Weiter")',
        'button:has-text("Weiter")',
        'a:has-text("Nächste")',
        'button:has-text("Nächste")',
        '.pagination-next a',
        '.pager__item--next a',
    ];

    for (const sel of candidates) {
        const el = await page.$(sel);
        if (el) {
            await Promise.all([page.waitForLoadState('domcontentloaded'), el.click()]);
            // kleine Wartezeit, falls Inhalte via JS nachgeladen werden
            await page.waitForTimeout(400);
            return true;
        }
    }
    return false;
}

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    console.log('>> Starte auf:', START_URL);
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

    const MAX_PAGES = 5; // zum Testen: erst mal 5 Seiten
    let pageNo = 1;
    let total = 0;

    while (pageNo <= MAX_PAGES) {
        console.log(`\n=== Seite ${pageNo} ===`);
        const entries = await extractPageEntries(page);

        if (!entries.length) {
            console.log('Keine Einträge erkannt. Möglicherweise ändern wir im nächsten Schritt die Selektoren.');
        } else {
            // zeige die ersten 10 pro Seite
            for (const e of entries.slice(0, 10)) {
                console.log(`• ${e.title || '(ohne Titel)'}  |  ${e.date || ''}`);
                console.log(`  ${e.href}`);
            }
            total += entries.length;
            console.log(`(insgesamt auf dieser Seite erkannt: ${entries.length})`);
        }

        // Pagination
        const hasNext = await clickNextIfAny(page);
        if (!hasNext) break;
        pageNo++;
    }

    console.log(`\n≈ Gesamteinträge (gezählt über die gelesenen Seiten): ~${total}`);
    await browser.close();
})().catch((err) => {
    console.error('Fehler:', err);
    process.exit(1);
});
