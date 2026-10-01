import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  BadgeComponent, BadgeVariant, ButtonComponent, DrawerContent, DrawerService,
  IconComponent,
} from 'shared-utils';

import { ZipService } from '../../service/zip.service';
import {
  DatosFactura, ESTADOS_CON_ATENCION, EntradaPublicacion, EstadoEntrada, datosVacios,
} from './publicacion-entrada.model';

/** Lo que el caller le pasa al drawer. Hoy no necesita nada. */
export interface PublicacionDrawerInputs {
  /** Reservado: por ejemplo, precargar una factura concreta. */
  readonly facturaId?: string;
}

/** Lo que el drawer le devuelve al que lo abrió. */
export type EventoPublicacion =
  | { tipo: 'publicar'; entradas: EntradaPublicacion[] }
  | { tipo: 'sin-respaldo' }
  | { tipo: 'cerrar' };

/**
 * Entrada del flujo de publicación.
 *
 * El modo **no se elige**: se infiere de cuántos archivos entraron. Uno abre el
 * detalle; varios, o un ZIP, abren el consolidado. El ZIP se expande y pasa a
 * ser N archivos, así que no es un caso aparte sino un contenedor.
 *
 * Reemplaza al wizard de 3 pasos de `ModalPublicacionFacturaComponent`, que
 * pedía tipear los datos ANTES de subir el documento. Si el documento trae los
 * datos —y con el timbre electrónico los trae, exactos y firmados— pedirlos
 * primero es pedirle al cedente que transcriba lo que el sistema puede leer.
 */
@Component({
  selector: 'app-publicacion-drawer',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publicacion-drawer.component.html',
  styleUrl: './publicacion-drawer.component.scss',
})
export class PublicacionDrawerComponent
  implements DrawerContent<PublicacionDrawerInputs, EventoPublicacion> {
  private readonly drawer = inject(DrawerService);
  private readonly zip = inject(ZipService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Lo que inyecta el host del drawer (`DrawerConfig.inputs`). */
  @Input() drawerInputs: PublicacionDrawerInputs = {};
  /**
   * Parte del contrato `DrawerContent`. En la práctica el canal que funciona es
   * `DrawerService.emit()` —el host no se suscribe a este EventEmitter— pero se
   * declara para cumplir el tipo, igual que `factura-sidebar-content`.
   */
  readonly drawerEvent = new EventEmitter<EventoPublicacion>();

  readonly entradas = signal<EntradaPublicacion[]>([]);
  readonly arrastrando = signal(false);
  readonly expandida = signal<string | null>(null);
  readonly errorCarga = signal<string>('');
  readonly leyendoZip = signal(false);

  /** El modo se deduce; no hay botón que lo elija. */
  readonly modo = computed<'vacio' | 'individual' | 'masivo'>(() => {
    const n = this.entradas().length;
    return n === 0 ? 'vacio' : n === 1 ? 'individual' : 'masivo';
  });

  readonly publicables = computed(() =>
    this.entradas().filter((e) => e.estado === 'listo'),
  );
  /**
   * Las que necesitan que alguien mire. `pendiente` y `procesando` NO cuentan:
   * todavía no se sabe nada de ellas, y mostrarlas como "a revisar" asusta sin
   * motivo apenas se sueltan los archivos.
   */
  readonly requierenAtencion = computed(() =>
    this.entradas().filter((e) => ESTADOS_CON_ATENCION.includes(e.estado)),
  );

  /** Las que todavía no se procesaron. */
  readonly enCola = computed(() =>
    this.entradas().filter((e) => e.estado === 'pendiente' || e.estado === 'procesando'),
  );

  readonly maxArchivos = 50;

  // ── Entrada de archivos ──────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.arrastrando.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.arrastrando.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.arrastrando.set(false);
    await this.recibir(Array.from(event.dataTransfer?.files ?? []));
  }

  async onSeleccion(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.recibir(Array.from(input.files ?? []));
    input.value = '';   // permite volver a elegir el mismo archivo
  }

  /**
   * Punto único de entrada: sueltos o comprimidos terminan acá como una lista
   * plana de PDFs.
   */
  private async recibir(archivos: File[]): Promise<void> {
    this.errorCarga.set('');
    if (!archivos.length) return;

    const planos: File[] = [];
    for (const archivo of archivos) {
      if (this.zip.esZip(archivo)) {
        this.leyendoZip.set(true);
        this.cdr.markForCheck();
        try {
          const dentro = await this.zip.extraer(archivo);
          if (!dentro.length) {
            this.errorCarga.set(`"${archivo.name}" no contiene ningún PDF.`);
          }
          planos.push(...dentro);
        } catch (e) {
          this.errorCarga.set(e instanceof Error ? e.message : 'No se pudo abrir el ZIP.');
        } finally {
          this.leyendoZip.set(false);
        }
      } else if (archivo.type === 'application/pdf'
                 || archivo.name.toLowerCase().endsWith('.pdf')) {
        planos.push(archivo);
      } else {
        this.errorCarga.set(`"${archivo.name}" no es un PDF ni un ZIP.`);
      }
    }

    const disponibles = this.maxArchivos - this.entradas().length;
    if (planos.length > disponibles) {
      this.errorCarga.set(
        `Se pueden publicar hasta ${this.maxArchivos} facturas por tanda. ` +
        `Se tomaron las primeras ${Math.max(disponibles, 0)}.`,
      );
    }

    const nuevas = planos.slice(0, Math.max(disponibles, 0)).map((f) => this.entradaDe(f));
    this.entradas.update((prev) => [...prev, ...nuevas]);
    if (this.entradas().length === 1) {
      this.expandida.set(this.entradas()[0].id);
    }
    this.cdr.markForCheck();
  }

  private entradaDe(archivo: File): EntradaPublicacion {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      archivo,
      nombre: archivo.name,
      estado: 'pendiente',
      origen: null,
      datos: datosVacios(),
    };
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  quitar(id: string): void {
    this.entradas.update((prev) => prev.filter((e) => e.id !== id));
    if (this.expandida() === id) this.expandida.set(null);
    this.cdr.markForCheck();
  }

  alternarExpandida(id: string): void {
    this.expandida.update((actual) => (actual === id ? null : id));
  }

  /**
   * "No tengo el respaldo ahora": se publica con los datos declarados y el PDF
   * se sube después. Al subirlo se cotejan los datos contra el documento, que
   * es el mismo mecanismo de notas que ya existe, disparado más tarde.
   */
  sinRespaldo(): void {
    const entrada: EntradaPublicacion = {
      id: `manual-${Date.now()}`,
      archivo: null,
      nombre: 'Factura sin respaldo',
      estado: 'revisar',
      origen: 'manual',
      detalle: 'Vas a cargar los datos a mano. El respaldo se puede subir después.',
      datos: datosVacios(),
    };
    this.entradas.update((prev) => [...prev, entrada]);
    this.expandida.set(entrada.id);
    this.cdr.markForCheck();
  }

  publicar(): void {
    const listas = this.publicables();
    if (!listas.length) return;
    this.drawer.emit({ tipo: 'publicar', entradas: listas } satisfies EventoPublicacion);
  }

  cerrar(): void {
    this.drawer.emit({ tipo: 'cerrar' } satisfies EventoPublicacion);
    this.drawer.close();
  }

  // ── Presentación ─────────────────────────────────────────────────────────

  trackById = (_: number, e: EntradaPublicacion) => e.id;

  etiquetaEstado(estado: EstadoEntrada): string {
    return {
      pendiente: 'En cola',
      procesando: 'Leyendo…',
      listo: 'Lista para publicar',
      revisar: 'Revisar',
      ilegible: 'No se pudo leer',
      no_cedible: 'No es cedible',
    }[estado];
  }

  tonoEstado(estado: EstadoEntrada): BadgeVariant {
    if (estado === 'listo') return 'success';
    if (estado === 'revisar') return 'warning';
    if (estado === 'ilegible' || estado === 'no_cedible') return 'error';
    return 'neutral';
  }

  iconoEstado(estado: EstadoEntrada): string {
    return {
      pendiente: 'schedule',
      procesando: 'sync',
      listo: 'check_circle_outline',
      revisar: 'error_outline',
      ilegible: 'visibility_off',
      no_cedible: 'block',
    }[estado];
  }

  campos(datos: DatosFactura): Array<{ etiqueta: string; valor: string }> {
    return [
      { etiqueta: 'N° de factura', valor: datos.numeroFactura },
      { etiqueta: 'RUT del deudor', valor: datos.rutDeudor },
      { etiqueta: 'Deudor', valor: datos.nombreRazonSocialDeudor },
      { etiqueta: 'Monto total', valor: datos.montoTotal },
      { etiqueta: 'Fecha de emisión', valor: datos.fechaEmision },
      { etiqueta: 'Fecha de vencimiento', valor: datos.fechaVencimiento },
    ];
  }
}
