// Minimaler Sichttest für das Amtsblatt Aargau
// Ziel: Titel + URL von Einträgen finden, die nach "Baugesuch" / "Bau- und Rodungsgesuche" aussehen

const { chromium } = require('playwright');

async function main() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // 1) Startseite aufrufen
    const START_URL = 'https://amtsblatt.ag.ch/';
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

    // 2) Alle Links einsammeln
    const links = await page.$$eval('a', as =>
        as
            .map(a => ({
                text: (a.textContent || '').trim().replace(/\s+/g, ' '),
                href: a.href || '',
            }))
            .filter(x => x.href && x.text)
    );

    // 3) Grobe Heuristik: Kandidaten für Bau-/Rodungsgesuche
    const re = /\b(Bau.*gesuch|Baugesuch|Rodungsgesuch|Bau- und Rodungsgesuche)\b/i;
    const candidates = links.filter(l => re.test(l.text));

    // 4) Ausgabe
    if (candidates.length === 0) {
        console.log('⚠️  Keine offensichtlichen Bau-/Rodungsgesuch-Links auf der Startseite gefunden.');
        console.log('Tipp: Manche Portale haben eine eigene Rubrik/Unterseite. Wir können im nächsten Schritt gezielt dorthin navigieren oder eine Suchfunktion benutzen.');
    } else {
        console.log(`✅ Kandidaten gefunden: ${candidates.length}`);
        for (const c of candidates.slice(0, 25)) {
            console.log(`• ${c.text}  ->  ${c.href}`);
        }
        if (candidates.length > 25) {
            console.log(`…und ${candidates.length - 25} weitere`);
        }
    }

    // 5) Optional: Wenn eine “Rubrik”-Seite klar ist, hier direkt hin navigieren
    // Beispiel (Platzhalter!): await page.goto('https://amtsblatt.ag.ch/irgendeine-unterseite');
    // Dann denselben Link-Scan dort wiederholen.

    await browser.close();
}

main().catch((err) => {
    console.error('❌ Fehler:', err);
    process.exit(1);
});
