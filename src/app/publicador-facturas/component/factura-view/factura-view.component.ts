import { Component, computed, Input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { FacturaType } from 'shared-utils';

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
export class FacturaViewComponent implements OnChanges {
  readonly otherValueOption = '__other_value__';
  readonly selectPlaceholderLabel = 'Seleccione una opción';
  readonly pendingValidationLabel = 'VALIDAR DATO';

  @Input() factura: FacturaType = {} as FacturaType;

  readonly panelOpenState = signal(false);
  readonly pdfSrc = signal<Uint8Array | undefined>(undefined);
  readonly pdfName = signal<string>('');
  readonly showPdfView = signal(true);

  readonly estadoFactura = signal('En validacion');
  readonly estadoConfirmado = signal(false);
  readonly ofertasFactura = signal(0);
  readonly notificacionesFactura = signal<string[]>([
    'Monto total requiere revision por diferencias.',
    'RUT deudor validado contra padrón tributario.',
    'Fecha de vencimiento sugerida por OCR: 30-04-2026.'
  ]);

  readonly facturaOriginal = signal<FacturaType>({
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
    correlationId: ''
  } as FacturaType);

  readonly camposFactura = signal<FacturaFieldEditable[]>([]);

  readonly notificationCount = computed(() => this.notificacionesFactura().length);

  constructor() {
    this.camposFactura.set(this.buildFields(this.facturaOriginal()));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['factura'] && this.factura) {
      const updatedFactura = changes['factura'].currentValue as FacturaType;
      this.facturaOriginal.set(updatedFactura);
      this.estadoFactura.set(this.prettyStatus(updatedFactura.status));
      this.estadoConfirmado.set(false);
      this.ofertasFactura.set(this.readOffersCount(updatedFactura));
      this.camposFactura.set(this.buildFields(updatedFactura));
    }
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
    const ofertas = this.ofertasFactura();

    return [`N° ${numeroFactura}`, `${deudorNombre}`, `${montoTotal}`, `Ofertas: ${ofertas}`];

  }

  get canConfirmFactura(): boolean {
    return this.camposFactura().length > 0
      && this.camposFactura().every(field => field.validated && !field.editing);
  }

  get facturaNumeroHeader(): string {
    return this.getFieldDisplayValue('numeroFactura', this.facturaOriginal().facturaNumero || 'Sin numero');
  }

  get pdfInputId(): string {
    const seed = this.facturaOriginal().assetId || this.facturaOriginal().facturaNumero || 'factura';
    return `pdf-input-${seed.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }

  onPdfSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (file.type !== 'application/pdf') {
      this.pdfSrc.set(undefined);
      this.pdfName.set('');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      this.pdfSrc.set(new Uint8Array(buffer));
      this.pdfName.set(file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  togglePdfView(): void {
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
            draftValue: field.value,
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
            value: field.draftValue.trim() || field.value,
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
}
