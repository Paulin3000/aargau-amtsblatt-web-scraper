const { chromium } = require('playwright');

async function getGemeindeFromUrl(url) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        // Navigate to the page
        await page.goto(url, { waitUntil: 'networkidle' });

        // Wait a bit for the page to fully load
        await page.waitForTimeout(3000);

        // Look for the specific structure: <li> containing <p><b>Stelle:</b></p><p>VALUE</p>
        const stelle = await page.evaluate(() => {
            // Find all li elements
            const listItems = document.querySelectorAll('li');

            for (const li of listItems) {
                // Look for the first <p> with <b> containing "Stelle:"
                const firstP = li.querySelector('p b');
                if (firstP && /^Stelle:?\s*$/i.test(firstP.textContent.trim())) {
                    // Found "Stelle:" - now get the value from the second <p>
                    const secondP = li.querySelector('p:nth-child(2)');
                    if (secondP) {
                        return secondP.textContent.trim();
                    }

                    // Fallback: try p:last-child
                    const lastP = li.querySelector('p:last-child');
                    if (lastP && lastP !== firstP.parentElement) {
                        return lastP.textContent.trim();
                    }
                }
            }

            return null;
        });

        if (stelle) {
            console.log('Found Stelle:', stelle);
            return stelle;
        }

        // Fallback method: look for any text pattern near "Stelle:"
        const stelleFallback = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (/^Stelle:?\s*$/i.test(line)) {
                    // Check the next few lines for the value
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine && nextLine.length > 0 && nextLine.length < 100) {
                            return nextLine;
                        }
                    }
                }
            }

            return null;
        });

        if (stelleFallback) {
            console.log('Found Stelle (fallback):', stelleFallback);
            return stelleFallback;
        }

        console.log('Could not find Stelle');
        return null;

    } catch (error) {
        console.error('Error extracting Stelle:', error);
        return null;
    } finally {
        await browser.close();
    }
}

// Main execution
async function main() {
    // Test with the new URL you provided (Stadt Brugg example)
    const url = 'https://amtsblatt.ag.ch/ekab/00.075.690/publikation/';
    const stelle = await getGemeindeFromUrl(url);

    if (stelle) {
        console.log(`✅ Successfully extracted Stelle: ${stelle}`);
    } else {
        console.log('❌ Could not extract Stelle');
    }
}

// Run the script
main().catch(console.error);