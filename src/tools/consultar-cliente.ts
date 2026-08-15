import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { exito, fallo } from '../asixto/errors.ts';
import { sistemaPropio } from '../sistema-propio.ts';

/**
 * NIVEL 1 · Herramienta de solo lectura. Parte del núcleo obligatorio del contrato.
 *
 * Sin esto el agente no sabe con quién habla. Es la primera que conviene poner en producción:
 * no escribe nada, así que el riesgo es prácticamente nulo.
 */
export function registrarConsultarCliente(server: McpServer): void {
  server.registerTool(
    'consultar_cliente',
    {
      title: 'Consultar cliente',
      description:
        'Busca un cliente por su número de documento y devuelve su nombre, estado y teléfono. ' +
        'Úsala para identificar a quién se está atendiendo. No la uses para modificar datos.',
      inputSchema: z.strictObject({
        documento: z.string().min(5).max(20).describe('Número de documento, sin puntos ni espacios'),
      }),
      outputSchema: z.strictObject({
        encontrado: z.boolean(),
        nombre: z.string().nullable(),
        estado: z.string().nullable(),
        telefono: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      // Clasificación para el agente de Asixto: escenarios donde se expone + verbo del prompt.
      _meta: {
        'com.asixto/capabilities': ['general', 'informacion_empresa', 'pqr', 'soporte', 'agenda', 'ventas'],
        'com.asixto/verb': 'identificar al cliente por su documento',
      },
    },
    async ({ documento }) => {
      const cliente = await sistemaPropio.buscarCliente(documento);

      if (!cliente) {
        // NOT_FOUND, no SYSTEM: el dato no existe, no hay ninguna falla técnica.
        return fallo('NOT_FOUND', 'No encontré un cliente con ese documento.');
      }

      return exito(
        { encontrado: true, nombre: cliente.nombre, estado: cliente.estado, telefono: cliente.telefono },
        `Cliente ${cliente.nombre}, estado ${cliente.estado}.`
      );
    }
  );
}
