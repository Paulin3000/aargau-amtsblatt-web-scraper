require('dotenv').config();
const { chromium } = require('playwright');
const { parseDetailPage } = require('./parseDetailPage.js');
const { google } = require('googleapis');
const crypto = require('crypto');

const START_URL =
    process.argv[2] ||
    'https://amtsblatt.ag.ch/publikationen/?filter%5Bcategory%5D%5B0%5D=190%2C193&filter%5Btype%5D%5B0%5D=tx_ekab_publication_domain_model_publication&searchQuery=mehrfamilienhaus&timerange%5Btype%5D=4';

const BASE = 'https://amtsblatt.ag.ch';
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const abs = (href) => (href?.startsWith('http') ? href : `${BASE}${href || ''}`);

// Google Sheets Setup
async function initGoogleSheets() {
    const { SHEET_ID, SHEET_RANGE, GOOGLE_APPLICATION_CREDENTIALS } = process.env;
    if (!SHEET_ID || !SHEET_RANGE || !GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error('Fehlende Umgebungsvariablen: SHEET_ID, SHEET_RANGE, GOOGLE_APPLICATION_CREDENTIALS');
    }

    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        keyFile: GOOGLE_APPLICATION_CREDENTIALS,
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    return { sheets, SHEET_ID, SHEET_RANGE };
}

// Read existing URLs from Google Sheets to prevent duplicates
async function getExistingUrls(sheets, SHEET_ID, SHEET_RANGE) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: SHEET_RANGE,
        });
        
        const rows = response.data.values || [];
        const existingUrls = new Set();
        
        // Skip header row (if exists), source_url should be in column F (index 5)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[5]) { // source_url is in column F (index 5)
                existingUrls.add(row[5]);
            }
        }
        
        console.log(`📋 ${existingUrls.size} existierende URLs im Sheet gefunden`);
        return existingUrls;
    } catch (error) {
        console.log(`⚠️ Konnte existierende URLs nicht lesen: ${error.message}`);
        return new Set(); // Return empty set if reading fails
    }
}

// Write data to Google Sheets
async function writeToSheet(sheets, SHEET_ID, SHEET_RANGE, data) {
    // Create SHA digest for unique identification
    const dataString = JSON.stringify({
        url: data.source_url,
        title: data.titel,
        date: data.publiziert_datum
    });
    const sha_digest = crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 12);

    // Map data to sheet columns (published_at is first column now)
    const row = [
        data.publiziert_datum,    // published_at (first column)
        data.titel,               // titel
        data.publikations_nummer, // publikations_nummer
        data.gemeinde,            // gemeinde
        data.gesuchsteller_adresse, // gesuchsteller_adresse (combined name+address)
        data.source_url,          // source_url
        data.document_url,        // document_url
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGE,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
    });
}

async function collectEntriesFromDOM(page) {
    // jede Karte ist .publication-list__item
    return await page.$$eval('.publication-list__item', (items) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const BASE = 'https://amtsblatt.ag.ch';
        const abs = (href) => (href?.startsWith('http') ? href : `${BASE}${href || ''}`);

        return items.map((item) => {
            const titleA = item.querySelector('a.publication-summary__title');
            const title = norm(titleA?.textContent || '');
            const detailRel = titleA?.getAttribute('href') || item.getAttribute('data-detailurl') || '';
            const detailUrl = abs(detailRel);

            const dateEl = item.querySelector('.box-publication-date');
            const date = norm(dateEl?.textContent || '');

            // Gemeinde steht in Definition list unter "Stelle:"
            let gemeinde = '';
            item.querySelectorAll('.box-defenition-list li').forEach((li) => {
                const key = norm(li.querySelector('.col-sm-4')?.textContent || '');
                const val = norm(li.querySelector('.col-sm-8')?.textContent || '');
                if (/^Stelle:?$/i.test(key)) gemeinde = val;
            });

            // PDF-Link
            const pdfA = item.querySelector('a[title="PDF ansehen"]');
            const pdfUrl = abs(pdfA?.getAttribute('href') || '');

            // kurzer Beschreibungstext der Karte
            const snippet = norm(item.querySelector('article p.mb-3')?.textContent || '');

            return { title, date, gemeinde, detailUrl, pdfUrl, snippet };
        });
    });
}

async function scrollToLoad(page, prevCount) {
    const prevH = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const newH = await page.evaluate(() => document.body.scrollHeight);

    // optional ein kleines Wheel-Event, manche Lazy-Loader brauchen Bewegung
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(400);

    const newCount = await page.$$eval('.publication-list__item', (xs) => xs.length);
    return newH > prevH || newCount > prevCount;
}

// Parse alle Detail-Seiten und schreibe sie in Google Sheets
async function parseAndWriteDetails(page, entries, sheets, SHEET_ID, SHEET_RANGE, existingUrls) {
    const parsedEntries = [];
    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(`\n📄 Parse Detail ${i + 1}/${entries.length}: ${entry.title}`);
        
        try {
            if (!entry.detailUrl) {
                console.log('   ⚠️ Keine Detail-URL verfügbar');
                continue;
            }

            // Check for duplicates before parsing (saves time)
            if (existingUrls.has(entry.detailUrl)) {
                console.log('   🔄 Duplikat übersprungen (bereits im Sheet vorhanden)');
                duplicateCount++;
                continue;
            }
            
            const detailData = await parseDetailPage(page, entry.detailUrl);
            parsedEntries.push(detailData);
            
            console.log(`   ✅ Gesuchsteller: ${detailData.gesuchsteller_adresse}`);
            console.log(`   📍 Gemeinde: ${detailData.gemeinde}`);

            // Double-check for duplicates after parsing (in case URL changed during parsing)
            if (existingUrls.has(detailData.source_url)) {
                console.log('   🔄 Duplikat übersprungen (bereits im Sheet vorhanden)');
                duplicateCount++;
                continue;
            }

            // Write to Google Sheets
            try {
                await writeToSheet(sheets, SHEET_ID, SHEET_RANGE, detailData);
                console.log(`   📊 Zeile erfolgreich in Google Sheets geschrieben`);
                
                // Add to existing URLs set to prevent duplicates within this run
                existingUrls.add(detailData.source_url);
                successCount++;
            } catch (sheetError) {
                console.log(`   ❌ Fehler beim Schreiben in Google Sheets: ${sheetError.message}`);
                errorCount++;
            }

            // Kurze Pause zwischen Requests
            await page.waitForTimeout(500);
            
        } catch (error) {
            console.log(`   ❌ Fehler beim Parsen: ${error.message}`);
            errorCount++;
        }
    }
    
    console.log(`\n📊 Google Sheets Statistik:`);
    console.log(`   ✅ Erfolgreich geschrieben: ${successCount}`);
    console.log(`   🔄 Duplikate übersprungen: ${duplicateCount}`);
    console.log(`   ❌ Fehler: ${errorCount}`);
    
    return parsedEntries;
}

(async () => {
    // Initialize Google Sheets
    let sheets, SHEET_ID, SHEET_RANGE;
    try {
        const googleSheets = await initGoogleSheets();
        sheets = googleSheets.sheets;
        SHEET_ID = googleSheets.SHEET_ID;
        SHEET_RANGE = googleSheets.SHEET_RANGE;
        console.log('✅ Google Sheets initialisiert');
    } catch (error) {
        console.error('❌ Fehler bei Google Sheets Initialisierung:', error.message);
        process.exit(1);
    }

    // Load existing URLs to prevent duplicates
    const existingUrls = await getExistingUrls(sheets, SHEET_ID, SHEET_RANGE);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });

    console.log('>> Starte auf:', START_URL);
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

    let entries = await collectEntriesFromDOM(page);
    let printed = 0;
    let stagnation = 0;

    // Sammle erstmal alle Einträge
    for (let cycle = 1; cycle <= 2; cycle++) {
        const fresh = entries.slice(printed, printed + 10);
        
        if (fresh.length) {
            console.log(`\n=== Batch ${cycle} | erkannt: ${entries.length} ===`);
            for (const e of fresh) {
                console.log(`• ${norm(e.title)}  |  ${e.date}  |  ${norm(e.gemeinde)}`);
                console.log(`  url: ${e.detailUrl}`);
            }
            printed += fresh.length;
            stagnation = 0;
        } else {
            stagnation++;
        }

        const before = entries.length;
        const progressed = await scrollToLoad(page, before);
        if (!progressed) stagnation++;

        entries = await collectEntriesFromDOM(page);
        if (stagnation >= 3) {
            console.log('\n— Stopp: keine neuen Einträge nach mehreren Versuchen —');
            break;
        }
    }

    console.log(`\n≈ Gesamt erkannte Karten: ${entries.length}`);
    
    // Jetzt parse alle Detail-Seiten und schreibe in Google Sheets
    console.log('\n🔍 Starte Detail-Parsing und Google Sheets Import...');
    const parsedData = await parseAndWriteDetails(page, entries, sheets, SHEET_ID, SHEET_RANGE, existingUrls);
    
    console.log(`\n✅ ${parsedData.length} Detail-Seiten erfolgreich geparst und importiert`);

    await browser.close();
})().catch((err) => {
    console.error('❌ Hauptfehler:', err);
    process.exit(1);
});
