// Vigia SISFE: reusa una sesion ya logueada (guardada por save-session.mjs)
// para traer la lista de expedientes vinculados a la matricula, la compara
// contra la ultima corrida y manda un email si hay expedientes nuevos o con
// novedades.
//
// El login de SISFE exige resolver un reCAPTCHA, asi que no se automatiza:
// el usuario se loguea a mano una vez (node src/save-session.mjs) y este
// script reutiliza esa sesion mientras siga viva. Si vence, este script lo
// detecta y avisa por email en vez de intentar loguearse solo.
//
// El snapshot de causas (state.json) y la sesion (session.json) tienen
// nombres y caratulas reales de clientes: nunca se guardan adentro del
// repo ni se suben a git. Viven en el disco de la PC que corre el chequeo,
// fuera de la carpeta de trabajo (para que "git clean" del checkout no los
// borre entre corridas).
//
// Variables de entorno:
//   NOTIFY_EMAIL           direccion que recibe los avisos
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   credenciales del remitente
//   SESSION_PATH           opcional, default ~/.vigia-sisfe/session.json
//   STATE_PATH             opcional, default ~/.vigia-sisfe/state.json

import { chromium } from 'playwright';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const STATE_PATH = process.env.STATE_PATH || path.join(os.homedir(), '.vigia-sisfe', 'state.json');
const SESSION_PATH = process.env.SESSION_PATH || path.join(os.homedir(), '.vigia-sisfe', 'session.json');

async function buscar(page) {
  await page.goto('https://sisfe.justiciasantafe.gov.ar/buscar-expediente', { waitUntil: 'domcontentloaded' });

  if (!page.url().includes('/buscar-expediente')) {
    throw new SessionExpiradaError(`La sesion guardada ya no sirve (redirigio a ${page.url()}).`);
  }

  // "Debe ingresar algun valor de busqueda": no se puede dejar todo vacio.
  // Usamos el filtro de dias con un numero grande para traer todo lo
  // vinculado a la matricula, sin filtrar por nombre/caratula.
  await page.locator('#diasNovedades').fill('9999');
  await page.getByRole('button', { name: 'Efectuar la búsqueda' }).click();
  await page.waitForSelector('text=/expedientes? (para|encontrado)/i', { timeout: 30000 });
  if (process.env.DEBUG_CELDAS) {
    console.log('Resumen:', await page.locator('text=/Se han encontrado/i').innerText().catch(() => '(sin resumen)'));
  }

  const causas = [];
  let pagina = 1;
  while (true) {
    if (process.env.DEBUG_CELDAS) console.log('--- pagina', pagina, '---');
    const filas = page.locator('table tbody tr, [role="row"]').filter({ hasText: /\d{2,}-\d+/ });
    const count = await filas.count();
    for (let i = 0; i < count; i++) {
      const fila = filas.nth(i);
      // Hay celdas de icono/columna-info sin texto (tramitacion digital,
      // boton de info) mezcladas con las 5 columnas reales. Nos quedamos
      // solo con las celdas que tienen contenido.
      const celdas = (await fila.locator('td, [role="cell"]').allInnerTexts())
        .map((c) => c.trim())
        .filter(Boolean);
      if (celdas.length < 5) continue;
      const [expediente, caratula, fechaInicio, ultimaActualizacion, radicacion] = celdas;
      if (!expediente?.trim()) continue;
      const href = await fila.locator('a').first().getAttribute('href').catch(() => null);
      causas.push({
        expediente: expediente.trim(),
        caratula: caratula.trim(),
        fecha_inicio: fechaInicio.trim(),
        ultima_actualizacion: ultimaActualizacion.trim(),
        radicacion: radicacion.trim(),
        url: href ? new URL(href, 'https://sisfe.justiciasantafe.gov.ar').toString() : null,
      });
    }

    const siguienteLi = page.locator('li.page-item', { hasText: 'Siguiente' }).first();
    const existe = await siguienteLi.count();
    const clase = existe ? await siguienteLi.getAttribute('class').catch(() => '') : '';
    const deshabilitado = /disabled/i.test(clase || '');
    if (process.env.DEBUG_CELDAS) console.log('Siguiente existe:', !!existe, 'clase li:', clase);
    if (!existe || deshabilitado) break;
    await siguienteLi.locator('a').click();
    await page.waitForTimeout(1500);
    pagina++;
  }

  return causas;
}

class SessionExpiradaError extends Error {}

function diff(previas, actuales) {
  const previasPorExpediente = new Map(previas.map((c) => [c.expediente, c]));
  const nuevas = [];
  const actualizadas = [];

  for (const actual of actuales) {
    const previa = previasPorExpediente.get(actual.expediente);
    if (!previa) {
      nuevas.push(actual);
    } else if (previa.ultima_actualizacion !== actual.ultima_actualizacion) {
      actualizadas.push({ actual, antes: previa.ultima_actualizacion });
    }
  }

  return { nuevas, actualizadas };
}

async function enviarEmail(asunto, cuerpo) {
  if (!process.env.SMTP_HOST) {
    console.log(`SMTP no configurado, salteo el envio de email.\nAsunto: ${asunto}\n${cuerpo}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: asunto,
    text: cuerpo,
  });

  console.log('Email enviado:', asunto);
}

async function avisarCambios({ nuevas, actualizadas }) {
  const lineas = [];
  if (nuevas.length) {
    lineas.push(`EXPEDIENTES NUEVOS (${nuevas.length}):`);
    for (const c of nuevas) {
      lineas.push(`  - ${c.expediente} — ${c.caratula} — ${c.radicacion}`);
      if (c.url) lineas.push(`    ${c.url}`);
    }
    lineas.push('');
  }
  if (actualizadas.length) {
    lineas.push(`EXPEDIENTES CON NOVEDADES (${actualizadas.length}):`);
    for (const { actual, antes } of actualizadas) {
      lineas.push(`  - ${actual.expediente} — ${actual.caratula} — actualizado ${antes} -> ${actual.ultima_actualizacion}`);
      if (actual.url) lineas.push(`    ${actual.url}`);
    }
  }

  await enviarEmail(
    `Vigia SISFE: ${nuevas.length} nueva(s), ${actualizadas.length} con novedad(es)`,
    lineas.join('\n')
  );
}

async function main() {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });

  let previas = [];
  try {
    previas = JSON.parse(await readFile(STATE_PATH, 'utf8')).causas ?? [];
  } catch {
    console.log('No hay estado previo, arranco de cero.');
  }

  let sessionExiste = true;
  try {
    await readFile(SESSION_PATH, 'utf8');
  } catch {
    sessionExiste = false;
  }

  if (!sessionExiste) {
    await enviarEmail(
      'Vigia SISFE: hace falta loguearse',
      `Todavia no hay una sesion guardada en ${SESSION_PATH}.\n\nCorre "node src/save-session.mjs" en la PC del estudio para crearla.`
    );
    console.error('No existe la sesion guardada. Corre save-session.mjs primero.');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: SESSION_PATH });
  const page = await context.newPage();

  try {
    const causas = await buscar(page);
    console.log(`Encontre ${causas.length} expediente(s) vinculado(s) a la matricula.`);

    const cambios = diff(previas, causas);
    const huboCambios = cambios.nuevas.length > 0 || cambios.actualizadas.length > 0;

    if (huboCambios && previas.length > 0) {
      // Solo avisamos si ya habia un estado previo: la primera corrida
      // solo siembra el snapshot inicial, no dispara alertas.
      await avisarCambios(cambios);
    } else if (huboCambios) {
      console.log('Primera corrida: siembro el snapshot inicial sin avisar por email.');
    } else {
      console.log('Sin novedades.');
    }

    await writeFile(
      STATE_PATH,
      JSON.stringify({ actualizado: new Date().toISOString(), causas }, null, 2)
    );
  } catch (err) {
    if (err instanceof SessionExpiradaError) {
      await enviarEmail(
        'Vigia SISFE: la sesion vencio',
        `${err.message}\n\nCorre "node src/save-session.mjs" en la PC del estudio para volver a loguearte (con el captcha a mano) y seguir recibiendo avisos.`
      );
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
