/**
 * Lo que entra al flujo de publicación y en qué estado está cada pieza.
 *
 * El modo (individual o masivo) NO lo elige el usuario: se infiere de cuántos
 * archivos entraron. Un ZIP se abre y pasa a ser N archivos, así que deja de ser
 * un caso aparte.
 */

/** En qué estado quedó un archivo después de procesarlo. */
export type EstadoEntrada =
  /** Todavía no se procesó. */
  | 'pendiente'
  /** Se está leyendo el documento. */
  | 'procesando'
  /** Se leyó y los datos están completos: se puede publicar. */
  | 'listo'
  /** Se leyó pero falta algo o hay algo dudoso: necesita que alguien mire. */
  | 'revisar'
  /** No se pudo leer nada del documento. */
  | 'ilegible'
  /** Se leyó, pero el tipo de documento no se puede ceder a un factoring. */
  | 'no_cedible';

/** De dónde salieron los datos. Determina cuánta confianza merecen. */
export type OrigenDatos = 'timbre_verificado' | 'timbre_sin_verificar' | 'ocr' | 'manual';

/** Una factura en curso de publicación. */
export interface EntradaPublicacion {
  /** Identificador local, solo para trackBy y para referirse a la fila. */
  readonly id: string;
  /** El PDF, si lo hay. `null` cuando el cedente eligió "no tengo el respaldo". */
  readonly archivo: File | null;
  /** Nombre a mostrar: el del archivo, o uno genérico si no hay archivo. */
  readonly nombre: string;
  estado: EstadoEntrada;
  origen: OrigenDatos | null;
  /** Qué pasó, en palabras, cuando el estado no es `listo`. */
  detalle?: string;
  /** Los datos de la factura, se completen por lectura o a mano. */
  datos: DatosFactura;
}

export interface DatosFactura {
  numeroFactura: string;
  rutDeudor: string;
  nombreRazonSocialDeudor: string;
  montoTotal: string;
  fechaEmision: string;
  /** Siempre declarada: el timbre no la trae. Ver la tabla de decisiones de CLAUDE.md. */
  fechaVencimiento: string;
}

export function datosVacios(): DatosFactura {
  return {
    numeroFactura: '',
    rutDeudor: '',
    nombreRazonSocialDeudor: '',
    montoTotal: '',
    fechaEmision: '',
    fechaVencimiento: '',
  };
}

/** Estados que permiten publicar sin que nadie intervenga. */
export const ESTADOS_PUBLICABLES: readonly EstadoEntrada[] = ['listo'];

/** Estados que piden atención del cedente antes de poder publicar. */
export const ESTADOS_CON_ATENCION: readonly EstadoEntrada[] = ['revisar', 'ilegible', 'no_cedible'];
