import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Idempotencia de escrituras (garantía 1 del contrato).
 *
 * El Gateway envía `com.asixto/idempotencyKey` en el `_meta`. Si la misma clave llega dos
 * veces, su servidor DEBE devolver el mismo resultado sin volver a ejecutar el efecto.
 *
 * Hay dos causas reales de repetición, no hipótesis:
 *   1. El modelo puede emitir la misma llamada dos veces en un turno.
 *   2. El transporte no reanuda flujos cortados: una respuesta interrumpida se reintenta
 *      como petición nueva.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * EL ORDEN IMPORTA, Y ES CONTRAINTUITIVO
 *
 * La consulta de la clave va **antes** de las guardas de propiedad y de estado terminal. Si
 * va después, ocurre esto:
 *
 *   1er intento  → cancela la cita → éxito
 *   2º  intento  → la guarda ve «ya cancelada» → VALIDATION
 *
 * ...y el agente le dice al cliente que su cancelación falló, cuando en realidad funcionó.
 * El estado cambió por NUESTRA primera ejecución, así que no es una transición inválida: es
 * el mismo trabajo pedido dos veces.
 *
 * Se guardan **solo los éxitos**. Un fallo transitorio debe poder reintentarse.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * ESTA IMPLEMENTACIÓN ES DE EJEMPLO: vive en memoria y se pierde al reiniciar. En producción
 * use Redis (`SET NX` + TTL) o un índice único, con escritura ATÓMICA (nunca `get` seguido de
 * `set` sin transacción) y TTL ≥ 7 días.
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const almacen = new Map<string, { valor: CallToolResult; expiraEn: number }>();

/** Resultado ya entregado para esa clave, si lo hay. Se consulta ANTES de cualquier guarda. */
export function resultadoPrevio(clave: string | undefined): CallToolResult | null {
  if (!clave) return null;

  const entrada = almacen.get(clave);
  if (!entrada) return null;

  if (entrada.expiraEn <= Date.now()) {
    almacen.delete(clave);
    return null;
  }

  return entrada.valor;
}

/** Registra el resultado de una operación que SÍ se ejecutó. Solo éxitos. */
export function recordarResultado(clave: string | undefined, resultado: CallToolResult): CallToolResult {
  if (clave && !resultado.isError) {
    almacen.set(clave, { valor: resultado, expiraEn: Date.now() + TTL_MS });
  }

  return resultado;
}
