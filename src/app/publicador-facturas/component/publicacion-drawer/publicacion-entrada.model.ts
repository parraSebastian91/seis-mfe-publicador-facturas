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
  /** Subido: el pipeline lo está leyendo para crear la factura. */
  | 'procesando'
  /** El pipeline terminó y la factura ya existe, con sus datos. */
  | 'procesada'
  /**
   * Se subió, pero la factura no apareció en el tiempo esperado. NO es un
   * error: el pipeline puede seguir trabajando. Lo que se acabó es la paciencia
   * de esta pantalla, y conviene decirlo en vez de dejar un spinner eterno.
   */
  | 'demorada'
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
  /** Id de la factura que el pipeline creó, cuando ya se la pudo identificar. */
  facturaId?: string;
  /** El archivo en storage. Existe desde la subida, antes que la factura. */
  assetId?: string;
  /**
   * Identificador con el que esta subida viajó por el pipeline. Es lo que ata
   * el archivo con la factura que nazca de él: va en `X-Correlation-Id` y
   * termina en `factura.correlation_id`.
   */
  correlationId?: string;
  /** `performance.now()` del momento en que se subió, para saber cuánto esperar. */
  subidaEn?: number;
  /** Los datos que el cedente declara. Vacíos cuando los va a poner el documento. */
  datos: DatosFactura;
  /**
   * `false` cuando el RUT declarado no pasa el dígito verificador.
   *
   * Sin esto se podía enviar un RUT inválido: el campo lo marcaba en rojo y el
   * botón seguía habilitado, porque la comprobación era solo "no está vacío".
   */
  rutValido: boolean;
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

/** Cuánto espera la pantalla a que el pipeline termine, antes de soltar. */
export const ESPERA_MAX_MS = 90_000;
/** Cada cuánto se vuelve a mirar si la factura ya apareció. */
export const INTERVALO_SONDEO_MS = 2_000;

/** Lo que la página le responde al drawer por cada entrada enviada. */
export interface ResultadoEntrada {
  readonly ok: boolean;
  readonly mensaje?: string;
  /** Con el que viajó la subida, para reconocer después lo que el pipeline cree. */
  readonly correlationId?: string;
  /**
   * El registro del archivo en storage, que existe desde que se pidió la URL
   * firmada.
   *
   * Es lo único que ata el archivo con su fila mientras la factura todavía no
   * existe: con este flujo la factura nace recién cuando el worker leyó el
   * documento y se validó que no sea duplicada.
   */
  readonly assetId?: string;
}

/** Campos que el cedente tiene que declarar cuando no hay documento que leer. */
export const CAMPOS_REQUERIDOS_SIN_RESPALDO: ReadonlyArray<keyof DatosFactura> = [
  'numeroFactura', 'rutDeudor', 'nombreRazonSocialDeudor', 'montoTotal', 'fechaVencimiento',
];

/** `true` si la entrada tiene lo mínimo para poder enviarse. */
export function sePuedeEnviar(entrada: EntradaPublicacion): boolean {
  if (entrada.estado !== 'pendiente') return false;
  // Un RUT mal escrito no se manda nunca, haya documento o no: si hay documento
  // el declarado se usa para contrastar, y contrastar contra un RUT inválido no
  // sirve para nada.
  if (entrada.datos.rutDeudor.trim() !== '' && !entrada.rutValido) return false;
  if (entrada.archivo) return true;                       // lo lee el servidor
  return CAMPOS_REQUERIDOS_SIN_RESPALDO.every((c) => entrada.datos[c].trim() !== '');
}
