import type { ServerContext } from '@modelcontextprotocol/server';

/**
 * Metadatos que el Gateway de Asixto envía en el `_meta` de cada `tools/call`.
 *
 * Van en `_meta` y NO en los argumentos, así que su `inputSchema` puede seguir cerrado
 * (`additionalProperties: false`) sin rechazarlos.
 *
 * Contrato: https://asixto.com/docs/02-tool-contract
 */
export type AsixtoMeta = {
  /** Clave determinista por operación lógica. Obligatoria de honrar en toda escritura. */
  idempotencyKey?: string;
  /** Conversación en curso. Dos conversaciones distintas nunca comparten clave. */
  conversationId?: string;
  /** Correlación de traza: regístrelo en sus logs. */
  requestId?: string;
  /** `chat` o `voice`. En voz la respuesta se lee en voz alta. */
  channel?: 'chat' | 'voice';
  /** Empresa del tenant (relevante si sirve varias marcas). */
  companyId?: string;
  /** Lista de precios vigente. Si su catálogo tiene varias, el precio sale de esta. */
  priceListId?: string | null;
  /** Moneda del tenant en ISO 4217. */
  currency?: string;
  /** Zona horaria del tenant, p. ej. `America/Bogota`. */
  timezone?: string;
};

const KEY = 'com.asixto/';

/**
 * Lee los metadatos de Asixto del contexto del handler.
 *
 * El SDK expone el `_meta` de la petición en `ctx.mcpReq._meta` (las claves reservadas
 * `io.modelcontextprotocol/*` ya vienen separadas en `ctx.mcpReq.envelope`).
 */
export function asixtoMeta(ctx: ServerContext): AsixtoMeta {
  const raw = (ctx.mcpReq._meta ?? {}) as Record<string, unknown>;
  const read = (name: string): string | undefined => {
    const value = raw[`${KEY}${name}`];
    return typeof value === 'string' ? value : undefined;
  };

  const channel = read('channel');

  return {
    idempotencyKey: read('idempotencyKey'),
    conversationId: read('conversationId'),
    requestId: read('requestId'),
    channel: channel === 'voice' || channel === 'chat' ? channel : undefined,
    companyId: read('companyId'),
    priceListId: read('priceListId') ?? null,
    currency: read('currency'),
    timezone: read('timezone'),
  };
}

/** ¿La respuesta se va a leer en voz alta? Cambia el formato, no los datos. */
export const esVoz = (meta: AsixtoMeta): boolean => meta.channel === 'voice';

/**
 * Tope de elementos según el canal. En voz el agente solo verbaliza 3.
 * En chat respete el `limit` que reciba (hasta 25) y use 10 si no viene.
 */
export function topeDeResultados(meta: AsixtoMeta, limitPedido?: number | null): number {
  if (esVoz(meta)) return 3;
  if (typeof limitPedido === 'number' && limitPedido > 0) return Math.min(limitPedido, 25);
  return 10;
}
