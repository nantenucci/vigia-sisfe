// Utilidad de diagnostico: valida que los selectores del formulario de login
// siguen coincidiendo con el sitio real de SISFE. No usa credenciales, no
// llega a loguearse — solo confirma que la pantalla de login no cambio.
//
// Uso: node src/test-selectors.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto('https://sisfe.justiciasantafe.gov.ar', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Matriculados' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Matriculados' }).click();
await page.waitForSelector('text=IDENTIFICACIÓN DEL MATRICULADO');

const combos = page.locator('select');
console.log('combos encontrados (esperado 2):', await combos.count());
console.log('circunscripciones:', (await combos.nth(0).locator('option').allTextContents()).map(t => t.trim()));
console.log('colegios:', (await combos.nth(1).locator('option').allTextContents()).map(t => t.trim()));

await page.waitForSelector('#matricula');
console.log('#matricula presente:', await page.locator('#matricula').isVisible());
console.log('#password presente:', await page.locator('#password').isVisible());
console.log('boton Ingresar visible:', await page.getByRole('button', { name: 'Ingresar' }).isVisible());

await browser.close();
console.log('OK — selectores de login vigentes.');
