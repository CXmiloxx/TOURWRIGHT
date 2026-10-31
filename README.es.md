# Tourwright

**Recorridos guiados y narrados, a partir de un guion.** Escribes lo que pasa en pantalla y lo que se dice;
Tourwright graba un navegador de verdad (o arma diapositivas), lleva la mirada a cada elemento, sintetiza la
voz y entrega un `.mp4` con subtítulos, capítulos y miniatura. Hecho para personas *y* para agentes de IA, en cualquier servidor: de un portátil a un clúster.

*[Read in English](README.md)*

```yaml
# recorrido.yaml
title: Tu primera factura
voice: salome
baseUrl: https://app.ejemplo.com
steps:
  - goto: /facturas/nueva
  - title: { text: Tu primera factura, subtitle: Paso a paso }
  - say: Primero eliges el <b>cliente</b>.
  - click: { role: combobox, name: Cliente }
  - say: Después guardas. Eso es todo.
  - click: { role: button, name: Guardar }
```

```bash
tourwright render recorrido.yaml   # → videos/recorrido.mp4 (+ .srt .vtt .jpg .json)
```

## Qué hace

- **Recorridos por un sitio web**: Chromium real, cursor animado y suave, onda en cada clic, marcos, foco,
  globos que señalan, acercamientos de cámara, arrastrar y soltar, datos personales desenfocados, carteles y
  subtítulos con tus colores y tu logo.
- **Foco guiado**: el recorrido que muestra una app la primera vez que entras. Todo se oscurece menos el
  elemento, un anillo lo marca, un globo con un contador `2/4` lo explica y la cámara se acerca, justo en la
  palabra que está diciendo la voz.
- **Diapositivas narradas**: carteles, imágenes (con paneo o zoom lento), HTML, fundidos. Sin sitio web.
- **La voz que quieras**: [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) (sin internet, abierta y natural:
  `tourwright install --pocket`), [Piper](https://github.com/rhasspy/piper) (sin internet, open source, ligera),
  voces neuronales de Microsoft Edge, cualquier servidor TTS compatible con OpenAI (OpenAI,
  Kokoro, LocalAI…) o tu propio comando. Cada oración queda en caché: volver a grabar no la pide otra vez.
- **Un reparto, y cómo se dice cada frase**: varias voces por video; velocidad, tono y volumen por frase en
  cualquier motor; pausas exactas (`[[1s]]`); diccionario de pronunciación; perfiles de sonido (cálido,
  radio, pódcast…); sonidos de clic, tecleo y otros efectos; música con fundidos.
- **Guiones que crecen contigo**: variables (`{{nombre}}`, también desde la CLI o la API), bloques
  reutilizables, repeticiones, condiciones y pasos que pueden fallar. Un guion, muchos videos.
- **Plugins**: acciones, motores de voz y voces nuevas como módulos pequeños ([docs/PLUGINS.md](docs/PLUGINS.md)).
- **Edición automática**: se recortan las cargas, las esperas largas y lo que tarda la voz; una narración
  nunca pisa a otra; la música de fondo baja sola cuando alguien habla.
- **Entregables**: `.mp4` H.264/AAC con subtítulos y capítulos, `.srt`, `.vtt`, miniatura y un manifiesto
  JSON (duración, capítulos, subtítulos) para automatizar.
- **Cuatro entradas**: CLI, API HTTP con cola y webhooks, servidor MCP para agentes, librería de Node.
- **Escala horizontal**: API sin estado con réplicas, tantos workers como servidores tengas, cola en
  Redis/BullMQ y archivos en cualquier S3. O un solo proceso con una carpeta, hasta en una Raspberry Pi.

## Instalar

### Docker (recomendado)

```bash
docker run --rm -v "$PWD:/work" -w /work ghcr.io/cxmiloxx/tourwright render examples/slides.yaml --out videos/
```

El servicio completo (API + 2 workers + Redis):

```bash
cp .env.example .env    # pon TOURWRIGHT_API_TOKENS
docker compose up -d --build
docker compose up -d --scale worker=6
```

### Desde npm (lo más rápido para probar)

Con Node.js 20 o superior, en Linux, macOS o Windows:

```bash
npm install -g tourwright
tourwright install                    # ffmpeg, Piper y voces, edge-tts, Chromium (sin root)
tourwright install --pocket           # + Pocket TTS: voces naturales sin internet (cerca de 1 GB)
tourwright clean                      # cuánto ocupa cada parte; borra descargas y sobrantes
tourwright doctor                     # qué funciona en esta máquina
```

Sin instalar nada global: `npx tourwright <comando>`.

### Sin Docker (Linux, macOS, Windows)

Con Node.js 20 o superior. `tourwright install` deja ffmpeg, Piper, voces, edge-tts y Chromium en
`TOURWRIGHT_HOME`, sin permisos de root ni de administrador; lo que el sistema ya tiene se respeta.

```bash
git clone https://github.com/CXmiloxx/tourwright && cd tourwright
./scripts/install.sh           # Linux / macOS (Windows: powershell -ExecutionPolicy Bypass -File scripts\install.ps1)
node bin/tourwright.js doctor  # qué funciona en esta máquina
npm link                       # opcional: el comando `tourwright`
```

| | Linux (x64, arm64) | macOS | Windows 10/11 |
|---|---|---|---|
| ffmpeg | se descarga | `brew install ffmpeg` | se descarga |
| Piper (voces sin internet) | se descarga | se descarga (`piper-tts`) | se descarga |
| edge-tts (voces de Microsoft) | se descarga | se descarga | se descarga |
| Captura | `screen` con Xvfb (la más nítida); si no, `screencast` | `screencast` | `screencast` |

No se instala nada en el sistema: todo queda en una sola carpeta (`TOURWRIGHT_HOME`), y los paquetes de
Python corren en un entorno virtual con su propio Python, así que no necesitas tener Python y el tuyo nunca se
toca. Para desinstalar, borra esa carpeta.

Con `Xvfb` (`apt install xvfb`, solo Linux) la captura es la más nítida; sin él, Tourwright graba sin pantalla
(screencast), que funciona donde corra Chromium. Los clientes de la API HTTP o de MCP pueden estar en
cualquier sistema.

## Usar

De un sitio a un video, sin buscar selectores a mano:

```bash
tourwright explore https://app.ejemplo.com/login --draft app.yaml   # pide el login y escribe el guion
tourwright render app.yaml --dry-run                               # prueba cada paso en segundos
tourwright render app.yaml --open                                  # el video, en ./videos/app/
```

El borrador recorre cada sección del sitio con una narración tomada de sus páginas; ajústala con tus palabras.
Las credenciales se piden una vez, no se muestran y nunca quedan en el guion (`tourwright secret list`;
`tourwright forget` las borra).

```bash
tourwright init video.yaml              # un guion de ejemplo
tourwright validate video.yaml
tourwright render video.yaml --dry-run  # ensayo: corre todo rápido, sin voz ni video (prueba los selectores)
tourwright render video.yaml --quality fullhd --voice gonzalo --out salida/
tourwright voices                       # las voces de este servidor
tourwright install-voice es_ES-sharvard-medium
tourwright say "Hola" --voice claude --out hola.wav
```

El formato del guion, cada acción y las voces: **[docs/SCRIPTS.md](docs/SCRIPTS.md)**.

### API HTTP, agentes (MCP) y librería

Igual que en el [README en inglés](README.md#use-it): `tourwright serve`, `tourwright mcp` y
`import { render } from 'tourwright'`. Detalle en [docs/API.md](docs/API.md) y [docs/AGENTS.md](docs/AGENTS.md).

## Escalar

| Tamaño | Cómo |
|---|---|
| Una máquina | `tourwright serve --worker`: cola en una carpeta, archivos en disco |
| Una máquina grande | `docker compose up --scale worker=N`: cola en Redis, volumen compartido |
| Varias máquinas | Réplicas de la API detrás de un balanceador, workers donde sea, mismo Redis y mismo bucket S3 |
| Kubernetes | [`deploy/kubernetes/tourwright.yaml`](deploy/kubernetes/tourwright.yaml), workers con autoescalado |

Cada worker graba `TOURWRIGHT_CONCURRENCY` videos a la vez (un Chromium y un ffmpeg cada uno: calcula 1–2 CPU
y ~1 GB de RAM por video en 720p). Corren con prioridad baja de CPU y disco, para no ahogar un servidor
compartido. Más en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) y [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Seguridad

Los trabajos de la API corren aislados: guiones solo de datos (sin JavaScript), archivos solo de sus
adjuntos, lista de dominios permitidos y bloqueo de redes privadas opcionales, secretos apagados por
defecto, cada token ve solo sus trabajos y los enlaces de descarga van firmados. Lee
[SECURITY.md](SECURITY.md) antes de abrir la API a clientes en los que no confías del todo.

## Licencia

MIT. Las voces de Piper tienen su propia licencia (ver la ficha de cada modelo); las de Edge son un
servicio en línea de Microsoft: revisa sus términos para tu uso.
