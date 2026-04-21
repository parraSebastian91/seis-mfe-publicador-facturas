import { Component, computed, signal } from '@angular/core';

interface FacturaData {
  numeroFactura: string;
  rutDeudor: string;
  nombreRazonSocialDeudor: string;
  montoTotal: number;
  fechaVencimiento: string;
}

interface FacturaFieldEditable {
  id: string;
  label: string;
  value: string;
  draftValue: string;
  editing: boolean;
  validated: boolean;
}

@Component({
  selector: 'app-factura-view',
  templateUrl: './factura-view.component.html',
  styleUrl: './factura-view.component.scss',
  standalone: false
})
export class FacturaViewComponent {
  readonly panelOpenState = signal(false);
  readonly pdfSrc = signal<Uint8Array | undefined>(undefined);
  readonly pdfName = signal<string>('');
  readonly showPdfView = signal(true);

  readonly estadoFactura = signal('En validacion');
  readonly notificacionesFactura = signal<string[]>([
    'Monto total requiere revision por diferencias.',
    'RUT deudor validado contra padrón tributario.',
    'Fecha de vencimiento sugerida por OCR: 30-04-2026.'
  ]);

  readonly facturaOriginal = signal<FacturaData>({
    numeroFactura: 'F-2026-000145',
    rutDeudor: '76.123.456-7',
    nombreRazonSocialDeudor: 'Comercial San Martin SpA',
    montoTotal: 1250490,
    fechaVencimiento: '2026-04-30'
  });

  readonly camposFactura = signal<FacturaFieldEditable[]>([]);

  readonly notificationCount = computed(() => this.notificacionesFactura().length);

  constructor() {
    const original = this.facturaOriginal();

    this.camposFactura.set([
      {
        id: 'numeroFactura',
        label: 'Numero de factura',
        value: original.numeroFactura,
        draftValue: original.numeroFactura,
        editing: false,
        validated: true
      },
      {
        id: 'rutDeudor',
        label: 'RUT deudor',
        value: original.rutDeudor,
        draftValue: original.rutDeudor,
        editing: false,
        validated: true
      },
      {
        id: 'nombreRazonSocialDeudor',
        label: 'Nombre o razon social deudor',
        value: original.nombreRazonSocialDeudor,
        draftValue: original.nombreRazonSocialDeudor,
        editing: false,
        validated: false
      },
      {
        id: 'montoTotal',
        label: 'Monto total',
        value: this.formatCurrency(original.montoTotal),
        draftValue: this.formatCurrency(original.montoTotal),
        editing: false,
        validated: false
      },
      {
        id: 'fechaVencimiento',
        label: 'Fecha de vencimiento',
        value: this.formatDate(original.fechaVencimiento),
        draftValue: this.formatDate(original.fechaVencimiento),
        editing: false,
        validated: false
      }
    ]);
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

  editField(fieldId: string): void {
    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId
          ? { ...field, editing: true, draftValue: field.value, validated: false }
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

    this.camposFactura.update(fields =>
      fields.map(field =>
        field.id === fieldId && field.editing
          ? { ...field, value: field.draftValue.trim() || field.value, editing: false, validated: true }
          : field
      )
    );
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(value);
  }

  private formatDate(value: string): string {
    const date = new Date(value);
    return new Intl.DateTimeFormat('es-CL').format(date);
  }
}
