/**
 * Lo que entra al flujo de publicación y en qué estado está cada pieza.
 *
 * El modo (individual o masivo) NO lo elige el usuario: se infiere de cuántos
 * archivos entraron. Un ZIP se abre y pasa a ser N archivos, así que deja de ser
 * un caso aparte.
 *
 * ⚠️ Sobre los estados: el navegador **no lee el documento**. El PDF se sube por
 * presigned URL y de ahí lo toma el pipeline (orquestador → worker → ms-core),
 * que extrae los datos y crea la factura. Entonces acá solo se puede saber si el
 * archivo se envió, no si se pudo leer: el triage de "esta se leyó bien, esta
 * hay que revisarla" vive en el listado de facturas y en el mecanismo de notas
 * OCR que ya existe, con los estados del dominio (PROCESANDO,
 * PENDIENTE_VALIDACION, PENDIENTE_AUTORIZACION).
 *
 * Un modelo que prometiera acá "lista para publicar" estaría inventando una
 * certeza que este lado no tiene.
 */

/** En qué estado está un archivo de la tanda. */
export type EstadoEntrada =
  /** Soltado, todavía no se envió. */
  | 'pendiente'
  /** Subiendo al storage. */
  | 'subiendo'
  /** Subido: el sistema lo está leyendo para crear la factura. */
  | 'enviado'
  /** No se pudo subir. El motivo va en `detalle`. */
  | 'error';

/** De dónde van a salir los datos de esta factura. */
export type OrigenDatos = 'documento' | 'manual';

/** Una factura en curso de publicación. */
export interface EntradaPublicacion {
  /** Identificador local, solo para trackBy y para referirse a la fila. */
  readonly id: string;
  /** El PDF, si lo hay. `null` cuando el cedente eligió "no tengo el respaldo". */
  readonly archivo: File | null;
  /** Nombre a mostrar: el del archivo, o uno genérico si no hay archivo. */
  readonly nombre: string;
  estado: EstadoEntrada;
  origen: OrigenDatos;
  /** Qué pasó, en palabras, cuando hace falta explicar algo. */
  detalle?: string;
  /** Los datos que el cedente declara. Vacíos cuando los va a poner el documento. */
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

/** Lo que la página le responde al drawer por cada entrada enviada. */
export interface ResultadoEntrada {
  readonly ok: boolean;
  readonly mensaje?: string;
}

/** Campos que el cedente tiene que declarar cuando no hay documento que leer. */
export const CAMPOS_REQUERIDOS_SIN_RESPALDO: ReadonlyArray<keyof DatosFactura> = [
  'numeroFactura', 'rutDeudor', 'nombreRazonSocialDeudor', 'montoTotal', 'fechaVencimiento',
];

/** `true` si la entrada tiene lo mínimo para poder enviarse. */
export function sePuedeEnviar(entrada: EntradaPublicacion): boolean {
  if (entrada.estado !== 'pendiente') return false;
  if (entrada.archivo) return true;                       // lo lee el servidor
  return CAMPOS_REQUERIDOS_SIN_RESPALDO.every((c) => entrada.datos[c].trim() !== '');
}
