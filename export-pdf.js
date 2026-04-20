/**
 * Export HTML slide deck to PDF
 * Usage: node export-pdf.js <input.html> [output.pdf]
 *
 * Example:
 *   node export-pdf.js CAM-DataPitchClinic_04_20_2026.html
 *   node export-pdf.js CAM-DataPitchClinic_04_20_2026.html my-deck.pdf
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function exportToPdf(inputFile, outputFile) {
    const absInput = path.resolve(inputFile);

    if (!fs.existsSync(absInput)) {
        console.error(`File not found: ${absInput}`);
        process.exit(1);
    }

    if (!outputFile) {
        outputFile = inputFile.replace(/\.html$/i, '.pdf');
    }
    const absOutput = path.resolve(outputFile);

    console.log(`Opening: ${absInput}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 16:9 slide dimensions at 96dpi → 1280x720px
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

    await page.goto(`file://${absInput}`, { waitUntil: 'networkidle0' });

    // Wait for fonts and animations to settle
    await new Promise(r => setTimeout(r, 1500));

    // Count total slides
    const totalSlides = await page.evaluate(() => {
        return document.querySelectorAll('.slide').length;
    });

    console.log(`Found ${totalSlides} slides`);

    const screenshots = [];
    const tmpDir = path.join(path.dirname(absOutput), '_pdf_tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    for (let i = 0; i < totalSlides; i++) {
        // Navigate to slide i
        await page.evaluate((index) => {
            const slides = document.querySelectorAll('.slide');
            slides.forEach(s => s.classList.remove('active'));
            slides[index].classList.add('active');

            // Re-trigger animations
            const animated = slides[index].querySelectorAll('.fade-in-up');
            animated.forEach(el => {
                el.style.animation = 'none';
                el.offsetHeight;
                el.style.animation = '';
            });
        }, i);

        // Wait for animations
        await new Promise(r => setTimeout(r, 900));

        const imgPath = path.join(tmpDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
        await page.screenshot({ path: imgPath, type: 'png' });
        screenshots.push(imgPath);
        process.stdout.write(`  Captured slide ${i + 1}/${totalSlides}\r`);
    }

    console.log(`\nBuilding PDF...`);

    // Use a second page to assemble all screenshots into a PDF
    const pdfPage = await browser.newPage();

    // Build an HTML page with all screenshots as pages
    const imgTags = screenshots.map(p => {
        const data = fs.readFileSync(p);
        const b64 = data.toString('base64');
        return `<div class="page"><img src="data:image/png;base64,${b64}"/></div>`;
    }).join('\n');

    const assemblyHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; }
  .page {
    width: 1280px;
    height: 720px;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: avoid; }
  img { width: 1280px; height: 720px; display: block; }
</style>
</head>
<body>${imgTags}</body>
</html>`;

    await pdfPage.setContent(assemblyHtml, { waitUntil: 'networkidle0' });

    await pdfPage.pdf({
        path: absOutput,
        width: '1280px',
        height: '720px',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    await browser.close();

    // Clean up temp files
    screenshots.forEach(f => fs.unlinkSync(f));
    fs.rmdirSync(tmpDir);

    console.log(`\nPDF saved: ${absOutput}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('Usage: node export-pdf.js <input.html> [output.pdf]');
    process.exit(1);
}

exportToPdf(args[0], args[1]).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
