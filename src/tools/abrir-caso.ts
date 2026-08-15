import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { exito, fallo } from '../asixto/errors.ts';
import { asixtoMeta } from '../asixto/meta.ts';
import { recordarResultado, resultadoPrevio } from '../asixto/idempotency.ts';
import { sistemaPropio } from '../sistema-propio.ts';

/**
 * NIVEL 3 · Escritura. Aquí entran las garantías del contrato:
 *
 *   · Idempotencia con la clave del `_meta` (garantía 1).
 *   · Propiedad del registro: el cliente debe existir antes de abrirle un caso (garantía 2).
 *   · Dato crítico validado en NUESTRO lado, no el que proponga el modelo (garantía 4).
 *   · Radicado en la misma respuesta: es lo que el agente le dice al cliente.
 *
 * OJO con el canal: en llamada telefónica el agente **no ejecuta** la apertura de caso, por
 * diseño de Asixto. Esta herramienta solo se invoca en chat. No es un error de su servidor.
 */
export function registrarAbrirCaso(server: McpServer): void {
  server.registerTool(
    'abrir_caso_soporte',
    {
      title: 'Abrir caso de soporte',
      description:
        'Registra un caso de soporte para un cliente identificado y devuelve su número de radicado. ' +
        'Úsala solo cuando el cliente ya describió el problema. No la uses para consultar el estado ' +
        'de un caso existente.',
      inputSchema: z.strictObject({
        documento: z.string().min(5).max(20),
        tipo: z.enum(['falla', 'instalacion', 'cobro']),
        descripcion: z.string().min(10).max(400).describe('El problema en palabras del cliente'),
        prioridad: z.enum(['alta', 'normal']).nullable().optional(),
      }),
      outputSchema: z.strictObject({
        radicado: z.string(),
        estado: z.enum(['abierto', 'en_cola']),
        sla_horas: z.number().int(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: {
        'com.asixto/capabilities': ['pqr', 'soporte', 'garantia', 'reclamo_calidad', 'emergencia'],
        'com.asixto/verb': 'abrir un caso de soporte y entregar el radicado',
      },
    },
    async ({ documento, tipo, descripcion }, ctx) => {
      const meta = asixtoMeta(ctx);

      // Garantía 1 · idempotencia, y va PRIMERO: antes de cualquier guarda de estado.
      const previo = resultadoPrevio(meta.idempotencyKey);
      if (previo) return previo;

      // Garantía 2 · propiedad: no se abre un caso a un documento que no existe en nuestro sistema.
      const cliente = await sistemaPropio.buscarCliente(documento);
      if (!cliente) {
        return fallo('NOT_FOUND', 'No encontré un cliente con ese documento, no puedo abrir el caso.');
      }

      // Garantía 4 · el dato crítico lo decide nuestro sistema: un cliente suspendido no abre caso.
      if (cliente.estado === 'suspendido') {
        return fallo('BLOCKER', 'La cuenta está suspendida. Hay que resolver eso antes de abrir el caso.');
      }

      const caso = await sistemaPropio.abrirCaso(documento, tipo, descripcion);

      return recordarResultado(
        meta.idempotencyKey,
        exito(
          { radicado: caso.radicado, estado: caso.estado, sla_horas: caso.slaHoras },
          `Caso ${caso.radicado} registrado. Respuesta en ${caso.slaHoras} horas.`
        )
      );
    }
  );
}
