// Vigia SISFE: entra a la Autoconsulta Web del Poder Judicial de Santa Fe con
// las credenciales de un matriculado, trae la lista de expedientes vinculados
// a esa matricula, la compara contra la ultima corrida (data/state.json) y
// manda un email si hay expedientes nuevos o con novedades.
//
// Variables de entorno requeridas:
//   SISFE_MATRICULA        numero de matricula (sin puntos ni espacios)
//   SISFE_CONTRASENA       contraseña de SISFE
//   SISFE_CIRCUNSCRIPCION  "Santa Fe" | "Rosario" | "Venado Tuerto" | "Reconquista" | "Rafaela"
//   SISFE_COLEGIO          por defecto "Abogados"
//   NOTIFY_EMAIL           direccion que recibe los avisos
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   credenciales del remitente

import { chromium } from 'playwright';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const STATE_PATH = path.resolve('data/state.json');

const required = ['SISFE_MATRICULA', 'SISFE_CONTRASENA'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Falta la variable de entorno ${key}`);
    process.exit(1);
  }
}

const CIRCUNSCRIPCION = process.env.SISFE_CIRCUNSCRIPCION || 'Rosario';
const COLEGIO = process.env.SISFE_COLEGIO || 'Abogados';

async function login(page) {
  await page.goto('https://sisfe.justiciasantafe.gov.ar', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Matriculados' }).click();

  await page.waitForSelector('text=IDENTIFICACIÓN DEL MATRICULADO');

  const combos = page.locator('select');
  await combos.nth(0).selectOption({ label: CIRCUNSCRIPCION });
  await combos.nth(1).selectOption({ label: COLEGIO });

  await page.waitForSelector('#matricula');
  await page.locator('#matricula').fill(process.env.SISFE_MATRICULA);
  await page.locator('#password').fill(process.env.SISFE_CONTRASENA);

  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL('**/buscar-expediente', { timeout: 30000 });
}

async function buscar(page) {
  // Deja todos los filtros vacios: trae todo lo vinculado a la matricula.
  await page.getByRole('button', { name: 'Efectuar la búsqueda' }).click();
  // Espera a que aparezca el mensaje de resultados o la fila "no encontrados".
  await page.waitForSelector('text=/expedientes? (para|encontrado)/i', { timeout: 30000 });

  const causas = [];
  while (true) {
    const filas = page.locator('table tbody tr, [role="row"]').filter({ hasText: /\d{2,}-\d+/ });
    const count = await filas.count();
    for (let i = 0; i < count; i++) {
      const fila = filas.nth(i);
      const celdas = await fila.locator('td, [role="cell"]').allInnerTexts();
      if (celdas.length < 5) continue;
      const [expediente, caratula, fechaInicio, ultimaActualizacion, radicacion] = celdas;
      if (!expediente?.trim()) continue;
      causas.push({
        expediente: expediente.trim(),
        caratula: caratula.trim(),
        fecha_inicio: fechaInicio.trim(),
        ultima_actualizacion: ultimaActualizacion.trim(),
        radicacion: radicacion.trim(),
      });
    }

    const siguiente = page.getByRole('button', { name: 'Siguiente' }).first();
    const disabled = await siguiente.isDisabled().catch(() => true);
    if (disabled) break;
    await siguiente.click();
    await page.waitForTimeout(1500);
  }

  return causas;
}

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

async function enviarEmail({ nuevas, actualizadas }) {
  if (!process.env.SMTP_HOST) {
    console.log('SMTP no configurado, salteo el envio de email. Cambios detectados:', { nuevas, actualizadas });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const lineas = [];
  if (nuevas.length) {
    lineas.push(`EXPEDIENTES NUEVOS (${nuevas.length}):`);
    for (const c of nuevas) {
      lineas.push(`  - ${c.expediente} — ${c.caratula} — ${c.radicacion}`);
    }
    lineas.push('');
  }
  if (actualizadas.length) {
    lineas.push(`EXPEDIENTES CON NOVEDADES (${actualizadas.length}):`);
    for (const { actual, antes } of actualizadas) {
      lineas.push(`  - ${actual.expediente} — ${actual.caratula} — actualizado ${antes} -> ${actual.ultima_actualizacion}`);
    }
  }

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL,
    subject: `Vigia SISFE: ${nuevas.length} nueva(s), ${actualizadas.length} con novedad(es)`,
    text: lineas.join('\n'),
  });

  console.log('Email de aviso enviado.');
}

async function main() {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });

  let previas = [];
  try {
    previas = JSON.parse(await readFile(STATE_PATH, 'utf8')).causas ?? [];
  } catch {
    console.log('No hay estado previo, arranco de cero.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await login(page);
    const causas = await buscar(page);
    console.log(`Encontre ${causas.length} expediente(s) vinculado(s) a la matricula.`);

    const cambios = diff(previas, causas);
    const huboCambios = cambios.nuevas.length > 0 || cambios.actualizadas.length > 0;

    if (huboCambios && previas.length > 0) {
      // Solo avisamos si ya habia un estado previo: la primera corrida
      // solo siembra el snapshot inicial, no dispara alertas.
      await enviarEmail(cambios);
    } else if (huboCambios) {
      console.log('Primera corrida: siembro el snapshot inicial sin avisar por email.');
    } else {
      console.log('Sin novedades.');
    }

    await writeFile(
      STATE_PATH,
      JSON.stringify({ actualizado: new Date().toISOString(), causas }, null, 2)
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
