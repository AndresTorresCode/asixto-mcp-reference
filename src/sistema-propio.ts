/**
 * SIMULACIÓN DEL SISTEMA DEL CLIENTE: es lo único que hay que reemplazar.
 *
 * Aquí van las llamadas a SU backend, SU ERP o SU base de datos. El resto del repo
 * (protocolo, autenticación, idempotencia, errores) ya cumple el contrato de Asixto y
 * normalmente no se toca.
 *
 * Los datos de abajo son ficticios y sirven para que el servidor arranque y pase la
 * verificación de conformidad sin conectar nada.
 */

export type Cliente = {
  documento: string;
  nombre: string;
  estado: 'activo' | 'suspendido' | 'moroso';
  telefono: string;
};

export type Item = {
  id: string;
  nombre: string;
  /** `default` es obligatoria: es el precio que se usa si el tenant no trae lista propia. */
  precios: { default: number } & Record<string, number>;
  disponible: boolean;
  unidad: string;
  reglasDeVenta: string;
};

export type Caso = { radicado: string; estado: 'abierto' | 'en_cola'; slaHoras: number };

export type Cita = {
  id: string;
  documentoTitular: string;
  /** Instante ISO con offset: es el dato canónico. El texto es para leerlo en voz alta. */
  inicio: string;
  franjaTexto: string;
  estado: 'agendada' | 'cancelada' | 'atendida';
};

const CLIENTES: Cliente[] = [
  { documento: 'CC1032456789', nombre: 'Ana Restrepo', estado: 'activo', telefono: '+57300…4512' },
  { documento: 'CC8891234567', nombre: 'Jorge Salazar', estado: 'moroso', telefono: '+57310…8890' },
];

const ITEMS: Item[] = [
  {
    id: 'plan-fibra-300',
    nombre: 'Plan Fibra 300 megas',
    precios: { default: 89900, mayorista: 79900 },
    disponible: true,
    unidad: 'mes',
    reglasDeVenta: 'Requiere cobertura verificada en la dirección. Contrato mínimo de 6 meses.',
  },
  {
    id: 'plan-fibra-600',
    nombre: 'Plan Fibra 600 megas',
    precios: { default: 119900, mayorista: 104900 },
    disponible: false,
    unidad: 'mes',
    reglasDeVenta: 'Disponible solo en zonas con red nueva.',
  },
];

const CITAS: Cita[] = [
  {
    id: 'CITA-7781',
    documentoTitular: 'CC1032456789',
    inicio: '2099-09-03T09:00:00-05:00',
    franjaTexto: 'el miércoles 3 de septiembre a las nueve de la mañana',
    estado: 'agendada',
  },
  {
    id: 'CITA-7782',
    documentoTitular: 'CC8891234567',
    inicio: '2099-09-04T15:00:00-05:00',
    franjaTexto: 'el jueves 4 de septiembre a las tres de la tarde',
    estado: 'atendida',
  },
];

let consecutivo = 4820;

export const sistemaPropio = {
  async buscarCliente(documento: string): Promise<Cliente | null> {
    return CLIENTES.find((c) => c.documento === documento) ?? null;
  },

  async buscarItems(texto: string, listaDePrecios: string | null): Promise<Array<Omit<Item, 'precios'> & { precio: number }>> {
    const lista = listaDePrecios && listaDePrecios !== 'default' ? listaDePrecios : 'default';

    return ITEMS.filter((i) => i.nombre.toLowerCase().includes(texto.toLowerCase())).map(({ precios, ...resto }) => ({
      ...resto,
      // El precio se resuelve con la lista que envía el Gateway, no con el precio por defecto.
      precio: precios[lista] ?? precios.default,
    }));
  },

  async abrirCaso(documento: string, tipo: string, descripcion: string): Promise<Caso> {
    consecutivo += 1;
    void tipo;
    void descripcion;
    void documento;

    return { radicado: `SOP-${consecutivo}`, estado: 'abierto', slaHoras: 24 };
  },

  /** Devuelve los campos que quedaron guardados, no un `ok` genérico. */
  async actualizarCliente(
    documento: string,
    cambios: { telefono?: string | null; correo?: string | null }
  ): Promise<string[]> {
    const cliente = CLIENTES.find((c) => c.documento === documento);
    if (!cliente) return [];

    const actualizados: string[] = [];
    if (cambios.telefono) {
      cliente.telefono = cambios.telefono;
      actualizados.push('teléfono');
    }
    if (cambios.correo) actualizados.push('correo');

    return actualizados;
  },

  async buscarCita(id: string): Promise<Cita | null> {
    return CITAS.find((cita) => cita.id === id) ?? null;
  },

  async cancelarCita(id: string, motivo: string | null): Promise<Cita> {
    const cita = CITAS.find((c) => c.id === id);
    if (!cita) throw new Error(`Cita ${id} inexistente`);

    void motivo;
    cita.estado = 'cancelada';

    return cita;
  },
};
