import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { exito, sinResultados } from '../asixto/errors.ts';
import { asixtoMeta, esVoz, topeDeResultados } from '../asixto/meta.ts';
import { sistemaPropio } from '../sistema-propio.ts';

/**
 * NIVEL 1 · Catálogo con paginación y precio resuelto.
 *
 * Muestra tres cosas del contrato que se pasan por alto:
 *   1. `limit` es OPCIONAL y por eso admite `null`: si declarara `"type": "integer"` a secas,
 *      el día que el modelo mande `null` el proveedor devuelve 400 y el agente se queda sin
 *      responder a mitad de la conversación.
 *   2. El precio sale de la lista que envía el Gateway en `_meta`, no del precio por defecto.
 *   3. Sin resultados es un ÉXITO con lista vacía, nunca un error.
 */
export function registrarBuscarItems(server: McpServer): void {
  server.registerTool(
    'buscar_items',
    {
      title: 'Buscar en el catálogo',
      description:
        'Busca productos o servicios por texto y devuelve nombre, precio final y disponibilidad. ' +
        'Úsala cuando el cliente pregunta qué hay, cuánto cuesta o si algo está disponible.',
      inputSchema: z.strictObject({
        texto: z.string().min(2).max(80).describe('Qué busca el cliente, en sus palabras'),
        limit: z.number().int().min(1).max(25).nullable().optional().describe('Máximo de resultados'),
        offset: z.number().int().min(0).nullable().optional().describe('Desplazamiento para paginar'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: {
        'com.asixto/capabilities': [
          'informacion_productos',
          'informacion_servicios',
          'ventas',
          'cambio_plan',
          'renovacion',
          'reactivacion',
        ],
        'com.asixto/verb': 'consultar el catálogo de productos y servicios',
      },
    },
    async ({ texto, limit, offset }, ctx) => {
      const meta = asixtoMeta(ctx);
      const tope = topeDeResultados(meta, limit);
      const desde = offset ?? 0;

      const todos = await sistemaPropio.buscarItems(texto, meta.priceListId ?? null);
      if (todos.length === 0) return sinResultados();

      const pagina = todos.slice(desde, desde + tope).map((item) => ({
        id: item.id,
        nombre: item.nombre,
        // Precio final ya resuelto y con moneda: el agente lo dice tal cual, no calcula.
        precio_final: item.precio,
        moneda: meta.currency ?? 'COP',
        disponible: item.disponible,
        unidad: item.unidad,
      }));

      const resumen = esVoz(meta)
        ? pagina.map((i) => `${i.nombre} por ${i.precio_final} ${i.moneda} al ${i.unidad}`).join('; ')
        : `${todos.length} resultado(s).`;

      return exito({ resultados: pagina, total: todos.length, limit: tope, offset: desde }, resumen);
    }
  );
}
