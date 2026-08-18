<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/asixto-gateway-dark.svg">
    <img src="./assets/asixto-gateway.svg" alt="Asixto Gateway" width="320">
  </picture>
</p>

<h1 align="center">Servidor MCP de referencia · Asixto Gateway</h1>

<p align="center">
  <a href="https://modelcontextprotocol.io/specification/2026-07-28"><img alt="MCP 2026-07-28" src="https://img.shields.io/badge/MCP-2026--07--28-302f80"></a>
  <a href="./LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-35b6ea"></a>
  <img alt="Node 20 o superior" src="https://img.shields.io/badge/node-%E2%89%A520-302f80">
</p>

Implementación mínima y **ejecutable** del contrato que debe cumplir su servidor para que los
agentes de IA de Asixto puedan leer y escribir en sus
sistemas.

No es pseudocódigo: arranca, responde y pasa la verificación de conformidad tal cual está.

- Contrato completo: **https://gateway.asixto.com/docs**
- Protocolo: [Model Context Protocol](https://modelcontextprotocol.io), revisión `2026-07-28`
  (Streamable HTTP, sin estado)

## Arranque en tres comandos

```bash
npm install
npm start                 # http://localhost:8080/mcp  ·  salud en /salud
npm run conformance -- http://localhost:8080/mcp
```

Con autenticación (como en producción):

```bash
ASIXTO_TOKENS=un-token-largo-y-aleatorio npm start
npm run conformance -- http://localhost:8080/mcp un-token-largo-y-aleatorio
```

La verificación debe terminar en **0 bloqueantes**. Ese es el criterio de aceptación.

## Qué hay que cambiar

Una sola cosa: **`src/sistema-propio.ts`**. Es la simulación de su backend; ahí van las llamadas
a su API, su ERP o su base de datos.

El resto ya cumple el contrato y normalmente no se toca:

| Archivo | Qué resuelve |
|---|---|
| `src/server.ts` | Endpoint POST sin estado, autenticación y ensamblaje |
| `src/auth.ts` | Verificación del bearer y el `401` con `WWW-Authenticate` |
| `src/asixto/meta.ts` | Lectura tipada de los metadatos que envía el Gateway |
| `src/asixto/errors.ts` | Los seis `error_type` canónicos y el «sin resultados es éxito» |
| `src/asixto/idempotency.ts` | Idempotencia por clave (garantía 1) |
| `scripts/conformance.mjs` | Verificación local. Úsela en su pipeline |

## Las tres herramientas de ejemplo

Están en el orden en que conviene construir las suyas:

| Herramienta | Verbo | Qué demuestra |
|---|---|---|
| `consultar_cliente` | **R** | Núcleo obligatorio. Riesgo nulo: no escribe |
| `buscar_items` | **R** | Paginación, precio resuelto con la lista del `_meta`, sin resultados como éxito |
| `abrir_caso_soporte` | **C** | Idempotencia, propiedad del registro y radicado en la respuesta |
| `actualizar_cliente` | **U** | Campos permitidos únicamente, y devolver **qué** quedó actualizado |
| `cancelar_cita` | **D** | `destructiveHint`, propiedad, estado terminal y el orden correcto de las guardas |

> El contrato es de lectura **y** escritura. La única operación de tipo borrado es cancelar: no hay
> borrado duro de clientes, productos ni oportunidades.

## Cuatro cosas que se aprenden aquí y no en un blog

Las cuatro están medidas contra el SDK `2.0.0`:

1. **Use la entrada HTTP moderna** (`createMcpHandler` + `toNodeHandler`). Una instancia
   construida a mano con el transporte responde **`-32601 Method not found`** a
   `server/discover`, que el contrato exige. Ver el comentario en `src/server.ts`.
2. **Pásele el cuerpo ya parseado** al adaptador (`nodeHandler(req, res, req.body)`). Montado
   como middleware directo, Express le pasa `next` como tercer argumento y el resultado es
   «Parse error: Invalid JSON».
3. **`z.strictObject`, no `z.object`.** Solo el primero emite `additionalProperties: false` en el
   esquema, que es una comprobación bloqueante.
4. **Todo opcional admite `null`.** Con zod es `.nullable()`, y produce
   `anyOf: [{type}, {type:"null"}]`. Si un opcional queda con tipo estricto, el día que el modelo
   mande `null` el proveedor devuelve 400 y **el agente se queda sin responder a mitad de la
   conversación**.

## Producción

Este ejemplo tiene dos atajos deliberados, marcados en el código:

- La idempotencia vive **en memoria** (`src/asixto/idempotency.ts`). Use Redis con `SET NX` o un
  índice único, escritura atómica y TTL ≥ 7 días.
- La autenticación es un **token estático** (nivel 2 del contrato). El nivel recomendado es
  OAuth 2.1 con credenciales de cliente y metadatos de recurso protegido (RFC 9728); la interfaz
  del verificador es la misma.

## Licencia

MIT. Cópielo, adáptelo y quédeselo: es su servidor.
