// Erwartet eine Playwright-Page und die Detail-URL.
// Gibt ein Objekt mit den Feldern zurück:
// { titel, publikations_nummer, publiziert_datum, gemeinde, gesuchsteller_adresse, bauobjekt, source_url, document_url }
async function parseDetailPage(page, detailUrl) {
    const BASE = 'https://amtsblatt.ag.ch';
    const abs = (href) => (href?.startsWith('http') ? href : `${BASE}${href || ''}`);
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

    const parseSwissDate = (s) => {
        // "29.08.2025" -> "2025-08-29"
        const m = (s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (!m) return norm(s);
        const [ , d, mo, y ] = m;
        const dd = String(d).padStart(2, '0');
        const mm = String(mo).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
    };

    await page.goto(detailUrl, { waitUntil: 'networkidle' });

    // Wait a bit for the page to fully load
    await page.waitForTimeout(2000);

    // Titel & Datum
    const titel = norm(await page.textContent('h2.box-mainbox-main-title').catch(() => '')) || '';
    const publiziertRaw = norm(await page.textContent('.box-publication-date').catch(() => '')) || '';
    const publiziert_datum = parseSwissDate(publiziertRaw);

    // Sidebar: Publ.-Nr. & Stelle (Gemeinde) - using robust DOM search approach
    let publikations_nummer = '';
    let gemeinde = '';

    // Extract both fields using the same approach as the working test script
    const sidebarData = await page.evaluate(() => {
        const results = {
            publikations_nummer: '',
            gemeinde: ''
        };

        // Find all li elements
        const listItems = document.querySelectorAll('li');

        for (const li of listItems) {
            // Look for the first <p> with <b> containing our target fields
            const firstP = li.querySelector('p b');
            if (firstP) {
                const keyText = firstP.textContent.trim();
                
                // Check for Publ.-Nr
                if (/^Publ\.-?Nr\.?:?\s*$/i.test(keyText)) {
                    // Found "Publ.-Nr:" - get the value from the second <p>
                    const secondP = li.querySelector('p:nth-child(2)');
                    if (secondP) {
                        results.publikations_nummer = secondP.textContent.trim();
                    } else {
                        // Fallback: try p:last-child
                        const lastP = li.querySelector('p:last-child');
                        if (lastP && lastP !== firstP.parentElement) {
                            results.publikations_nummer = lastP.textContent.trim();
                        }
                    }
                }
                
                // Check for Stelle
                if (/^Stelle:?\s*$/i.test(keyText)) {
                    // Found "Stelle:" - get the value from the second <p>
                    const secondP = li.querySelector('p:nth-child(2)');
                    if (secondP) {
                        results.gemeinde = secondP.textContent.trim();
                    } else {
                        // Fallback: try p:last-child
                        const lastP = li.querySelector('p:last-child');
                        if (lastP && lastP !== firstP.parentElement) {
                            results.gemeinde = lastP.textContent.trim();
                        }
                    }
                }
            }
        }

        // Fallback: text-based search if DOM approach fails
        if (!results.publikations_nummer || !results.gemeinde) {
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Look for Publ.-Nr
                if (!results.publikations_nummer && /^Publ\.-?Nr\.?:?\s*$/i.test(line)) {
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine && nextLine.length > 0 && nextLine.length < 50) {
                            results.publikations_nummer = nextLine;
                            break;
                        }
                    }
                }
                
                // Look for Stelle
                if (!results.gemeinde && /^Stelle:?\s*$/i.test(line)) {
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine && nextLine.length > 0 && nextLine.length < 100) {
                            results.gemeinde = nextLine;
                            break;
                        }
                    }
                }
            }
        }

        return results;
    });

    publikations_nummer = sidebarData.publikations_nummer;
    gemeinde = sidebarData.gemeinde;

    // Content-Absätze
    const paragraphs = await page.$$eval('div.publication-detail__content > p', (ps) =>
        ps.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );

    // Gesuchsteller: nimm das erste <p> und schneide das Label vor dem : weg
    let gesuchsteller_adresse = '';

    if (paragraphs.length > 0) {
        const firstParagraph = paragraphs[0];
        // Entferne alles vor dem ersten ":" (inkl. dem ":")

        const colonIndex = firstParagraph.indexOf(':');
        if (colonIndex !== -1) {
            gesuchsteller_adresse = norm(firstParagraph.substring(colonIndex + 1));
        } else {
            // Falls kein ":" gefunden wird, nimm den ganzen Text
            gesuchsteller_adresse = firstParagraph;
        }


    }

    /*
    // Bauobjekt: Zeile mit "Bauobjekt:" oder "Bauvorhaben:"
    let bauobjekt = '';
    if (paragraphs.length) {
        const p = paragraphs.find((t) => /^Bauobjekt\s*:|^Bauvorhaben\s*:/i.test(t));
        if (p) bauobjekt = norm(p.replace(/^Bauobjekt\s*:|^Bauvorhaben\s*:/i, ''));
    }

     */

    // PDF-Link
    const document_url = abs(await page.getAttribute('a[title="PDF ansehen"]', 'href').catch(() => '') || '');

    return {
        titel,
        publikations_nummer,
        publiziert_datum,
        gemeinde,
        gesuchsteller_adresse,
        source_url: detailUrl,
        document_url,
    };
}

module.exports = { parseDetailPage };
