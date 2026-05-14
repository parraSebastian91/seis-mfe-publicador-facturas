import { Component, computed, effect, EventEmitter, HostListener, inject, Input, OnChanges, OnDestroy, Output, signal, SimpleChanges } from '@angular/core';
import { FacturaType, NotificationSocketService } from 'shared-utils';

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
  private readonly receivedSocketCorrelationIds = new Set<string>();
  private splitLoadingTimeout?: ReturnType<typeof setTimeout>;

  @Input() factura: FacturaType = {} as FacturaType;
  @Output() facturaChange = new EventEmitter<{ factura: FacturaType, campoNombre: string, value: string }>();

  readonly panelOpenState = signal(false);
  readonly imageSrc = signal<string | undefined>(undefined);
  readonly imageName = signal<string>('');
  readonly showPdfView = signal(true);
  readonly splitLayoutLoading = signal(false);
  readonly isMobileView = signal(false);

  readonly estadoFactura = signal('En validacion');
  readonly estadoConfirmado = signal(false);
  readonly ofertasFactura = signal(0);
  readonly notificacionesFactura = signal<string[]>([
    'Monto total requiere revision por diferencias.',
    'RUT deudor validado contra padrón tributario.',
    'Fecha de vencimiento sugerida por OCR: 30-04-2026.'
  ]);

  readonly facturaOriginal = signal<FacturaType>({
    facturaId: '',
    assetId: '',
    ownerUUID: '',
    gestor: '',
    nombre_mandante: 'Mandante S.A.',
    rut_mandante: '11.111.111-1',
    deudorNombre: 'Deudor S.A.',
    deudorRut: '11.111.111-1',
    facturaNumero: 'folio-123',
    montoTotal: 0,
    fechaVencimiento: new Date(),
    status: 'PENDIENTE_VALIDACION',
    correlationId: '',
    storage_key: '',
    ofertas: '0'
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
      this.facturaOriginal.set(updatedFactura);
      this.estadoFactura.set(this.prettyStatus(updatedFactura.status));
      this.estadoConfirmado.set(false);
      this.ofertasFactura.set(this.readOffersCount(updatedFactura));
      this.initializeSplitLayoutLoading(updatedFactura);
      this.resolveImageSource(updatedFactura);
      this.camposFactura.set(this.buildFields(updatedFactura));

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
    if (this.isMobileView()){
      return [`N° ${numeroFactura}`,  `${montoTotal}`];
    }
    return [`N° ${numeroFactura}`, `${deudorNombre}`, `${montoTotal}`];

  }

  get canConfirmFactura(): boolean {
    return this.camposFactura().length > 0
      && this.camposFactura().every(field => field.validated && !field.editing);
  }

  get isPendingValidation(): boolean {
    return this.facturaOriginal().status === 'PENDIENTE_VALIDACION';
  }

  get canShowPdfViewer(): boolean {
    return this.isPendingValidation && !this.splitLayoutLoading();
  }

  get facturaNumeroHeader(): string {
    return this.getFieldDisplayValue('numeroFactura', this.facturaOriginal().facturaNumero || 'Sin numero');
  }

  get pdfInputId(): string {
    const seed = this.facturaOriginal().assetId || this.facturaOriginal().facturaNumero || 'factura';
    return `pdf-input-${seed.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }

  // onImageSelected(event: Event): void {
  //   const input = event.target as HTMLInputElement;
  //   const file = input.files?.[0];

  //   if (!file) {
  //     return;
  //   }

  //   if (!file.type.startsWith('image/')) {
  //     this.imageSrc.set(undefined);
  //     this.imageName.set('');
  //     input.value = '';
  //     return;
  //   }

  //   const reader = new FileReader();
  //   reader.onload = () => {
  //     const imageDataUrl = String(reader.result ?? '');
  //     this.imageSrc.set(imageDataUrl);
  //     this.imageName.set(file.name);
  //   };
  //   reader.readAsDataURL(file);
  // }

  togglePdfView(): void {
    if (!this.isPendingValidation) {
      return;
    }

    this.showPdfView.update(value => !value);
  }

  trackByCampoId(index: number, field: FacturaFieldEditable): string {
    return field.id || String(index);
  }

  onPrimaryAction(fieldId: string, event: Event): void {
    event.stopPropagation();
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
    return field.editing ? 'Guardar y validar fila' : 'Editar fila';
  }

  primaryActionIcon(field: FacturaFieldEditable): string {
    return field.editing ? 'check_circle' : 'edit';
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

  validateField(fieldId: string, event: Event): void {
    event.stopPropagation();

    const targetField = this.camposFactura().find(field => field.id === fieldId);
    if (!targetField || this.isInvalidSelectionForValidation(targetField)) {
      return;
    }

    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId && field.editing
          ? {
            ...field,
            value: this.resolveValidatedValue(field),
            editing: false,
            validated: true,
            usingCustomValue: false
          }
          : field
      )
    );



    this.syncFacturaFromField(fieldId);
  }

  confirmFactura(): void {
    if (!this.canConfirmFactura) {
      return;
    }

    this.estadoConfirmado.set(true);
    this.estadoFactura.set('Validada por usuario');
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
      case 'PUBLICADA':
        return 'status-publicada';
      case 'OFERTADA':
        return 'status-ofertada';
      case 'FINANCIADA':
        return 'status-financiada';
      case 'PAGADA':
        return 'status-pagada';
      case 'RECHAZADA':
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
    const maybeOferta = (factura as FacturaType & { ofertas?: number | string }).ofertas;

    if (typeof maybeOferta === 'number' && Number.isFinite(maybeOferta)) {
      return maybeOferta;
    }

    if (typeof maybeOferta === 'string') {
      const parsed = Number.parseInt(maybeOferta, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
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

  private isInvalidSelectionForValidation(field: FacturaFieldEditable): boolean {
    return field.detectedOptions.length > 1
      && !field.usingCustomValue
      && !field.draftValue.trim();
  }

  private syncFacturaFromField(fieldId: string): void {
    const field = this.camposFactura().find(item => item.id === fieldId);
    if (!field || !field.validated) {
      return;
    }
    // Nota: aqui es donde se enviara la actuyalizacion del campo al backend.  
    
    this.facturaChange.emit({factura: this.facturaOriginal(), campoNombre: fieldId, value: field.value});

    this.facturaOriginal.update(currentFactura => {
      switch (fieldId) {
        case 'numeroFactura':          
          return { ...currentFactura, facturaNumero: field.value };
        case 'rutDeudor':
          return { ...currentFactura, deudorRut: field.value };
        case 'nombreRazonSocialDeudor':
          return { ...currentFactura, deudorNombre: field.value };
        case 'montoTotal':
          return { ...currentFactura, montoTotal: this.parseCurrencyToNumber(field.value) };
        case 'fechaVencimiento':
          return { ...currentFactura, fechaVencimiento: this.parseDateFromDisplay(field.value) };
        default:
          return currentFactura;
      }
    });
  }

  private parseCurrencyToNumber(value: string): number {
    const numericValue = value.replace(/[^0-9-]/g, '');
    const parsed = Number.parseInt(numericValue, 10);

    if (Number.isNaN(parsed)) {
      return 0;
    }

    return parsed;
  }

  private parseDateFromDisplay(value: string): Date {
    const inputLikeDate = this.parseDateFromInput(value);
    if (inputLikeDate) {
      return inputLikeDate;
    }

    const dateParts = value.split(/[\/\-.]/).map(part => part.trim());
    if (dateParts.length === 3) {
      const day = Number.parseInt(dateParts[0], 10);
      const month = Number.parseInt(dateParts[1], 10) - 1;
      const year = Number.parseInt(dateParts[2], 10);

      if (!Number.isNaN(day) && !Number.isNaN(month) && !Number.isNaN(year)) {
        return new Date(year, month, day);
      }
    }

    return this.toDate(value);
  }

  private resolveValidatedValue(field: FacturaFieldEditable): string {
    const draft = field.draftValue.trim();
    if (!draft) {
      return field.value;
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
    const date = new Date(year, month, day);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
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

  private resolveImageSource(factura: FacturaType): void {
    const fromService = this.extractImageSourceFromFactura(factura);

    if (!fromService) {
      return;
    }

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
      factura.storage_key
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (!value) {
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
