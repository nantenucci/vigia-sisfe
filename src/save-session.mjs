// Abre un navegador VISIBLE para que te loguees vos a mano (usuario,
// contraseña, captcha) y despues guarda la sesion (cookies) fuera del
// repo, en ~/.vigia-sisfe/session.json. Los proximos chequeos automaticos
// reusan ese archivo en vez de loguearse de nuevo.
//
// Uso: node src/save-session.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Se guarda fuera de la carpeta del repo: "git clean" en cada corrida del
// workflow borraria este archivo si viviera adentro de vigia-sisfe/.
const STATE_PATH = process.env.SESSION_PATH || path.join(os.homedir(), '.vigia-sisfe', 'session.json');

async function main() {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://sisfe.justiciasantafe.gov.ar');
  console.log('Se abrio una ventana de Chrome. Logueate ahi normalmente');
  console.log('(Matriculados -> tu circunscripcion/colegio/matricula/contrasena -> captcha -> Ingresar).');
  console.log('Este script espera solo hasta que la URL llegue a /buscar-expediente...');

  await page.waitForURL('**/buscar-expediente', { timeout: 5 * 60 * 1000 });

  await page.context().storageState({ path: STATE_PATH });
  console.log('Sesion guardada en', STATE_PATH);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
