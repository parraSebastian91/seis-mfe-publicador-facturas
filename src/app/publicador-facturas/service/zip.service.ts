import { Injectable } from '@angular/core';

/**
 * Lector de ZIP mínimo, sin dependencias.
 *
 * Por qué a mano y no una librería: el navegador ya trae `DecompressionStream`,
 * que hace la parte difícil (inflate). Lo que falta es leer el índice del ZIP,
 * que son unos pocos campos en posiciones fijas al final del archivo. Traer una
 * dependencia para eso no se justifica en un proyecto que ya sacó
 * ng-bootstrap y Material para no cargar con terceros.
 *
 * Alcance deliberado: ZIP clásico, métodos "stored" (0) y "deflate" (8), que es
 * lo que produce cualquier compresor de escritorio. **No** soporta ZIP64
 * (más de 65.535 entradas o archivos de más de 4 GB) ni ZIP cifrado. Para un
 * cedente que comprime sus facturas del mes alcanza; si algún día no alcanza,
 * el error es explícito y no un archivo corrupto silencioso.
 */
/** Firma del registro "fin del directorio central". */
const FIN_DIRECTORIO = 0x06054b50;
/** Firma de cada entrada del directorio central. */
const ENTRADA_DIRECTORIO = 0x02014b50;

@Injectable({ providedIn: 'root' })
export class ZipService {

  /** `true` si el archivo parece un ZIP, por nombre o por tipo. */
  esZip(archivo: File): boolean {
    const nombre = archivo.name.toLowerCase();
    return nombre.endsWith('.zip') || archivo.type === 'application/zip'
      || archivo.type === 'application/x-zip-compressed';
  }

  /**
   * Extrae los archivos del ZIP como `File`, para que aguas abajo no haya que
   * distinguir si vinieron sueltos o comprimidos.
   *
   * @param filtro extensiones a conservar, en minúscula y con punto. Por
   *   defecto solo PDF: un ZIP de facturas suele traer también carpetas del
   *   sistema (`__MACOSX`) y miniaturas que no interesan.
   */
  async extraer(zip: File, filtro: readonly string[] = ['.pdf']): Promise<File[]> {
    const datos = new Uint8Array(await zip.arrayBuffer());
    const vista = new DataView(datos.buffer);
    const fin = this.#buscarFinDirectorio(vista, datos.length);
    if (fin < 0) {
      throw new Error('El archivo no es un ZIP válido o está incompleto.');
    }

    const cantidad = vista.getUint16(fin + 10, true);
    let offset = vista.getUint32(fin + 16, true);
    const salida: File[] = [];

    for (let i = 0; i < cantidad; i++) {
      if (vista.getUint32(offset, true) !== ENTRADA_DIRECTORIO) break;

      const metodo = vista.getUint16(offset + 10, true);
      const tamComprimido = vista.getUint32(offset + 20, true);
      const largoNombre = vista.getUint16(offset + 28, true);
      const largoExtra = vista.getUint16(offset + 30, true);
      const largoComentario = vista.getUint16(offset + 32, true);
      const offsetLocal = vista.getUint32(offset + 42, true);
      const nombre = new TextDecoder().decode(
        datos.subarray(offset + 46, offset + 46 + largoNombre),
      );
      offset += 46 + largoNombre + largoExtra + largoComentario;

      if (!this.#interesa(nombre, filtro)) continue;

      const contenido = await this.#leerEntrada(
        datos, vista, offsetLocal, metodo, tamComprimido, nombre,
      );
      if (contenido) {
        salida.push(new File([contenido as BlobPart], this.#soloNombre(nombre),
                             { type: 'application/pdf' }));
      }
    }
    return salida;
  }

  /**
   * El "fin del directorio central" está al final, pero puede tener hasta 64 KB
   * de comentario detrás, así que hay que buscarlo hacia atrás.
   */
  #buscarFinDirectorio(vista: DataView, largo: number): number {
    const minimo = Math.max(0, largo - 0xffff - 22);
    for (let i = largo - 22; i >= minimo; i--) {
      if (vista.getUint32(i, true) === FIN_DIRECTORIO) return i;
    }
    return -1;
  }

  async #leerEntrada(
    datos: Uint8Array, vista: DataView, offsetLocal: number,
    metodo: number, tamComprimido: number, nombre: string,
  ): Promise<Uint8Array | null> {
    // El encabezado local repite el largo del nombre y del extra, y pueden
    // diferir de los del directorio: hay que leerlos de acá.
    const largoNombre = vista.getUint16(offsetLocal + 26, true);
    const largoExtra = vista.getUint16(offsetLocal + 28, true);
    const inicio = offsetLocal + 30 + largoNombre + largoExtra;
    const crudo = datos.subarray(inicio, inicio + tamComprimido);

    if (metodo === 0) return crudo;             // guardado sin comprimir
    if (metodo !== 8) {
      console.warn(`[zip] "${nombre}" usa un método de compresión no soportado (${metodo})`);
      return null;
    }
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no puede descomprimir ZIP. Subí los PDF sueltos.');
    }
    const flujo = new Blob([crudo as BlobPart]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  }

  #interesa(nombre: string, filtro: readonly string[]): boolean {
    if (nombre.endsWith('/')) return false;                       // carpeta
    const base = this.#soloNombre(nombre);
    if (!base || base.startsWith('.')) return false;              // ocultos
    if (nombre.startsWith('__MACOSX/')) return false;             // basura de macOS
    return filtro.some((ext) => base.toLowerCase().endsWith(ext));
  }

  #soloNombre(ruta: string): string {
    return ruta.split('/').pop() ?? ruta;
  }
}
