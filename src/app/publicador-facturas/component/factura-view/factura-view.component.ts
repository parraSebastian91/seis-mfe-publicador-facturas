import { FacturaAdjuntoType } from 'shared-utils';

import { Component, computed, effect, EventEmitter, HostListener, inject, Input, OnChanges, OnDestroy, Output, signal, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { DrawerService, facturaEstado, FacturaResponseUpdateDTO, FacturaType, NotificationSocketService } from 'shared-utils';
import { FacturaSidebarContentComponent, FacturaSidebarEvent } from '../factura-sidebar-content/factura-sidebar-content.component';

/** Estados en los que el adjunto principal se carga de forma eager al cargar la factura */
const EAGER_PRESIGN_STATES = new Set<string>([
  facturaEstado.PENDIENTE_VALIDACION,
  facturaEstado.PENDIENTE_AUTORIZACION,
]);

interface FacturaFieldEditable {
  id: string;
  label: string;
  value: string;
  draftValue: string;
  detectedOptions: string[];
  usingCustomValue: boolean;
  editing: boolean;
  validated: boolean;
}

// Tipos de adjunto soportados por el sistema
export interface AdjuntoItem {
  /** Identificador único del adjunto (assetId o correlationId temporal) */
  id: string;
  /** Nombre descriptivo del archivo */
  nombre: string;
  /** Tipo semántico del documento (para la UI) */
  tipo: AdjuntoTipo;
  /** MIME type del archivo */
  mediaType: string;
  /** URL de acceso al recurso */
  url: string;
  /** Ícono de Material Icons según el mediaType */
  mediaIcon: string;
  /** Fecha de subida (ISO string, opcional) */
  fecha?: string;
}

export type AdjuntoTipo =
  | 'Factura original'
  | 'Respaldo'
  | 'Documento legal'
  | 'Imagen'
  | 'Otro';

/** Tipos de media admitidos por el visor de adjuntos */
export const SUPPORTED_MEDIA_TYPES: Record<string, { label: string; icon: string; tipo: AdjuntoTipo }> = {
  'application/pdf':  { label: 'PDF',   icon: 'picture_as_pdf', tipo: 'Respaldo' },
  'image/jpeg':       { label: 'JPEG',  icon: 'image',          tipo: 'Imagen' },
  'image/png':        { label: 'PNG',   icon: 'image',          tipo: 'Imagen' },
  'image/webp':       { label: 'WEBP',  icon: 'image',          tipo: 'Imagen' },
};

function resolveMediaIcon(mediaType: string): string {
  return SUPPORTED_MEDIA_TYPES[mediaType]?.icon ?? 'attach_file';
}

function resolveMediaTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.pdf'))  return 'application/pdf';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.png'))  return 'image/png';
  if (lower.startsWith('data:image/')) {
    const match = url.match(/^data:(image\/[a-z]+);/);
    return match?.[1] ?? 'image/jpeg';
  }
  return 'image/jpeg';
}

interface FacturaFieldUpdateEvent {
  factura: FacturaType;
  campoNombre: string;
  value: string;
  onResponse: (response: FacturaResponseUpdateDTO) => void;
  onError: () => void;
}

export interface FacturaConfirmRequestEvent {
  type: string;
  data: {
    factura: FacturaType;
    onCompleted: (result: { authorized: boolean; updated: boolean; status: facturaEstado }) => void;
  }
}

export interface FacturaRespaldoRequestEvent {
  factura: FacturaType;
}

@Component({
  selector: 'app-factura-view',
  templateUrl: './factura-view.component.html',
  styleUrl: './factura-view.component.scss',
  standalone: false
})
export class FacturaViewComponent implements OnChanges, OnDestroy {
  readonly otherValueOption = '__other_value__';
  readonly selectPlaceholderLabel = 'Seleccione una opción';
  readonly pendingValidationLabel = 'VALIDAR DATO';
  private readonly notificationSocketService = inject(NotificationSocketService);
  private readonly drawerService = inject(DrawerService);
  private readonly http = inject(HttpClient);
  private readonly receivedSocketCorrelationIds = new Set<string>();
  /**
   * Caché de blob: URLs locales: assetId → blobUrl.
   * Los blob URLs son: solo válidos en esta pestaña, no compartibles,
   * y se destruyen al llamar URL.revokeObjectURL().
   * La URL de MinIO nunca llega al frontend.
   */
  private readonly blobUrlCache = new Map<string, string>();
  private splitLoadingTimeout?: ReturnType<typeof setTimeout>;
  private drawerSub?: Subscription;

  @Input() factura: FacturaType = {} as FacturaType;
  @Output() facturaChange = new EventEmitter<FacturaFieldUpdateEvent>();
  @Output() confirmFacturaRequest = new EventEmitter<FacturaConfirmRequestEvent>();
  @Output() uploadRespaldoRequest = new EventEmitter<FacturaRespaldoRequestEvent>();

  readonly panelOpenState = signal(false);
  readonly imageSrc = signal<string | undefined>(undefined);
  readonly imageName = signal<string>('');
  readonly showPdfView = signal(true);
  readonly splitLayoutLoading = signal(false);
  readonly isMobileView = signal(false);
  readonly pendingFieldId = signal<string | null>(null);

  /** Adjunto actualmente seleccionado para visualizar en el panzoom viewer */
  readonly selectedAdjuntoId = signal<string | null>(null);
  /** ID del adjunto cuya URL prefirmada se está obteniendo (para mostrar spinner en el ítem) */
  readonly loadingAdjuntoId = signal<string | null>(null);

  /**
   * Lista de adjuntos disponibles para esta factura.
   * Por ahora deriva de los datos actuales del modelo (assetId / url_factura).
   * Cuando el backend exponga un endpoint de adjuntos, este computed se
   * reemplazará por una señal cargada asincrónicamente.
   */
  readonly adjuntosList = computed<AdjuntoItem[]>(() => {
    const facturaAdjuntos = (this.facturaOriginal() as any).adjuntos as FacturaAdjuntoType[] | undefined;
    if (!facturaAdjuntos?.length) return [];

    return facturaAdjuntos.map(adj => {
      let tipo: AdjuntoTipo = 'Otro';
      switch (adj.tipo) {
        case 'DTE-factura-respaldo':
        case 'DTE-factura':
          tipo = 'Factura original';
          break;
        case 'DTE-respaldo':
          tipo = 'Respaldo';
          break;
      }
      const url = adj.url_path || '';
      const mediaType = resolveMediaTypeFromUrl(url);
      return {
        id: adj.asset_id || 'factura-original',
        nombre: adj.descripcion || 'Adjunto',
        tipo,
        mediaType,
        mediaIcon: resolveMediaIcon(mediaType),
        url,
      } as AdjuntoItem;
    });
  });

  readonly estadoFactura = signal('En validacion');
  readonly estadoConfirmado = signal(false);
  readonly ofertasFactura = signal(0);
  readonly notificacionesFactura = signal<string[]>([
    'Esta herramienta es automatizada, puede contener errores.',
    'Si subio un documento, revise que los datos estan correctos.',
    'Valide cada campo antes de publicar.',
  ]);

  readonly facturaOriginal = signal<FacturaType>({
    facturaId: '',
    assetId: '',
    ownerUUID: '',
    gestor: {
      uuid: '',
      username: ''
    },
    nombre_cliente_cedente: 'Cliente Cedente S.A.',
    rut_cliente_cedente: '11.111.111-1',
    deudorNombre: 'Deudor S.A.',
    deudorRut: '11.111.111-1',
    facturaNumero: 'folio-123',
    montoTotal: 0,
    fechaVencimiento: new Date(),
    status: 'PENDIENTE_VALIDACION',
    correlationId: '',
    url_factura: '',
    createdBy: 'FORM',
    total_ofertas: 0,
    ofertas_enviadas: 0,
    ofertas_revisadas: 0,
    ofertas_aceptadas: 0,
    ofertas_rechazadas: 0,
    notas: []
  } as FacturaType);

  readonly camposFactura = signal<FacturaFieldEditable[]>([]);

  readonly notificationCount = computed(() => this.notificacionesFactura().length);
  readonly ofertasCount = computed(() => this.ofertasFactura());

  constructor() {
    this.updateViewportMode();
    this.camposFactura.set(this.buildFields(this.facturaOriginal()));

    effect(() => {
      const correlationId = this.facturaOriginal().correlationId;
      const notifications = this.notificationSocketService.notifications();

      if (!correlationId || !notifications.length) {
        return;
      }

      const hasMatchingNotification = notifications.some(item => this.matchesCorrelationId(item, correlationId));
      if (!hasMatchingNotification) {
        return;
      }

      this.receivedSocketCorrelationIds.add(correlationId);
      this.splitLayoutLoading.set(false);
      this.clearSplitLoadingTimeout();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['factura'] && this.factura) {
      const updatedFactura = changes['factura'].currentValue as FacturaType;
      // Limpiar blob URLs previos al cambiar de factura (liberar memoria)\n      this.blobUrlCache.forEach(url => URL.revokeObjectURL(url));\n      this.blobUrlCache.clear();
      this.loadingAdjuntoId.set(null);
      this.facturaOriginal.set(updatedFactura);
      this.estadoFactura.set(this.prettyStatus(updatedFactura.status));
      this.estadoConfirmado.set(false);
      this.ofertasFactura.set(this.readOffersCount(updatedFactura));
      this.initializeSplitLayoutLoading(updatedFactura);
      void this.resolveImageSource(updatedFactura);
      this.camposFactura.set(this.buildFields(updatedFactura));

      if (updatedFactura.notas?.length) {
        this.notificacionesFactura.set(updatedFactura.notas);
      }

      if (!this.isPendingValidation || this.isMobileView()) {
        this.showPdfView.set(false);
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateViewportMode();
  }

  ngOnDestroy(): void {
    this.clearSplitLoadingTimeout();
    this.drawerSub?.unsubscribe();
    // Liberar todos los blob URLs para evitar memory leaks
    this.blobUrlCache.forEach(url => URL.revokeObjectURL(url));
    this.blobUrlCache.clear();
  }

  get panelTitleStatus(): string {
    return `${this.estadoFactura()}`;
  }

  get panelStatusClass(): string {
    if (this.estadoConfirmado()) {
      return 'status-confirmada';
    }

    return this.statusClassFromRaw(this.facturaOriginal().status);
  }

  get panelDescriptionSummary(): string[] {
    const factura = this.facturaOriginal();
    const numeroFactura = this.getFieldDisplayValue('numeroFactura', factura.facturaNumero || 'Sin numero');
    const deudorNombre = this.getFieldDisplayValue('nombreRazonSocialDeudor', factura.deudorNombre || 'Sin deudor');
    const montoTotal = this.getFieldDisplayValue('montoTotal', this.formatCurrency(factura.montoTotal || 0));
    if (this.isMobileView()) {
      return [`N° ${numeroFactura}`];
    }
    return [`N° ${numeroFactura}`, `${deudorNombre}`, `${montoTotal}`];

  }

  get canConfirmFactura(): boolean {
    return this.camposFactura().length > 0
      && this.camposFactura().every(field => field.validated && !field.editing);
  }

  get isPendingValidation(): boolean {
    return this.facturaOriginal().status === facturaEstado.PENDIENTE_VALIDACION
      || this.facturaOriginal().status === facturaEstado.PENDIENTE_AUTORIZACION
      || this.facturaOriginal().status === facturaEstado.RECHAZADA;
  }

  get isPendingAutorizacion(): boolean {
    return this.facturaOriginal().status === facturaEstado.PENDIENTE_AUTORIZACION;
  }

  get isRechazada(): boolean {
    return this.facturaOriginal().status === facturaEstado.RECHAZADA;
  }

  get hasPendingOcrNotes(): boolean {
    return (this.facturaOriginal().notas?.length ?? 0) > 0;
  }

  get canValidarYPublicar(): boolean {
    return this.isPendingAutorizacion && !this.hasPendingOcrNotes;
  }

  get canShowPdfViewer(): boolean {
    return this.isPendingValidation && !this.splitLayoutLoading();
  }

  get hasFacturaAssetAnexo(): boolean {
    const factura = this.facturaOriginal();
    const assetId = String(factura.assetId ?? '').trim();
    if (assetId) {
      return true;
    }

    const source = this.extractImageSourceFromFactura(factura);
    return !!source;
  }

  get canUploadRespaldo(): boolean {
    const factura = this.facturaOriginal();

    return [facturaEstado.PENDIENTE_VALIDACION, facturaEstado.PENDIENTE_AUTORIZACION, facturaEstado.PUBLICADA, facturaEstado.RECHAZADA].includes(factura.status) && factura.createdBy === 'FORM';
  }

  get facturaNumeroHeader(): string {
    return this.getFieldDisplayValue('numeroFactura', this.facturaOriginal().facturaNumero || 'Sin numero');
  }

  get clienteCedenteNombreHeader(): string {
    return this.resolveHeaderValue(this.facturaOriginal().nombre_cliente_cedente, 'Sin cliente cedente');
  }

  get clienteCedenteRutHeader(): string {
    const rawRut = this.resolveHeaderValue(this.facturaOriginal().rut_cliente_cedente, '');
    if (!rawRut) {
      return 'Sin RUT cliente cedente';
    }

    const formatted = this.formatRut(rawRut);
    return formatted || 'Sin RUT mandante';
  }

  get gestorNombreHeader(): string {
    return this.resolveHeaderValue(this.facturaOriginal().gestor?.username, 'Sin gestor');
  }

  get pdfInputId(): string {
    const seed = this.facturaOriginal().assetId || this.facturaOriginal().facturaNumero || 'factura';
    return `pdf-input-${seed.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }

  toggleNotificationSidebar(): void {
    if (this.drawerService.config()) {
      this.drawerService.close();
      return;
    }
    this.drawerSub?.unsubscribe();
    this.drawerSub = this.drawerService.open<
      import('../factura-sidebar-content/factura-sidebar-content.component').FacturaSidebarInputs,
      FacturaSidebarEvent
    >({
      title: 'Detalle de factura',
      component: FacturaSidebarContentComponent,
      inputs: {
        factura: this.facturaOriginal(),
        estadoFactura: this.estadoFactura(),
        ofertasCount: this.ofertasFactura(),
        notificaciones: this.notificacionesFactura(),
      },
      width: '440px',
    }).subscribe(event => {
      if (event.type === 'CLOSE') this.drawerService.close();
    });
  }

  closeNotificationSidebar(): void {
    this.drawerService.close();
  }

  validarYPublicar(): void {
    if (!this.canValidarYPublicar) {
      return;
    }

    this.confirmFacturaRequest.emit({
      type: 'validar',
      data: {
        factura: this.facturaOriginal(),
        onCompleted: (result) => {
          if (!result.updated) {
            return;
          }
          this.estadoConfirmado.set(true);
          this.estadoFactura.set(this.prettyStatus(result.status));
          this.facturaOriginal.update(current => ({ ...current, status: result.status }));
        }
      }
    });
  }

  corregirYReenviar(): void {
    this.confirmFacturaRequest.emit({
      type: 'corregir',
      data: {
        factura: this.facturaOriginal(),
        onCompleted: (result) => {
          if (!result.updated) {
            return;
          }
          this.estadoFactura.set(this.prettyStatus(result.status));
          this.facturaOriginal.update(current => ({ ...current, status: result.status }));
        }
      }
    });
  }

  togglePdfView(): void {
    if (!this.imageSrc()) {
      return;
    }

    this.showPdfView.update(value => !value);
  }

  requestUploadRespaldo(): void {
    if (!this.canUploadRespaldo) {
      return;
    }

    this.uploadRespaldoRequest.emit({
      factura: this.facturaOriginal()
    });
  }

  trackByCampoId(index: number, field: FacturaFieldEditable): string {
    return field.id || String(index);
  }

  trackByAdjuntoId(_index: number, adj: AdjuntoItem): string {
    return adj.id;
  }

  /**
   * Selecciona un adjunto para visualizarlo en el panel panzoom.
   * Descarga el contenido vía BFF (proxy seguro) y crea un blob: URL local.
   * La URL de MinIO nunca llega al frontend — el blob: URL es no compartible
   * y se destruye al revocar o al cerrar la pestaña.
   */
  async selectAdjunto(adj: AdjuntoItem): Promise<void> {
    this.selectedAdjuntoId.set(adj.id);
    this.imageName.set(adj.nombre);
    if (!this.showPdfView()) this.showPdfView.set(true);

    // Cache hit: blob URL local ya válido para esta sesión
    const cached = this.blobUrlCache.get(adj.id);
    if (cached) {
      this.imageSrc.set(cached);
      return;
    }

    // Fetch vía BFF (proxy) — el BFF valida sesión y devuelve los bytes
    this.loadingAdjuntoId.set(adj.id);
    this.imageSrc.set(undefined);
    try {
      const blob = await firstValueFrom(
        this.http.get(
          `/api/bff/object/${adj.id}/view`,
          { params: { orgUuid: this.facturaOriginal().ownerUUID }, responseType: 'blob', withCredentials: true },
        ),
      );
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrlCache.set(adj.id, blobUrl);
      this.imageSrc.set(blobUrl);
    } catch {
      this.imageSrc.set(undefined);
    } finally {
      this.loadingAdjuntoId.set(null);
    }
  }

  onPrimaryAction(fieldId: string, event: Event): void {
    event.stopPropagation();

    if (this.pendingFieldId() === fieldId) {
      return;
    }

    const field = this.camposFactura().find(item => item.id === fieldId);
    if (!field) {
      return;
    }

    if (field.editing) {
      this.validateField(fieldId, event);
      return;
    }

    this.editField(fieldId);
  }

  primaryActionTitle(field: FacturaFieldEditable): string {
    if (this.isFieldSaving(field)) {
      return 'Esperando respuesta del backend';
    }

    return field.editing ? 'Guardar y validar fila' : 'Editar fila';
  }

  primaryActionIcon(field: FacturaFieldEditable): string {
    if (this.isFieldSaving(field)) {
      return 'autorenew';
    }

    return field.editing ? 'check_circle' : 'edit';
  }

  isFieldSaving(field: FacturaFieldEditable): boolean {
    return this.pendingFieldId() === field.id;
  }

  onDetectedOptionSelected(fieldId: string, selectedValue: string): void {
    this.camposFactura.update(fields =>
      fields.map(field => {
        if (field.id !== fieldId) {
          return field;
        }

        if (selectedValue === this.otherValueOption) {
          return {
            ...field,
            usingCustomValue: true,
            draftValue: ''
          };
        }

        return {
          ...field,
          usingCustomValue: false,
          draftValue: selectedValue
        };
      })
    );
  }

  editField(fieldId: string): void {
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? {
            ...field,
            editing: true,
            draftValue: field.id === 'fechaVencimiento'
              ? this.toDateInputValue(field.value)
              : field.value,
            usingCustomValue: field.detectedOptions.length > 1
              ? !!field.value && !field.detectedOptions.includes(field.value)
              : false,
            validated: false
          }
          : { ...field, editing: false, usingCustomValue: false }
      )
    );
  }

  cancelField(fieldId: string, event: Event): void {
    event.stopPropagation();
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? { ...field, editing: false, draftValue: field.value, usingCustomValue: false }
          : field
      )
    );
  }

  updateDraftValue(fieldId: string, value: string): void {
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? { ...field, draftValue: value }
          : field
      )
    );
  }

  onMontoDraftInput(fieldId: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const numericText = String(target.value ?? '').replace(/\D+/g, '');

    if (!numericText) {
      this.updateDraftValue(fieldId, '');
      target.value = '';
      return;
    }

    const numericValue = Number.parseInt(numericText, 10);
    const formatted = Number.isFinite(numericValue) ? new Intl.NumberFormat('es-CL').format(numericValue) : '';
    this.updateDraftValue(fieldId, formatted);
    target.value = formatted;
  }

  onRutDraftInput(fieldId: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const formatted = this.formatRut(target.value ?? '');
    this.updateDraftValue(fieldId, formatted);
    target.value = formatted;
  }

  getDatepickerValue(value: string): Date | null {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue || normalizedValue === '-') {
      return null;
    }

    const parsedDate = this.parseDateFromDisplay(normalizedValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate;
  }

  onDatePickerChange(fieldId: string, value: Date | null): void {
    if (!value) {
      this.updateDraftValue(fieldId, '');
      return;
    }

    this.updateDraftValue(fieldId, this.formatDateForInput(value));
  }

  validateField(fieldId: string, event: Event): void {
    event.stopPropagation();

    if (this.pendingFieldId() === fieldId) {
      return;
    }

    const targetField = this.camposFactura().find(field => field.id === fieldId);
    if (!targetField || this.isInvalidSelectionForValidation(targetField)) {
      return;
    }

    const resolvedValue = this.resolveValidatedValue(targetField);
    this.pendingFieldId.set(fieldId);

    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId && field.editing
          ? {
            ...field,
            editing: false,
            validated: false,
            usingCustomValue: false
          }
          : field
      )
    );

    this.syncFacturaFromField(fieldId, resolvedValue);
  }

  confirmFactura(): void {
    if (!this.canConfirmFactura) {
      return;
    }

    this.confirmFacturaRequest.emit(
      {
        type: 'confirmar',
        data: {
          factura: this.facturaOriginal(),
          onCompleted: (result) => {
            if (!result.updated) {
              return;
            }

            this.estadoConfirmado.set(true);
            this.estadoFactura.set(this.prettyStatus(result.status));
            this.facturaOriginal.update(current => ({ ...current, status: result.status }));
          }
        }
      }
    );
  }

  private buildFields(factura: FacturaType): FacturaFieldEditable[] {
    const fecha = this.toDate(factura.fechaVencimiento);
    return [
      this.createEditableField('numeroFactura', 'Numero de factura', factura.facturaNumero),
      this.createEditableField('rutDeudor', 'RUT deudor', factura.deudorRut),
      this.createEditableField('nombreRazonSocialDeudor', 'Razon social deudor', factura.deudorNombre),
      this.createEditableField('montoTotal', 'Monto total', this.formatCurrency(factura.montoTotal || 0)),
      this.createEditableField('fechaVencimiento', 'Fecha de vencimiento', this.formatDate(fecha))
    ];
  }

  private createEditableField(id: string, label: string, rawValue: unknown): FacturaFieldEditable {
    const normalizedRaw = String(rawValue ?? '').trim();
    const detectedOptions = this.extractDetectedOptions(normalizedRaw);
    const initialValue = detectedOptions.length > 1
      ? ''
      : (normalizedRaw || '-');

    return {
      id,
      label,
      value: initialValue,
      draftValue: initialValue === '-' ? '' : initialValue,
      detectedOptions,
      usingCustomValue: false,
      editing: false,
      validated: detectedOptions.length <= 1
    };
  }

  private extractDetectedOptions(value: string): string[] {
    if (!value.includes(';')) {
      return [];
    }

    const options = value
      .split(';')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    return Array.from(new Set(options));
  }

  private toDate(value: Date | string): Date {
    if (typeof value === 'string') {
      const fromDateOnlyText = this.parseDateFromInput(value);
      if (fromDateOnlyText) {
        return fromDateOnlyText;
      }

      const isoDateMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
      if (isoDateMatch) {
        const year = Number.parseInt(isoDateMatch[1], 10);
        const month = Number.parseInt(isoDateMatch[2], 10) - 1;
        const day = Number.parseInt(isoDateMatch[3], 10);
        return this.createSafeLocalDate(year, month, day);
      }
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  private prettyStatus(status?: string): string {
    if (!status) {
      return 'Sin estado';
    }

    return status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  private statusClassFromRaw(status?: string): string {
    switch (status) {
      case 'PROCESANDO':
        return 'status-procesando';
      case 'PENDIENTE_AUTORIZACION':
        return 'status-pendiente-auth';
      case 'PUBLICADA':
        return 'status-publicada';
      case 'OFERTADA':
        return 'status-ofertada';
      case 'FINANCIADA':
        return 'status-financiada';
      case 'PAGADA':
        return 'status-pagada';
      case 'RECHAZADA':
        return 'status-rechazada';
      case 'CANCELADA':
      case 'DENUNCIADA':
        return 'status-alerta';
      case 'VENCIDA':
        return 'status-vencida';
      case 'PENDIENTE_VALIDACION':
      default:
        return 'status-pendiente';
    }
  }

  private readOffersCount(factura: FacturaType): number {
    const dynamicFactura = factura as FacturaType & {
      ofertas?: number | string;
      ofertasCount?: number | string;
      totalOfertas?: number | string;
      total_ofertas?: number | string;
      ofertas_enviadas?: number | string;
      ofertas_revisadas?: number | string;
      ofertas_aceptadas?: number | string;
      ofertas_rechazadas?: number | string;
    };

    const counters = [
      dynamicFactura.ofertas,
      dynamicFactura.ofertasCount,
      dynamicFactura.totalOfertas,
      dynamicFactura.total_ofertas,
      dynamicFactura.ofertas_enviadas,
      dynamicFactura.ofertas_revisadas,
      dynamicFactura.ofertas_aceptadas,
      dynamicFactura.ofertas_rechazadas
    ]
      .map(value => this.parseCounterValue(value))
      .filter(value => value !== null) as number[];

    if (!counters.length) {
      return 0;
    }

    return Math.max(...counters);
  }

  private parseCounterValue(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.max(0, value) : null;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    }

    return null;
  }

  private getFieldDisplayValue(fieldId: string, fallbackValue: string): string {
    const field = this.camposFactura().find(item => item.id === fieldId);

    if (!field) {
      return fallbackValue;
    }

    if (field.detectedOptions.length > 1 && !field.validated) {
      return this.pendingValidationLabel;
    }

    return field.value || fallbackValue;
  }

  private resolveHeaderValue(rawValue: unknown, fallbackValue: string): string {
    const normalized = String(rawValue ?? '').trim();
    if (!normalized) {
      return fallbackValue;
    }

    const firstOption = normalized
      .split(';')
      .map(item => item.trim())
      .find(item => item.length > 0);

    return firstOption || fallbackValue;
  }

  private isInvalidSelectionForValidation(field: FacturaFieldEditable): boolean {
    return field.detectedOptions.length > 1
      && !field.usingCustomValue
      && !field.draftValue.trim();
  }

  private syncFacturaFromField(fieldId: string, resolvedValue: string): void {
    const field = this.camposFactura().find(item => item.id === fieldId);
    if (!field || !field.validated) {
      // Continua con el request porque el campo queda no validado mientras espera respuesta.
    }
    this.facturaChange.emit({
      factura: this.facturaOriginal(),
      campoNombre: fieldId,
      value: resolvedValue,
      onResponse: (response: FacturaResponseUpdateDTO) => this.onFieldUpdateSuccess(fieldId, resolvedValue, response),
      onError: () => this.onFieldUpdateError(fieldId)
    });
  }

  private onFieldUpdateSuccess(fieldId: string, requestedValue: string, response: FacturaResponseUpdateDTO): void {
    const responseAccepted = this.isUpdateAccepted(response);
    if (!responseAccepted) {
      this.onFieldUpdateError(fieldId);
      return;
    }

    const responseFieldId = this.normalizeBackendFieldId(String(response?.campo ?? ''));
    const targetFieldId = responseFieldId || fieldId;
    const responseValue = (response as unknown as Record<string, unknown>)['valor'];
    const displayValue = this.formatFieldDisplayValue(targetFieldId, responseValue, requestedValue);

    this.applyFieldValue(targetFieldId, displayValue);
    this.pendingFieldId.set(null);
  }

  private onFieldUpdateError(fieldId: string): void {
    this.pendingFieldId.set(null);
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? { ...field, editing: true, validated: false }
          : field
      )
    );
  }

  private applyFieldValue(fieldId: string, displayValue: string): void {
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? {
            ...field,
            value: displayValue,
            draftValue: fieldId === 'fechaVencimiento' ? this.toDateInputValue(displayValue) : displayValue,
            editing: false,
            validated: true,
            usingCustomValue: false
          }
          : field
      )
    );

    this.facturaOriginal.update(currentFactura => {
      switch (fieldId) {
        case 'numeroFactura':
          return { ...currentFactura, facturaNumero: displayValue };
        case 'rutDeudor':
          return { ...currentFactura, deudorRut: displayValue };
        case 'nombreRazonSocialDeudor':
          return { ...currentFactura, deudorNombre: displayValue };
        case 'montoTotal':
          return { ...currentFactura, montoTotal: this.parseCurrencyToNumber(displayValue) };
        case 'fechaVencimiento':
          return { ...currentFactura, fechaVencimiento: this.parseDateFromDisplay(displayValue) };
        default:
          return currentFactura;
      }
    });
  }

  private isUpdateAccepted(response: FacturaResponseUpdateDTO | undefined): boolean {
    if (!response) {
      return false;
    }

    return response.isUpdate === true || response.isUpdate === 'true' || response.isUpdate === 1 || response.isUpdate === '1';
  }

  private normalizeBackendFieldId(rawField: string): string {
    const normalized = rawField.trim();
    const mapping: Record<string, string> = {
      numeroFactura: 'numeroFactura',
      facturaNumero: 'numeroFactura',
      rutDeudor: 'rutDeudor',
      deudorRut: 'rutDeudor',
      nombreRazonSocialDeudor: 'nombreRazonSocialDeudor',
      deudorNombre: 'nombreRazonSocialDeudor',
      montoTotal: 'montoTotal',
      fechaVencimiento: 'fechaVencimiento'
    };

    return mapping[normalized] || '';
  }

  private formatFieldDisplayValue(fieldId: string, rawValue: unknown, fallbackValue: string): string {
    const rawText = String(rawValue ?? '').trim();
    const value = rawText || fallbackValue;

    switch (fieldId) {
      case 'montoTotal':
        return this.formatCurrency(value);
      case 'fechaVencimiento':
        return this.formatDate(this.parseDateFromDisplay(value));
      default:
        return value;
    }
  }

  private parseCurrencyToNumber(value: string): number {
    const numericValue = value.replace(/[^0-9-]/g, '');
    const parsed = Number.parseInt(numericValue, 10);

    if (Number.isNaN(parsed)) {
      return 0;
    }

    return parsed;
  }

  private formatRut(value: string): string {
    const cleaned = String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

    if (!cleaned) {
      return '';
    }

    if (cleaned.length === 1) {
      return cleaned;
    }

    const dv = cleaned.slice(-1);
    const body = cleaned.slice(0, -1);
    const bodyWithDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${bodyWithDots}-${dv}`;
  }

  private parseDateFromDisplay(value: string): Date {
    const normalizedValue = String(value ?? '').trim();

    const inputLikeDate = this.parseDateFromInput(normalizedValue);
    if (inputLikeDate) {
      return inputLikeDate;
    }

    const isoDateMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
    if (isoDateMatch) {
      const year = Number.parseInt(isoDateMatch[1], 10);
      const month = Number.parseInt(isoDateMatch[2], 10) - 1;
      const day = Number.parseInt(isoDateMatch[3], 10);

      if (!Number.isNaN(day) && !Number.isNaN(month) && !Number.isNaN(year)) {
        return this.createSafeLocalDate(year, month, day);
      }
    }

    const dateParts = normalizedValue.split(/[\/\-.]/).map(part => part.trim());
    if (dateParts.length === 3) {
      const day = Number.parseInt(dateParts[0], 10);
      const month = Number.parseInt(dateParts[1], 10) - 1;
      const year = Number.parseInt(dateParts[2], 10);

      if (!Number.isNaN(day) && !Number.isNaN(month) && !Number.isNaN(year)) {
        return this.createSafeLocalDate(year, month, day);
      }
    }

    return this.toDate(normalizedValue);
  }

  private resolveValidatedValue(field: FacturaFieldEditable): string {
    const draft = field.draftValue.trim();
    if (!draft) {
      return field.value;
    }

    if (field.id === 'montoTotal') {
      return String(this.parseCurrencyToNumber(draft));
    }

    if (field.id === 'fechaVencimiento') {
      return this.formatDate(this.parseDateFromDisplay(draft));
    }

    return draft;
  }

  private toDateInputValue(displayValue: string): string {
    const trimmed = String(displayValue ?? '').trim();
    if (!trimmed || trimmed === '-') {
      return '';
    }

    const parsedDate = this.parseDateFromDisplay(trimmed);
    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }

    return this.formatDateForInput(parsedDate);
  }

  private parseDateFromInput(value: string): Date | null {
    const normalized = String(value ?? '').trim();
    const inputMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!inputMatch) {
      return null;
    }

    const year = Number.parseInt(inputMatch[1], 10);
    const month = Number.parseInt(inputMatch[2], 10) - 1;
    const day = Number.parseInt(inputMatch[3], 10);
    const date = this.createSafeLocalDate(year, month, day);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  private createSafeLocalDate(year: number, month: number, day: number): Date {
    // Use noon local time to avoid day shifts caused by timezone/UTC serialization.
    return new Date(year, month, day, 12, 0, 0, 0);
  }

  private formatDateForInput(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatCurrency(number: number | string): string {
    let value = Number(number);
    if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
      return '-';
    }
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(value);
  }

  private formatDate(value: Date): string {
    return new Intl.DateTimeFormat('es-CL').format(value);
  }

  private initializeSplitLayoutLoading(factura: FacturaType): void {
    if (factura.status !== 'PENDIENTE_VALIDACION') {
      this.splitLayoutLoading.set(false);
      this.clearSplitLoadingTimeout();
      return;
    }

    const correlationId = factura.correlationId?.trim();
    if (!correlationId) {
      this.splitLayoutLoading.set(false);
      this.clearSplitLoadingTimeout();
      return;
    }

    if (this.receivedSocketCorrelationIds.has(correlationId)) {
      this.splitLayoutLoading.set(false);
      this.clearSplitLoadingTimeout();
      return;
    }

    this.splitLayoutLoading.set(true);
    this.clearSplitLoadingTimeout();
    this.splitLoadingTimeout = setTimeout(() => {
      this.splitLayoutLoading.set(false);
    }, 1000);
  }

  private clearSplitLoadingTimeout(): void {
    if (!this.splitLoadingTimeout) {
      return;
    }

    clearTimeout(this.splitLoadingTimeout);
    this.splitLoadingTimeout = undefined;
  }

  private async resolveImageSource(factura: FacturaType): Promise<void> {
    const adjuntos = (factura as any).adjuntos as FacturaAdjuntoType[] | undefined;
    const principal = adjuntos?.find(a => a.es_principal) ?? adjuntos?.[0];

    // Estados accionables: cargar el adjunto principal de forma eager vía proxy seguro
    if (principal?.asset_id && EAGER_PRESIGN_STATES.has(factura.status)) {
      // Mostrar URL de bucket mientras llega el blob (evita pantalla en blanco)
      if (principal.url_path) {
        this.imageSrc.set(principal.url_path);
        this.imageName.set(this.extractFileName(principal.url_path));
      }
      try {
        const blob = await firstValueFrom(
          this.http.get(
            `/api/bff/object/${principal.asset_id}/view`,
            { params: { orgUuid: factura.ownerUUID }, responseType: 'blob', withCredentials: true },
          ),
        );
        const blobUrl = URL.createObjectURL(blob);
        const prev = this.blobUrlCache.get(principal.asset_id);
        if (prev) URL.revokeObjectURL(prev);
        this.blobUrlCache.set(principal.asset_id, blobUrl);
        this.imageSrc.set(blobUrl);
        this.imageName.set(principal.descripcion || 'Factura');
        return;
      } catch {
        // Error al descargar: deja la URL de bucket como fallback (ya seteada arriba)
        return;
      }
    }

    // Estado no accionable o sin adjuntos: usar URL de bucket directamente
    if (principal?.url_path) {
      this.imageSrc.set(principal.url_path);
      this.imageName.set(this.extractFileName(principal.url_path));
      return;
    }

    // Fallback final: url_factura u otros campos del modelo
    const fromService = this.extractImageSourceFromFactura(factura);
    if (!fromService) return;
    this.imageSrc.set(fromService);
    this.imageName.set(this.extractFileName(fromService));
  }

  private extractImageSourceFromFactura(factura: FacturaType): string | undefined {
    const dynamicFactura = factura as FacturaType & {
      objectUrl?: string;
      pdfUrl?: string;
      documentUrl?: string;
      imageUrl?: string;
      webpUrl?: string;
    };

    const candidates = [
      dynamicFactura.webpUrl,
      dynamicFactura.imageUrl,
      dynamicFactura.objectUrl,
      dynamicFactura.pdfUrl,
      dynamicFactura.documentUrl,
      factura.url_factura
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (!value) {
        continue;
      }

      if (value.toUpperCase() === 'N/A') {
        continue;
      }

      const normalized = value.toLowerCase();
      const isUrl = normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('blob:') || normalized.startsWith('data:');
      const isPdfLike = normalized.includes('.pdf');
      const isImageLike = normalized.includes('.webp') || normalized.includes('.png') || normalized.includes('.jpg') || normalized.includes('.jpeg') || normalized.startsWith('data:image/');

      if (isUrl || isPdfLike || isImageLike) {
        return value;
      }
    }

    return undefined;
  }

  private extractFileName(source: string): string {
    const cleanValue = source.split('?')[0];
    const pieces = cleanValue.split('/').filter(part => part.length > 0);
    if (!pieces.length) {
      return 'factura.webp';
    }

    return pieces[pieces.length - 1];
  }

  private matchesCorrelationId(payload: unknown, correlationId: string): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const record = payload as Record<string, unknown>;
    const candidates = [record['correlationId'], record['correlation_id'], record['requestId']]
      .map(value => String(value ?? '').trim())
      .filter(value => value.length > 0);

    if (candidates.includes(correlationId)) {
      return true;
    }

    const nestedPayload = record['data'];
    if (nestedPayload && typeof nestedPayload === 'object') {
      return this.matchesCorrelationId(nestedPayload, correlationId);
    }

    return false;
  }

  private updateViewportMode(): void {
    if (typeof window === 'undefined') {
      this.isMobileView.set(false);
      return;
    }
    console.log('Window resized, updating mobile view state. Current width:', window.innerWidth);
    this.isMobileView.set(window.innerWidth <= 980);
  }
}
