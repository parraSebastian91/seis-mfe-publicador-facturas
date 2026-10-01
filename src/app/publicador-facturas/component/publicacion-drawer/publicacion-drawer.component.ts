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
  BadgeComponent, BadgeVariant, ButtonComponent, DatepickerComponent,
  DrawerContent, DrawerService, FormFieldComponent, IconComponent,
  InputComponent, PasoStepper, RutInputComponent, StepperComponent,
} from 'shared-utils';

import { ZipService } from '../../service/zip.service';
import {
  DatosFactura, EntradaPublicacion, EstadoEntrada, ResultadoEntrada,
  datosVacios, sePuedeEnviar,
} from './publicacion-entrada.model';

/**
 * Lo que el caller le pasa al drawer.
 *
 * `enviarUna` es una capacidad inyectada, no un evento: el drawer sabe de UI y
 * de orden, pero no de servicios ni de contratos del backend. Así la lógica de
 * publicación se queda en la página —que ya la tiene— y acá queda solo el
 * manejo de la tanda y su progreso.
 */
export interface PublicacionDrawerInputs {
  readonly enviarUna?: (entrada: EntradaPublicacion) => Promise<ResultadoEntrada>;
}

/** Lo que el drawer le devuelve al que lo abrió. */
export type EventoPublicacion =
  /** Terminó de enviarse la tanda. */
  | { tipo: 'enviadas'; enviadas: number; conError: number }
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
  imports: [
    CommonModule, BadgeComponent, ButtonComponent, DatepickerComponent,
    FormFieldComponent, IconComponent, InputComponent, RutInputComponent,
    StepperComponent,
  ],
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

  /** Las que tienen lo mínimo para enviarse. */
  readonly enviables = computed(() => this.entradas().filter(sePuedeEnviar));
  readonly enviadas = computed(() => this.entradas().filter((e) => e.estado === 'enviado'));
  readonly conError = computed(() => this.entradas().filter((e) => e.estado === 'error'));
  readonly enviando = signal(false);

  readonly maxArchivos = 50;

  // ── Pasos ────────────────────────────────────────────────────────────────
  //
  // El orden es el inverso al del wizard anterior, y es el punto: antes se
  // tipeaban los datos y RECIÉN DESPUÉS se subía el documento. Si el documento
  // trae los datos, pedirlos primero es pedirle al cedente que transcriba lo
  // que el sistema puede leer.

  /** 0 = subir, 1 = revisar, 2 = enviar. */
  readonly paso = signal(0);

  readonly pasos = computed<PasoStepper[]>(() => [
    { etiqueta: 'Subir facturas' },
    { etiqueta: 'Revisar', habilitado: this.entradas().length > 0 },
    { etiqueta: 'Enviar', habilitado: this.enviables().length > 0 || this.yaSeEnvio() },
  ]);

  /** `true` una vez que la tanda salió: el paso 3 deja de ser alcanzable hacia atrás. */
  readonly yaSeEnvio = computed(() => this.enviadas().length > 0 || this.conError().length > 0);

  irAPaso(indice: number): void {
    // No se vuelve atrás una vez enviada la tanda: los archivos ya salieron y
    // "editar" lo que está procesándose del otro lado sería una mentira.
    if (this.yaSeEnvio() && indice < 2) return;
    this.paso.set(indice);
  }

  siguiente(): void {
    if (this.paso() === 0 && this.entradas().length) this.paso.set(1);
    else if (this.paso() === 1 && this.enviables().length) this.paso.set(2);
  }

  anterior(): void {
    if (this.paso() > 0 && !this.yaSeEnvio()) this.paso.update((p) => p - 1);
  }

  /** Hoy, en ISO, para acotar los calendarios. */
  readonly hoyIso = new Date().toISOString().slice(0, 10);

  /** Para que el template pueda preguntar sin importar el helper. */
  sePuedeEnviarEntrada = sePuedeEnviar;

  // ── Edición de los datos declarados ──────────────────────────────────────

  /** Desde un `<input>`: toma el valor del evento. */
  editar(id: string, campo: keyof DatosFactura, event: Event): void {
    this.editarValor(id, campo, (event.target as HTMLInputElement).value);
  }

  /** El rut-input avisa si el dígito verificador cuadra. */
  marcarRutValido(id: string, valido: boolean): void {
    this.entradas.update((prev) => prev.map((e) =>
      e.id === id ? { ...e, rutValido: valido } : e));
    this.cdr.markForCheck();
  }

  /** Desde un componente que emite el valor ya limpio (rut-input, datepicker). */
  editarValor(id: string, campo: keyof DatosFactura, valor: string): void {
    this.entradas.update((prev) => prev.map((e) =>
      e.id === id ? { ...e, datos: { ...e.datos, [campo]: valor } } : e));
    this.cdr.markForCheck();
  }

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
    if (nuevas.length) this.paso.set(1);     // ya hay qué revisar
    this.cdr.markForCheck();
  }

  private entradaDe(archivo: File): EntradaPublicacion {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      archivo,
      nombre: archivo.name,
      estado: 'pendiente',
      origen: 'documento',
      datos: datosVacios(),
      rutValido: true,
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
      estado: 'pendiente',
      origen: 'manual',
      detalle: 'Cargá los datos a mano. El respaldo se puede subir después, y el '
             + 'sistema lo va a cotejar contra lo que declaraste.',
      datos: datosVacios(),
      rutValido: true,
    };
    this.entradas.update((prev) => [...prev, entrada]);
    this.expandida.set(entrada.id);
    this.paso.set(1);
    this.cdr.markForCheck();
  }

  /**
   * Envía la tanda, de a una.
   *
   * Secuencial a propósito: cada envío sube un PDF por presigned URL y dispara
   * el pipeline de extracción del lado del servidor. Mandar veinte en paralelo
   * no acelera nada aguas abajo y hace que un error se pierda entre los demás.
   */
  async publicar(): Promise<void> {
    const pendientes = this.enviables();
    const enviar = this.drawerInputs.enviarUna;
    if (!pendientes.length || !enviar || this.enviando()) return;

    this.enviando.set(true);
    for (const entrada of pendientes) {
      this.#actualizar(entrada.id, { estado: 'subiendo', detalle: undefined });
      try {
        const r = await enviar(entrada);
        this.#actualizar(entrada.id, r.ok
          ? { estado: 'enviado', detalle: 'El sistema está leyendo el documento.' }
          : { estado: 'error', detalle: r.mensaje ?? 'No se pudo enviar.' });
      } catch (e) {
        this.#actualizar(entrada.id, {
          estado: 'error',
          detalle: e instanceof Error ? e.message : 'No se pudo enviar.',
        });
      }
    }
    this.enviando.set(false);
    this.drawer.emit({
      tipo: 'enviadas',
      enviadas: this.enviadas().length,
      conError: this.conError().length,
    } satisfies EventoPublicacion);
  }

  /**
   * Devuelve una entrada fallida a la cola para volver a intentarla.
   *
   * Sin esto, un error de red en una de veinte deja esa factura sin camino: el
   * botón de enviar queda deshabilitado porque no hay nada "pendiente", y la
   * única salida sería cerrar y rehacer la tanda entera.
   */
  reintentar(id: string): void {
    this.#actualizar(id, { estado: 'pendiente', detalle: undefined });
  }

  #actualizar(id: string, cambios: Partial<EntradaPublicacion>): void {
    this.entradas.update((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...cambios } : e)));
    this.cdr.markForCheck();
  }

  cerrar(): void {
    this.drawer.emit({ tipo: 'cerrar' } satisfies EventoPublicacion);
    this.drawer.close();
  }

  // ── Presentación ─────────────────────────────────────────────────────────

  trackById = (_: number, e: EntradaPublicacion) => e.id;

  etiquetaEstado(estado: EstadoEntrada): string {
    return {
      pendiente: 'Lista para enviar',
      subiendo: 'Enviando…',
      enviado: 'Enviada · leyendo',
      error: 'No se pudo enviar',
    }[estado];
  }

  tonoEstado(estado: EstadoEntrada): BadgeVariant {
    return {
      pendiente: 'neutral' as BadgeVariant,
      subiendo: 'info' as BadgeVariant,
      enviado: 'success' as BadgeVariant,
      error: 'error' as BadgeVariant,
    }[estado];
  }

  iconoEstado(estado: EstadoEntrada): string {
    return {
      pendiente: 'description',
      subiendo: 'sync',
      enviado: 'check_circle_outline',
      error: 'error_outline',
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
