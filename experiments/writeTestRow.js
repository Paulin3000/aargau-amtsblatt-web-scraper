require('dotenv').config();
const { google } = require('googleapis');

async function main() {
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

    // Dummy-Zeile (passt zu deiner Spaltenreihenfolge A–K)
    const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const row = [
        now,                   // published_at
        'Aarau',               // gemeinde
        'MFH Neubau',          // titel
        '3-geschossig, 8 Whg', // projekt_beschreibung
        'Beispielstrasse 12',  // projekt_adresse
        'Parz. 1234',          // parzelle
        'Muster AG',           // gesuchsteller_name
        'Hauptstrasse 1',      // gesuchsteller_adresse
        'https://amtsblatt.ag.ch/', // source_url
        '',                    // document_url
        'demo-sha-123'         // sha_digest
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGE,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
    });

    console.log('✅ Testzeile erfolgreich geschrieben.');
}

main().catch(err => {
    console.error('❌ Fehler beim Schreiben:', err.message);
    if (err.errors) console.error(err.errors);
    process.exit(1);
});
