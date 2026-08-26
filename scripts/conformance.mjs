#!/usr/bin/env node
/**
 * Verificación de conformidad del contrato de Asixto Gateway.
 *
 * Corre contra CUALQUIER servidor MCP, no solo contra este ejemplo: apúntelo a su servidor
 * y úselo en su pipeline antes de cada despliegue.
 *
 *   node scripts/conformance.mjs http://localhost:8099/mcp [token] [--allow-writes]
 *
 * Sale con código 1 si falla una comprobación BLOQUEANTE. Los avisos no rompen el pipeline.
 *
 * SOLO LECTURA POR OMISIÓN. La comprobación de idempotencia (garantía 1) es la única que EJECUTA
 * una herramienta de escritura, y lo hace dos veces con la misma clave. Sin `--allow-writes` no se
 * corre: apuntar esta verificación a un entorno de producción por descuido no puede crear un
 * registro real en el sistema de nadie. Con la bandera, apúntelo a su entorno de pruebas.
 *
 * Consecuencia declarada: sin la bandera, «0 bloqueantes» NO significa que la idempotencia esté
 * verificada, y el veredicto final lo dice con esas palabras.
 *
 * Es el subconjunto que se puede verificar sin conversar con el agente: protocolo, esquemas,
 * clasificación, autenticación, forma del error e idempotencia. La certificación completa
 * (latencia bajo carga, propiedad del registro con datos reales, estados terminales) la corre
 * Asixto contra su entorno de pruebas.
 */

const ARGS = process.argv.slice(2);
/** Ejecutar la herramienta de escritura de la garantía 1. Sin esto, la verificación no muta nada. */
const PERMITE_ESCRITURAS = ARGS.includes('--allow-writes');
const [URL_ARG, TOKEN] = ARGS.filter((argumento) => !argumento.startsWith('--'));
const URL_MCP = URL_ARG ?? 'http://localhost:8099/mcp';

const CAPACIDADES = new Set([
  'actualizacion_datos', 'agenda', 'busqueda_web', 'cambio_plan', 'cancelacion', 'consulta_estado',
  'emergencia', 'encuestas_satisfaccion', 'facturacion', 'felicitacion', 'garantia', 'general',
  'informacion_empresa', 'informacion_productos', 'informacion_servicios', 'lead', 'notificaciones',
  'pqr', 'reactivacion', 'reclamo_calidad', 'renovacion', 'reporte_fraude', 'seguimiento_postventa',
  'solicitud_documentos', 'soporte', 'ventas',
]);

const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'asixto-conformance', version: '1.0.0' },
};

const resultados = [];
const anotar = (nivel, ok, titulo, detalle = '') => resultados.push({ nivel, ok, titulo, detalle });
const bloqueante = (ok, titulo, detalle) => anotar('BLOQUEANTE', ok, titulo, detalle);
const aviso = (ok, titulo, detalle) => anotar('AVISO', ok, titulo, detalle);

async function rpc(method, params = {}, { token = TOKEN, name = '-', legacy = false } = {}) {
  const respuesta = await fetch(URL_MCP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Method': method,
      'Mcp-Name': name,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random().toString(36).slice(2),
      method,
      // En modo legacy NO va el sobre moderno: un servidor de la revisión anterior espera la versión y
      // la identidad del cliente dentro de `params`, que es lo que hacía el saludo de inicialización.
      params: legacy ? { ...params } : { ...params, _meta: { ...ENVELOPE, ...(params._meta ?? {}) } },
    }),
  });

  const texto = await respuesta.text();
  // El transporte puede responder JSON directo o un evento SSE (`data: {...}`).
  const cuerpo = texto.includes('data:') ? texto.slice(texto.indexOf('data:') + 5).trim() : texto.trim();

  let json = null;
  try {
    json = cuerpo ? JSON.parse(cuerpo) : null;
  } catch {
    json = null;
  }

  return { status: respuesta.status, headers: respuesta.headers, json };
}

/** ¿El esquema del parámetro admite `null`? Se aceptan las dos formas idiomáticas. */
function admiteNull(definicion) {
  if (Array.isArray(definicion.type)) return definicion.type.includes('null');
  if (definicion.type === 'null') return true;
  if (Array.isArray(definicion.anyOf)) return definicion.anyOf.some((rama) => rama?.type === 'null');
  if (Array.isArray(definicion.oneOf)) return definicion.oneOf.some((rama) => rama?.type === 'null');
  return false;
}

async function main() {
  console.log(`Verificando ${URL_MCP}\n`);

  // 1 · Autenticación: sin credencial debe ser 401.
  if (TOKEN) {
    const sinCredencial = await rpc('tools/list', {}, { token: null });
    bloqueante(
      sinCredencial.status === 401,
      'Sin credencial responde 401',
      `recibido ${sinCredencial.status}`
    );
    aviso(
      (sinCredencial.headers.get('www-authenticate') ?? '').toLowerCase().includes('bearer'),
      'El 401 incluye la cabecera WWW-Authenticate'
    );
  } else {
    aviso(false, 'Autenticación no verificada', 'no se pasó token: pase uno como segundo argumento');
  }

  // 2 · Descubrimiento y ERA del protocolo.
  //
  // Asixto admite las DOS eras que define la especificación, y por eso esta comprobación no exige la
  // revisión nueva: exige que el servidor sea COHERENTE con una de ellas.
  //
  //   · modern  — `server/discover` anuncia `supportedVersions` con 2026-07-28. Es lo recomendado: la
  //               versión y las capacidades viajan por petición y no hay estado de sesión.
  //   · legacy  — responde al saludo `initialize` con una revisión que soporta (2025-11-25 o anterior).
  //               Se acepta: el Gateway fija la era de su servidor al darlo de alta y le habla en la
  //               que corresponda.
  //
  // Lo que NO se acepta es ninguna de las dos, porque entonces no hay forma de acordar qué se habla.
  // Y ojo con el caso intermedio: un servidor que responde `server/discover` con el CUERPO de
  // `initialize` es legacy, aunque el nombre del método sugiera lo contrario. Por eso se mira el
  // contenido de la respuesta y no que el método exista.
  const discover = await rpc('server/discover');
  const versiones = discover.json?.result?.supportedVersions ?? [];
  const esModerno = Array.isArray(versiones) && versiones.includes('2026-07-28');
  let era = esModerno ? 'modern' : null;
  let revisionLegacy = null;

  if (!esModerno) {
    const saludo = await rpc(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'asixto-conformance', version: '1.0.0' },
      },
      { legacy: true }
    );
    revisionLegacy = saludo.json?.result?.protocolVersion ?? null;
    if (typeof revisionLegacy === 'string' && revisionLegacy.length > 0) era = 'legacy';
  }

  bloqueante(
    era !== null,
    'El servidor declara una era de protocolo coherente (modern o legacy)',
    era === null
      ? `server/discover sin supportedVersions (${JSON.stringify(versiones)}) y sin respuesta a initialize`
      : `era detectada: ${era}${era === 'legacy' ? ` · revisión ${revisionLegacy}` : ''}`
  );
  aviso(
    esModerno,
    'La era es la RECOMENDADA (modern, revisión 2026-07-28)',
    era === 'legacy'
      ? `su servidor sirve la revisión ${revisionLegacy}: compatible, y Asixto registra la era al darlo de alta`
      : ''
  );

  // 3 · Catálogo.
  const lista = await rpc('tools/list');
  const tools = lista.json?.result?.tools ?? [];
  bloqueante(tools.length > 0, 'tools/list devuelve al menos una herramienta', lista.json?.error?.message ?? '');

  const nombres = new Set();

  for (const tool of tools) {
    const etiqueta = `[${tool.name}]`;
    const esquema = tool.inputSchema ?? {};
    const propiedades = esquema.properties ?? {};
    const requeridos = new Set(esquema.required ?? []);
    const meta = tool._meta ?? {};

    bloqueante(!nombres.has(tool.name), `${etiqueta} nombre único`);
    nombres.add(tool.name);

    bloqueante(
      /^[a-z0-9_]{1,40}$/.test(tool.name),
      `${etiqueta} nombre válido (≤40, [a-z0-9_])`,
      `«${tool.name}» (${tool.name.length})`
    );
    bloqueante(esquema.additionalProperties === false, `${etiqueta} inputSchema cerrado`);
    bloqueante(
      typeof tool.description === 'string' && tool.description.length > 0 && tool.description.length <= 700,
      `${etiqueta} description presente y ≤700`,
      `${tool.description?.length ?? 0} caracteres`
    );

    const opcionalesEstrictos = Object.entries(propiedades)
      .filter(([nombre]) => !requeridos.has(nombre))
      .filter(([, definicion]) => !admiteNull(definicion))
      .map(([nombre]) => nombre);

    bloqueante(
      opcionalesEstrictos.length === 0,
      `${etiqueta} todo opcional admite null`,
      opcionalesEstrictos.length ? `sin null: ${opcionalesEstrictos.join(', ')}` : ''
    );

    const capacidades = meta['com.asixto/capabilities'] ?? meta['com.asixto/capability'];
    const listaCapacidades = Array.isArray(capacidades) ? capacidades : capacidades ? [capacidades] : [];
    bloqueante(listaCapacidades.length > 0, `${etiqueta} declara com.asixto/capability`);

    const invalidas = listaCapacidades.filter((clave) => !CAPACIDADES.has(clave));
    bloqueante(invalidas.length === 0, `${etiqueta} claves de escenario válidas`, invalidas.join(', '));

    bloqueante(typeof meta['com.asixto/verb'] === 'string', `${etiqueta} declara com.asixto/verb`);

    const anotaciones = tool.annotations ?? {};
    aviso(
      Object.keys(anotaciones).length > 0,
      `${etiqueta} declara annotations (readOnly/destructive/idempotent)`
    );
  }

  // 4 · Idempotencia: la misma clave dos veces debe producir el mismo resultado.
  const escritura = tools.find((tool) => tool.annotations?.readOnlyHint === false);
  if (escritura && !PERMITE_ESCRITURAS) {
    // No es un fallo del servidor: es esta verificación negándose a escribir sin permiso explícito.
    aviso(
      false,
      'Idempotencia NO verificada (modo solo lectura)',
      `añada --allow-writes para ejercitarla sobre «${escritura.name}», apuntando a su entorno de pruebas`
    );
  } else if (escritura) {
    console.log(`  (idempotencia probada sobre «${escritura.name}»)\n`);
    const clave = `conformance-${Date.now()}`;
    const args = ejemploDeArgumentos(escritura.inputSchema);
    const meta = { 'com.asixto/idempotencyKey': clave, 'com.asixto/conversationId': 'conformance' };

    const primera = await rpc('tools/call', { name: escritura.name, arguments: args, _meta: meta }, { name: escritura.name });
    const segunda = await rpc('tools/call', { name: escritura.name, arguments: args, _meta: meta }, { name: escritura.name });

    const a = JSON.stringify(primera.json?.result?.structuredContent ?? primera.json?.result?.content);
    const b = JSON.stringify(segunda.json?.result?.structuredContent ?? segunda.json?.result?.content);

    bloqueante(Boolean(a) && a === b, 'Idempotencia: misma clave, mismo resultado', a === b ? '' : `${a} ≠ ${b}`);
  } else {
    aviso(false, 'Idempotencia no verificada', 'ninguna herramienta de escritura en el catálogo');
  }

  imprimir(era);
}

/** Argumentos sintéticos a partir del esquema, para poder invocar sin conocer el dominio. */
function ejemploDeArgumentos(esquema) {
  const salida = {};

  for (const nombre of esquema?.required ?? []) {
    const definicion = esquema.properties?.[nombre] ?? {};
    const tipo = Array.isArray(definicion.type) ? definicion.type[0] : definicion.type;

    if (definicion.enum) salida[nombre] = definicion.enum.find((valor) => valor !== null);
    else if (tipo === 'number' || tipo === 'integer') salida[nombre] = definicion.minimum ?? 1;
    else if (tipo === 'boolean') salida[nombre] = false;
    else salida[nombre] = 'X'.repeat(Math.max(definicion.minLength ?? 6, 6));
  }

  return salida;
}

function imprimir(era = null) {
  const fallos = resultados.filter((r) => r.nivel === 'BLOQUEANTE' && !r.ok);
  const avisos = resultados.filter((r) => r.nivel === 'AVISO' && !r.ok);

  for (const r of resultados) {
    const icono = r.ok ? '✓' : r.nivel === 'BLOQUEANTE' ? '✗' : '!';
    console.log(`${icono} ${r.titulo}${r.detalle ? `: ${r.detalle}` : ''}`);
  }

  console.log(
    `\n${resultados.filter((r) => r.ok).length} correctas · ${fallos.length} bloqueantes · ${avisos.length} avisos`
  );
  // La era es el dato que hay que darle a Asixto al registrar el servidor: con ella el Gateway sabe en
  // qué revisión hablarle, en vez de deducirla en caliente.
  if (era) console.log(`Era de protocolo detectada: ${era.toUpperCase()} — decláresela a Asixto al dar de alta el servidor.`);

  if (fallos.length > 0) {
    console.error('\nNo apto para certificación: corrija las bloqueantes.');
    process.exit(1);
  }

  if (!PERMITE_ESCRITURAS) {
    console.log(
      '\nApto para la certificación de Asixto (subconjunto local) — con la IDEMPOTENCIA SIN VERIFICAR.'
    );
    console.log('Repita con --allow-writes contra su entorno de pruebas para cerrar la garantía 1.');
    return;
  }
  console.log('\nApto para la certificación de Asixto (subconjunto local).');
}

main().catch((error) => {
  console.error(`Error ejecutando la verificación: ${error.message}`);
  process.exit(1);
});
