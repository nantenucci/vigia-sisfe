# vigia-sisfe

Vigía automático de causas propias en el SISFE (Autoconsulta Web del Poder
Judicial de Santa Fe). Corre solo, entra con tu usuario de matriculado,
trae la lista de expedientes vinculados a tu matrícula y te avisa por email
si aparece un expediente nuevo o si alguno tuvo novedades (cambió su
"última fecha de actualización").

Proyecto independiente de gestor-causas — prueba de concepto para validar
el enfoque antes de integrar nada.

## Cómo funciona

1. GitHub Actions corre `src/check.mjs` con un cron (ver `.github/workflows/vigia.yml`).
2. El script usa Playwright para loguearse en SISFE y traer todas las causas
   vinculadas a la matrícula (sin filtrar por fuero todavía).
3. Compara contra `data/state.json` (el snapshot de la corrida anterior).
4. Si hay diferencias, manda un email. Si no, no hace nada.
5. Guarda el snapshot nuevo y lo comitea al repo.
6. `index.html` (publicado en GitHub Pages) lee `data/state.json` y muestra
   la lista actual — es solo lectura, no dispara el chequeo.

La primera corrida nunca manda email: solo siembra el snapshot inicial
(si avisara en la primera corrida, te llegaría un mail con "N causas nuevas"
listando todo tu historial completo).

## Configuración (secretos de GitHub Actions)

Repo → Settings → Secrets and variables → Actions → New repository secret.
Cargalos vos mismo, yo no los toco:

| Secreto | Qué va |
|---|---|
| `SISFE_MATRICULA` | tu número de matrícula, tal cual lo cargás en SISFE |
| `SISFE_CONTRASENA` | tu contraseña de SISFE |
| `SISFE_CIRCUNSCRIPCION` | `Rosario` (o la que corresponda) |
| `SISFE_COLEGIO` | `Abogados` |
| `NOTIFY_EMAIL` | el email que va a recibir los avisos |
| `SMTP_HOST` | `smtp.gmail.com` si usás Gmail |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | tu Gmail |
| `SMTP_PASS` | una **contraseña de aplicación** de Gmail (no tu contraseña normal) |

### Cómo generar la contraseña de aplicación de Gmail

1. Activá verificación en 2 pasos en tu cuenta de Google (si no la tenés).
2. Andá a https://myaccount.google.com/apppasswords
3. Creá una nueva, nombre "vigia-sisfe", copiá el código de 16 letras.
4. Usá eso como `SMTP_PASS` (no tu contraseña de Gmail real).

## Probar en local

```bash
npm install
npx playwright install chromium
SISFE_MATRICULA=... SISFE_CONTRASENA=... SISFE_CIRCUNSCRIPCION=Rosario npm run check
```

Sin `SMTP_HOST` configurado, el script no manda email — solo imprime en
consola qué habría avisado. Útil para probar el scraping antes de meter el
email en el medio.

## Correr manualmente en GitHub

Actions → "Vigia SISFE" → "Run workflow" (no hace falta esperar al cron).

## Pendiente / próximos pasos

- Validar el pipeline completo corriendo unas semanas.
- Ver si el volumen de expedientes ruidosos (archivados, sin movimiento real)
  amerita agregar el filtro de fuero civil.
- Recién después: decidir si esto se integra a gestor-causas o queda aparte
  como producto propio para otros abogados (eso implica resolver cómo
  guardar credenciales de terceros — no es este alcance).
