import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { registrarConsultarCliente } from './tools/consultar-cliente.ts';
import { registrarBuscarItems } from './tools/buscar-items.ts';
import { registrarAbrirCaso } from './tools/abrir-caso.ts';
import { registrarActualizarCliente } from './tools/actualizar-cliente.ts';
import { registrarCancelarCita } from './tools/cancelar-cita.ts';
import { verificadorDeTokens } from './auth.ts';

/**
 * Servidor MCP de referencia para Asixto Gateway.
 *
 * Un endpoint POST sin estado, autenticación por bearer y cinco herramientas de ejemplo: dos de
 * lectura, dos de escritura con idempotencia y la única operación de tipo borrado del contrato
 * (cancelar una cita, con `destructiveHint`).
 *
 * Contrato completo: https://gateway.asixto.com/docs
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `createMcpHandler` + `toNodeHandler` Y NO EL TRANSPORTE A MANO
 *
 * Medido con el SDK 2.0.0: una instancia construida a mano
 * (`new McpServer(...)` + `NodeStreamableHTTPServerTransport`) responde **-32601 Method
 * not found** a `server/discover`, porque ese handler solo lo instala la entrada HTTP
 * moderna al marcar la instancia como servidora de la revisión 2026-07-28.
 *
 * Como el contrato de Asixto exige `server/discover`, este es el camino correcto. Si
 * copia un ejemplo de blog con el transporte a mano, su servidor no pasará la
 * certificación por un detalle que no está en su código.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

const PORT = Number(process.env.PORT ?? 8080);
const TOKENS = (process.env.ASIXTO_TOKENS ?? '').split(',').map((token) => token.trim());
const AUTH_ACTIVA = TOKENS.some(Boolean);

/** Una instancia por petición: el protocolo es sin estado y así escala en serverless. */
function construirServidor(): McpServer {
  const server = new McpServer({ name: 'asixto-mcp-reference', version: '1.0.0' });

  // Lectura (R)
  registrarConsultarCliente(server);
  registrarBuscarItems(server);
  // Escritura: crear (C), actualizar (U) y cancelar, la única «D» del contrato
  registrarAbrirCaso(server);
  registrarActualizarCliente(server);
  registrarCancelarCita(server);

  return server;
}

const app = createMcpExpressApp();
const handler = createMcpHandler(() => construirServidor());

// Sin `ASIXTO_TOKENS` el servidor arranca abierto: cómodo para el primer arranque y para el
// Inspector. NUNCA en producción: la certificación de Asixto exige 401 sin credencial.
if (AUTH_ACTIVA) {
  app.use('/mcp', requireBearerAuth({ verifier: verificadorDeTokens(TOKENS), requiredScopes: ['mcp:tools'] }));
} else {
  console.warn('⚠️  ASIXTO_TOKENS vacío: /mcp queda SIN autenticación. Solo para desarrollo.');
}

const nodeHandler = toNodeHandler(handler, { onerror: (error) => console.error('MCP:', error.message) });

// `createMcpExpressApp` ya parseó el JSON, así que hay que pasarle el cuerpo YA PARSEADO.
// Si se monta como `app.post('/mcp', nodeHandler)`, Express le pasa `next` como tercer
// argumento (que el adaptador ignora) y el stream ya consumido produce
// «Parse error: Invalid JSON». Medido.
app.post('/mcp', (req, res) => {
  void nodeHandler(req, res, req.body);
});

app.get('/salud', (_req, res) => {
  res.json({ estado: 'ok', servidor: 'asixto-mcp-reference', autenticacion: AUTH_ACTIVA });
});

app.listen(PORT, () => {
  console.log(`▲ Servidor MCP en http://localhost:${PORT}/mcp  ·  salud en /salud`);
});
