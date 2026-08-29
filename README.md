# vigia-sisfe

Vigía automático de causas propias en el SISFE (Autoconsulta Web del Poder
Judicial de Santa Fe). Corre solo en la PC del estudio, trae la lista de
expedientes vinculados a tu matrícula y te avisa por email si aparece un
expediente nuevo o si alguno tuvo novedades (cambió su "última fecha de
actualización").

Proyecto independiente de gestor-causas — prueba de concepto para validar
el enfoque antes de integrar nada.

## Por qué corre en tu PC y no en la nube

Probamos primero con los runners normales de GitHub Actions (en la nube) y
el sitio de SISFE bloquea esas IPs a nivel de red — ni siquiera abren
conexión. Por eso corre en un runner instalado en tu propia PC, que sale a
internet con tu IP real.

## Por qué el login es manual

El login de SISFE exige resolver un reCAPTCHA. Eso no se puede automatizar
de forma confiable (y no es algo que vaya a intentar burlar). En cambio:

1. Vos te logueás **una vez** en un navegador real con `npm run login`
   (resolvés el captcha a mano, como siempre).
2. Eso guarda la sesión (cookies) en `~/.vigia-sisfe/session.json`.
3. Cada chequeo automático reutiliza esa sesión — sin login, sin captcha.
4. Cuando la sesión venza, el chequeo te va a avisar por email para que
   corras `npm run login` de nuevo. No sabemos todavía cuánto dura una
   sesión — lo vamos a ver con el uso real.

## Dónde vive cada dato (y por qué)

Los expedientes tienen carátulas con nombres reales de clientes y
contrapartes — incluye causas penales sensibles. Por eso:

- `~/.vigia-sisfe/session.json` (cookies de sesión) y
  `~/.vigia-sisfe/state.json` (snapshot de causas) viven **fuera del
  repo**, solo en el disco de la PC que corre el chequeo. Nunca se suben a
  git, nunca pasan por GitHub.
- No hay GitHub Pages ni nada publicado a internet. Para ver la lista con
  una interfaz (buscador, link directo a cada expediente) hay un
  **dashboard local**: `npm run dashboard` levanta un servidor que solo
  escucha en `127.0.0.1` (tu propia PC) y abrís `http://localhost:5173`
  en tu navegador. Nadie más puede entrar ahí, ni siquiera en tu misma red.
- Además llega un email cada vez que hay novedades, con link directo a
  cada expediente nuevo o actualizado.
- El repo en sí (código) es público, como tus otras apps, pero no contiene
  ni va a contener nunca datos de causas.

## Cómo funciona

1. GitHub Actions corre `src/check.mjs` en tu runner con un cron (ver
   `.github/workflows/vigia.yml`).
2. El script reusa la sesión guardada, entra a `/buscar-expediente` y trae
   todas las causas vinculadas a tu matrícula (sin filtrar por fuero
   todavía).
3. Compara contra el snapshot de la corrida anterior.
4. Si hay diferencias, manda un email. Si no, no hace nada.
5. Guarda el snapshot nuevo (local, no en git).

La primera corrida nunca manda email: solo siembra el snapshot inicial
(si avisara en la primera corrida, te llegaría un mail con "N causas
nuevas" listando todo tu historial completo).

## Configuración inicial

### 1. Loguearte una vez

```bash
npm install
npx playwright install chromium
npm run login
```

Se abre una ventana de Chrome. Logueate normal (Matriculados → tu
circunscripción/colegio/matrícula/contraseña → captcha → Ingresar). El
script espera hasta que llegues a la pantalla de expedientes y guarda la
sesión.

### 2. Secretos de GitHub Actions (solo el email)

Repo → Settings → Secrets and variables → Actions → New repository secret.
Cargalos vos mismo, yo no los toco:

| Secreto | Qué va |
|---|---|
| `NOTIFY_EMAIL` | el email que va a recibir los avisos |
| `SMTP_HOST` | `smtp.gmail.com` si usás Gmail |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | tu Gmail |
| `SMTP_PASS` | una **contraseña de aplicación** de Gmail (no tu contraseña normal) |

#### Cómo generar la contraseña de aplicación de Gmail

1. Activá verificación en 2 pasos en tu cuenta de Google (si no la tenés).
2. Andá a https://myaccount.google.com/apppasswords
3. Creá una nueva, nombre "vigia-sisfe", copiá el código de 16 letras.
4. Usá eso como `SMTP_PASS` (no tu contraseña de Gmail real).

## Probar en local

```bash
npm run check
```

Sin `SMTP_HOST` configurado, el script no manda email — solo imprime en
consola qué habría avisado.

## Correr manualmente en GitHub

Actions → "Vigia SISFE" → "Run workflow" (no hace falta esperar al cron).
El runner self-hosted (`pc-nestor`) tiene que estar corriendo
(`.\run.cmd` en `C:\actions-runner-vigia-sisfe`) para que lo tome.

## Pendiente / próximos pasos

- Validar el pipeline completo corriendo unas semanas: ¿cuánto dura la
  sesión antes de pedir login de nuevo?
- Ver si el volumen de expedientes ruidosos (archivados, sin movimiento
  real) amerita agregar el filtro de fuero civil.
- Instalar el runner como servicio de Windows real (ahora depende de que
  la ventana de `run.cmd` quede abierta).
- Recién después: decidir si esto se integra a gestor-causas o queda
  aparte como producto propio para otros abogados (eso implica resolver
  cómo pedirles el login manual a terceros — no es este alcance).
