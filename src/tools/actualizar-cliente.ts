import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { exito, fallo } from '../asixto/errors.ts';
import { asixtoMeta } from '../asixto/meta.ts';
import { recordarResultado, resultadoPrevio } from '../asixto/idempotency.ts';
import { sistemaPropio } from '../sistema-propio.ts';

/**
 * ESCRITURA · UPDATE. El caso más frecuente y el más fácil de hacer mal.
 *
 * Dos cosas que este handler demuestra y que la certificación verifica:
 *
 *   · **Campos permitidos, no «actualiza lo que te manden».** El esquema solo expone lo que el
 *     titular puede cambiar de sí mismo. Un `estado` o un `saldo` no se exponen jamás: el agente
 *     no tiene por qué poder tocarlos, y si no están en el esquema el modelo no los inventa.
 *   · **Devolver QUÉ quedó actualizado.** El agente le confirma al cliente solo lo que usted
 *     confirme. Si devuelve un `ok: true` genérico, el agente improvisa la confirmación.
 */
export function registrarActualizarCliente(server: McpServer): void {
  server.registerTool(
    'actualizar_cliente',
    {
      title: 'Actualizar datos del cliente',
      description:
        'Actualiza el teléfono o el correo de un cliente identificado. Úsala cuando el cliente pide ' +
        'corregir sus datos de contacto. No la uses para cambiar su estado ni su plan.',
      inputSchema: z.strictObject({
        documento: z.string().min(5).max(20),
        telefono: z.string().min(7).max(20).nullable().optional(),
        correo: z.string().max(120).nullable().optional(),
      }),
      outputSchema: z.strictObject({
        actualizados: z.array(z.string()).describe('Campos que quedaron efectivamente guardados'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: {
        'com.asixto/capabilities': ['actualizacion_datos', 'notificaciones'],
        'com.asixto/verb': 'actualizar los datos de contacto del cliente',
      },
    },
    async ({ documento, telefono, correo }, ctx) => {
      const meta = asixtoMeta(ctx);

      const previo = resultadoPrevio(meta.idempotencyKey);
      if (previo) return previo;

      const cliente = await sistemaPropio.buscarCliente(documento);
      if (!cliente) return fallo('NOT_FOUND', 'No encontré un cliente con ese documento.');

      // Garantía 4 · validación en NUESTRO lado: el formato lo decide el sistema, no el modelo.
      if (correo && !correo.includes('@')) {
        return fallo('VALIDATION', 'Ese correo no parece válido, ¿me lo repite?');
      }
      if (!telefono && !correo) {
        return fallo('VALIDATION', 'Necesito el dato nuevo: teléfono o correo.');
      }

      const actualizados = await sistemaPropio.actualizarCliente(documento, { telefono, correo });

      return recordarResultado(meta.idempotencyKey, exito({ actualizados }, `Actualicé: ${actualizados.join(' y ')}.`));
    }
  );
}
