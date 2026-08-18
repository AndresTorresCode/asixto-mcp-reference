import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Los SEIS tipos de error canónicos del contrato de Asixto. No hay más:
 * cualquier otro valor se trata como `UNKNOWN`.
 *
 * Contrato: https://gateway.asixto.com/docs/06-errors
 */
export const ERROR_TYPES = ['BLOCKER', 'NOT_FOUND', 'VALIDATION', 'PERMISSION', 'SYSTEM', 'UNKNOWN'] as const;

export type AsixtoErrorType = (typeof ERROR_TYPES)[number];

/**
 * Construye un fallo de negocio. Ojo: **no** es un error de transporte. Se devuelve como
 * resultado de la herramienta, con `isError` para que el consumidor lo distinga de un éxito.
 *
 * @param errorType Uno de los seis canónicos. Determina la reacción del agente.
 * @param userMessage Frase corta, en español neutro, que el agente puede leer en voz alta.
 * @param details Detalle técnico OPCIONAL para su propia traza. Asixto no lo consume.
 */
export function fallo(errorType: AsixtoErrorType, userMessage: string, details?: string): CallToolResult {
  const payload = { error: { error_type: errorType, user_message: userMessage, ...(details ? { details } : {}) } };

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

/** Éxito con datos estructurados. `content` es lo que el modelo lee; manténgalo corto. */
export function exito(datos: Record<string, unknown>, resumen?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: resumen ?? JSON.stringify(datos) }],
    structuredContent: datos,
  };
}

/**
 * Búsqueda sin resultados. **Es un éxito, no un error.**
 *
 * Es el fallo de integración más frecuente: si lo devuelve como error, el agente entra en la
 * rama de fallo técnico y se disculpa por un problema que no existe, en vez de decirle al
 * cliente con naturalidad que no encontró nada.
 */
export function sinResultados(campo = 'resultados'): CallToolResult {
  return exito({ [campo]: [], total: 0 }, 'Sin resultados.');
}
