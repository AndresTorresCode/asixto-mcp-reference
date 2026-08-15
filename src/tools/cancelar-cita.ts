import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { exito, fallo } from '../asixto/errors.ts';
import { asixtoMeta } from '../asixto/meta.ts';
import { recordarResultado, resultadoPrevio } from '../asixto/idempotency.ts';
import { sistemaPropio } from '../sistema-propio.ts';

/**
 * ESCRITURA DESTRUCTIVA · la única «D» que contempla el contrato: cancelar, no borrar.
 *
 * `destructiveHint: true` la clasifica en nivel `admin`, así que solo se expone a los agentes
 * que el tenant configure con ese nivel. Pero eso NO es la guarda que cuenta: la confirmación
 * del agente es una instrucción de prompt con ~92% de adherencia medida. Las tres guardas
 * reales viven aquí:
 *
 *   1. **Propiedad** (garantía 2): la cita tiene que ser del contacto de la conversación. Sin
 *      esto, mencionar un identificador plausible basta para cancelar la cita de otro.
 *   2. **Estado terminal** (garantía 3): una cita ya cancelada o ya atendida no se vuelve a tocar.
 *   3. **Idempotencia** (garantía 1): dos intentos con la misma clave = una sola cancelación.
 */
export function registrarCancelarCita(server: McpServer): void {
  server.registerTool(
    'cancelar_cita',
    {
      title: 'Cancelar una cita',
      description:
        'Cancela una cita existente del cliente identificado y libera la franja. Úsala solo cuando ' +
        'el cliente confirma que quiere cancelar. No la uses para reagendar: para eso está la ' +
        'modificación de la cita.',
      inputSchema: z.strictObject({
        documento: z.string().min(5).max(20),
        cita_id: z.string().min(3).max(40).describe('Identificador que el cliente ya vio en la conversación'),
        motivo: z.string().max(200).nullable().optional(),
      }),
      outputSchema: z.strictObject({
        cita_id: z.string(),
        estado: z.literal('cancelada'),
        franja_liberada: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      _meta: {
        'com.asixto/capabilities': ['agenda', 'cancelacion'],
        'com.asixto/verb': 'cancelar una cita agendada',
      },
    },
    async ({ documento, cita_id, motivo }, ctx) => {
      const meta = asixtoMeta(ctx);

      // 0 · Idempotencia PRIMERO: si ya cancelamos con esta clave, devolvemos aquel resultado.
      // Si esto fuera después de la guarda de estado, un reintento legítimo devolvería «ya está
      // cancelada» y el agente le diría al cliente que falló algo que sí funcionó.
      const previo = resultadoPrevio(meta.idempotencyKey);
      if (previo) return previo;

      const cita = await sistemaPropio.buscarCita(cita_id);
      if (!cita) return fallo('NOT_FOUND', 'No encontré esa cita.');

      // 1 · Propiedad. Nota: no hay identidad autenticada del usuario final, así que se valida
      // contra el documento que la conversación ya resolvió.
      if (cita.documentoTitular !== documento) {
        return fallo('PERMISSION', 'Esa cita no está a nombre de quien me habla, no puedo cancelarla.');
      }

      // 2 · Estado terminal, con el estado actual en el mensaje para que el agente lo explique.
      if (cita.estado !== 'agendada') {
        return fallo('VALIDATION', `Esa cita ya está ${cita.estado}, no hay nada que cancelar.`);
      }

      const cancelada = await sistemaPropio.cancelarCita(cita_id, motivo ?? null);

      return recordarResultado(
        meta.idempotencyKey,
        exito(
          { cita_id: cancelada.id, estado: 'cancelada' as const, franja_liberada: cancelada.franjaTexto },
          `Cita cancelada. Liberé ${cancelada.franjaTexto}.`
        )
      );
    }
  );
}
