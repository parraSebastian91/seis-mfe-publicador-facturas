import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent, BadgeVariant, ButtonComponent, ChipComponent, DatepickerComponent,
  DrawerContent, DrawerService, FormFieldComponent, IconComponent,
  InputComponent, PasoStepper, RutInputComponent, SkeletonComponent,
  StepperComponent,
} from 'shared-utils';

import { ZipService } from '../../service/zip.service';
import {
  DatosFactura, ESPERA_MAX_MS, EntradaPublicacion, EstadoEntrada,
  INTERVALO_SONDEO_MS, ResultadoEntrada, datosVacios, sePuedeEnviar,
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
  /**
   * Busca, entre las facturas que la página ya tiene en memoria, la que el
   * pipeline creó a partir de esta subida. `undefined` mientras no aparezca.
   *
   * Se identifica por `correlationId`, que es el que viajó con el archivo por
   * todo el pipeline. El nombre va solo como respaldo para lo que se haya
   * subido antes de que esto existiera.
   *
   * Se consulta en memoria, sin red: la página mantiene su listado al día por
   * el socket de notificaciones, así que sondear es gratis.
   */
  readonly buscarFactura?: (
    pistas: { correlationId?: string; nombreArchivo: string },
  ) => DatosLeidos | undefined;

  /**
   * El pipeline avisando que terminó con un documento, empujado por SSE.
   *
   * Complementa a `buscarFactura`, no lo reemplaza: el sondeo sigue porque es
   * quien marca una fila como `demorada` cuando nadie avisa nunca, y porque si
   * el stream se cae el drawer tiene que seguir completándose igual. Lo que
   * aporta es que la fila se completa apenas el worker termina, en vez de en la
   * siguiente vuelta del reloj.
   *
   * Llega ya traducido: el drawer no sabe de contratos del backend, igual que
   * no sabe de servicios. Traducir la extracción —con su procedencia por
   * campo— a `DatosLeidos` es trabajo de la página.
   */
  readonly procesado$?: Observable<EventoProcesamiento>;
}

/** Un documento que el pipeline terminó de leer. */
export interface EventoProcesamiento {
  readonly correlationId: string;
  readonly ok: boolean;
  readonly datos?: DatosLeidos;
  /** Por qué falló, cuando falló. */
  readonly detalle?: string;
}

/**
 * Fecha en ISO `YYYY-MM-DD`, en hora LOCAL.
 *
 * No se usa `toISOString()`: ese convierte a UTC, y en Chile (UTC-3) a partir
 * de las 21:00 devuelve el día siguiente. Con eso "hoy" pasaba a ser mañana y
 * el calendario de emisión dejaba de permitir el día en curso.
 */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lo que el pipeline terminó leyendo del documento. */
export interface DatosLeidos {
  readonly facturaId: string;
  readonly numeroFactura?: string;
  readonly rutDeudor?: string;
  readonly nombreRazonSocialDeudor?: string;
  readonly montoTotal?: string | number;
  readonly fechaEmision?: string;
  readonly fechaVencimiento?: string;
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
    CommonModule, FormsModule, BadgeComponent, ButtonComponent, ChipComponent,
    DatepickerComponent,
    FormFieldComponent, IconComponent, InputComponent, RutInputComponent,
    SkeletonComponent, StepperComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publicacion-drawer.component.html',
  styleUrl: './publicacion-drawer.component.scss',
})
export class PublicacionDrawerComponent
  implements DrawerContent<PublicacionDrawerInputs, EventoPublicacion>, OnDestroy {
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
  readonly enviadas = computed(() =>
    this.entradas().filter((e) => e.estado === 'procesando' || e.estado === 'procesada'
                               || e.estado === 'demorada'));
  readonly esperando = computed(() =>
    this.entradas().filter((e) => e.estado === 'subiendo' || e.estado === 'procesando'));
  readonly conError = computed(() => this.entradas().filter((e) => e.estado === 'error'));
  readonly enviando = signal(false);
  #sondeo?: ReturnType<typeof setInterval>;
  #escucha?: Subscription;

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

  /** Hoy, en ISO local, para acotar los calendarios. */
  readonly hoyIso = isoLocal(new Date());

  /**
   * Plazos habituales de factoring, contados desde HOY.
   *
   * No se calcula ninguno por defecto: el campo arranca vacío y el cedente
   * elige. Son un atajo para el caso frecuente, no una sugerencia que haya que
   * desarmar — proponer una fecha que nadie pidió es la clase de "ayuda" que
   * después aparece publicada sin que nadie la haya mirado.
   */
  readonly plazos = [30, 60, 90] as const;

  /** `hoy + dias`, en ISO. El Date nativo ya resuelve fin de mes y bisiestos. */
  fechaEnDias(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return isoLocal(d);
  }

  aplicarPlazo(id: string, dias: number): void {
    this.editarValor(id, 'fechaVencimiento', this.fechaEnDias(dias));
  }

  /**
   * Cuántos días faltan para una fecha. `null` si no hay fecha o no se entiende.
   *
   * Se compara a medianoche local para que no dependa de la hora a la que se
   * mire: si no, una fecha de mañana puede decir "en 0 días" por la tarde.
   */
  diasHasta(iso: string): number | null {
    if (!iso) return null;
    const [a, m, d] = iso.split('-').map(Number);
    if (!a || !m || !d) return null;
    const objetivo = new Date(a, m - 1, d);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    objetivo.setHours(0, 0, 0, 0);
    return Math.round((objetivo.getTime() - hoy.getTime()) / 86_400_000);
  }

  /**
   * Fija el vencimiento a partir de una cantidad de días escrita a mano.
   *
   * Es la misma operación que los atajos, pero para los plazos que no son 30,
   * 60 ni 90 — que en factoring son muchos. Vacío no borra la fecha: borrar el
   * número para escribir otro no debería perder lo que ya estaba.
   */
  aplicarDiasEscritos(id: string, event: Event): void {
    const crudo = (event.target as HTMLInputElement).value.trim();
    if (crudo === '') return;
    const dias = Number(crudo);
    if (!Number.isInteger(dias) || dias < 0 || dias > 3650) return;
    this.editarValor(id, 'fechaVencimiento', this.fechaEnDias(dias));
  }

  /** `true` si ese plazo es el que está elegido, para marcarlo. */
  plazoActivo(iso: string, dias: number): boolean {
    return !!iso && iso === this.fechaEnDias(dias);
  }


  /** Para que el template pueda preguntar sin importar el helper. */
  sePuedeEnviarEntrada = sePuedeEnviar;

  // ── Edición de los datos declarados ──────────────────────────────────────

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
          ? {
              estado: 'procesando',
              detalle: undefined,
              subidaEn: performance.now(),
              correlationId: r.correlationId,
            }
          : { estado: 'error', detalle: r.mensaje ?? 'No se pudo enviar.' });
      } catch (e) {
        this.#actualizar(entrada.id, {
          estado: 'error',
          detalle: e instanceof Error ? e.message : 'No se pudo enviar.',
        });
      }
    }
    this.enviando.set(false);
    this.#vigilarProcesamiento();
    this.#escucharPipeline();
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

  /**
   * Espera a que el pipeline termine cada documento y completa la fila.
   *
   * Sondea el listado que la página tiene en memoria —no hace red— porque el
   * socket de notificaciones ya lo mantiene al día. Si pasa demasiado tiempo la
   * fila queda como `demorada`: el pipeline puede seguir trabajando, lo que se
   * acabó es la espera de esta pantalla, y dejar un esqueleto girando para
   * siempre sería peor que decirlo.
   */
  #vigilarProcesamiento(): void {
    if (this.#sondeo) return;

    this.#sondeo = setInterval(() => {
      const pendientes = this.entradas().filter((e) => e.estado === 'procesando');
      if (!pendientes.length) {
        this.#detenerSondeo();
        return;
      }

      // Se lee en cada vuelta y no una sola vez al arrancar: capturarlo al
      // inicio hacía que, si el caller todavía no lo había provisto, no se
      // usara nunca aunque apareciera después.
      const buscar = this.drawerInputs.buscarFactura;

      for (const entrada of pendientes) {
        const leido = buscar?.({
          correlationId: entrada.correlationId,
          nombreArchivo: entrada.nombre,
        });
        if (leido) {
          this.#completar(entrada, leido);
          continue;
        }
        if (performance.now() - (entrada.subidaEn ?? 0) > ESPERA_MAX_MS) {
          this.#actualizar(entrada.id, {
            estado: 'demorada',
            detalle: 'Está tardando más de lo habitual. El documento se subió bien: '
                   + 'la factura va a aparecer en el listado cuando termine.',
          });
        }
      }
    }, INTERVALO_SONDEO_MS);
  }

  /**
   * Completa la fila con lo que el pipeline leyó.
   *
   * Lo leído NO pisa lo que la persona escribió: cada campo entra sólo si el
   * pipeline lo trae. Alguien puede haber tipeado el monto mientras el worker
   * procesaba, y sobrescribirlo por detrás sería lo peor que puede hacer un
   * formulario.
   */
  #completar(entrada: EntradaPublicacion, leido: DatosLeidos): void {
    this.#actualizar(entrada.id, {
      estado: 'procesada',
      facturaId: leido.facturaId,
      detalle: undefined,
      datos: {
        ...entrada.datos,
        numeroFactura: leido.numeroFactura ?? entrada.datos.numeroFactura,
        rutDeudor: leido.rutDeudor ?? entrada.datos.rutDeudor,
        nombreRazonSocialDeudor:
          leido.nombreRazonSocialDeudor ?? entrada.datos.nombreRazonSocialDeudor,
        montoTotal: String(leido.montoTotal ?? entrada.datos.montoTotal),
        fechaEmision: leido.fechaEmision ?? entrada.datos.fechaEmision,
        fechaVencimiento: leido.fechaVencimiento ?? entrada.datos.fechaVencimiento,
      },
    });
  }

  /**
   * Escucha al pipeline en vez de esperar la siguiente vuelta del sondeo.
   *
   * Se suscribe una sola vez: el drawer vive mientras dura la tanda, y
   * resuscribirse por cada envío dejaría conexiones colgando.
   */
  #escucharPipeline(): void {
    if (this.#escucha || !this.drawerInputs.procesado$) return;

    this.#escucha = this.drawerInputs.procesado$.subscribe({
      next: (evento) => {
        const entrada = this.entradas().find(
          (e) => e.correlationId && e.correlationId === evento.correlationId,
        );
        // Un evento sin fila es lo normal, no un error: el stream es por usuario
        // y puede traer el resultado de algo subido desde otra pestaña.
        if (!entrada || entrada.estado !== 'procesando') return;

        if (evento.ok && evento.datos) {
          this.#completar(entrada, evento.datos);
          return;
        }
        this.#actualizar(entrada.id, {
          estado: 'error',
          detalle: evento.detalle
            ?? 'El sistema no pudo leer el documento. Podés completar los datos a mano.',
        });
      },
      // Si el stream se corta, el sondeo sigue: por eso no se propaga ni se
      // muestra nada. Perder el empujón degrada la espera, no la rompe.
      error: () => { this.#escucha = undefined; },
    });
  }

  #detenerSondeo(): void {
    if (this.#sondeo) {
      clearInterval(this.#sondeo);
      this.#sondeo = undefined;
    }
  }

  ngOnDestroy(): void {
    this.#escucha?.unsubscribe();
    this.#detenerSondeo();
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
      subiendo: 'Subiendo…',
      procesando: 'Leyendo el documento…',
      procesada: 'Lista',
      demorada: 'Tardando',
      error: 'No se pudo enviar',
    }[estado];
  }

  tonoEstado(estado: EstadoEntrada): BadgeVariant {
    return {
      pendiente: 'neutral' as BadgeVariant,
      subiendo: 'info' as BadgeVariant,
      procesando: 'info' as BadgeVariant,
      procesada: 'success' as BadgeVariant,
      demorada: 'warning' as BadgeVariant,
      error: 'error' as BadgeVariant,
    }[estado];
  }

  iconoEstado(estado: EstadoEntrada): string {
    return {
      pendiente: 'description',
      subiendo: 'sync',
      procesando: 'sync',
      procesada: 'check_circle_outline',
      demorada: 'schedule',
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
