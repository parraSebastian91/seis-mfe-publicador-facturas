import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

export interface FacturaManualFormValue {
  numeroFactura: string;
  rutDeudor: string;
  nombreRazonSocialDeudor: string;
  montoTotal: number;
  fechaVencimiento: string;
}

type ManualField = 'numeroFactura' | 'rutDeudor' | 'nombreRazonSocialDeudor' | 'montoTotal' | 'fechaVencimiento';

@Component({
  selector: 'app-modal-publicacion-factura',
  templateUrl: './modal-publicacion-factura.component.html',
  styleUrl: './modal-publicacion-factura.component.scss',
  standalone: false
})
export class ModalPublicacionFacturaComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() submitFile = new EventEmitter<File>();
  @Output() submitForm = new EventEmitter<FacturaManualFormValue>();

  activeTab: 'upload' | 'form' = 'upload';
  isDragging = false;
  selectedFile: File | null = null;

  manualForm = {
    numeroFactura: '',
    rutDeudor: '',
    nombreRazonSocialDeudor: '',
    montoTotal: '',
    fechaVencimiento: ''
  };

  touchedFields: Record<ManualField, boolean> = {
    numeroFactura: false,
    rutDeudor: false,
    nombreRazonSocialDeudor: false,
    montoTotal: false,
    fechaVencimiento: false
  };

  private readonly inputValidationDebounceMs = 300;
  private readonly touchDebounceTimers: Partial<Record<ManualField, ReturnType<typeof setTimeout>>> = {};

  readonly minDateStruct = this.toDateStruct(this.startOfToday());
  readonly suggestedDateIso = this.toIsoDate(this.plusDays(this.startOfToday(), 15));

  constructor() {
    this.manualForm.fechaVencimiento = this.suggestedDateIso;
  }

  get selectedFileName(): string {
    return this.selectedFile?.name || 'Ningun archivo seleccionado';
  }

  get isMobile(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia('(max-width: 767px)').matches;
  }

  onBackdropClick(): void {
    if (this.isSubmitting) {
      return;
    }

    this.close();
  }

  close(): void {
    this.closeModal.emit();
  }

  selectTab(tab: 'upload' | 'form'): void {
    this.activeTab = tab;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.isSubmitting) {
      return;
    }

    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;

    if (this.isSubmitting) {
      return;
    }

    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.selectedFile = file;
    }
  }

  onFileSelected(event: Event): void {
    if (this.isSubmitting) {
      return;
    }

    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (file) {
      this.selectedFile = file;
    }

    if (input) {
      input.value = '';
    }
  }

  submitSelectedFile(): void {
    if (!this.selectedFile || this.isSubmitting) {
      return;
    }

    this.submitFile.emit(this.selectedFile);
  }

  submitManualData(): void {
    this.markAllFieldsTouched();

    if (this.isSubmitting || !this.isManualFormValid()) {
      return;
    }

    this.submitForm.emit({
      numeroFactura: this.manualForm.numeroFactura.trim(),
      rutDeudor: this.manualForm.rutDeudor.trim(),
      nombreRazonSocialDeudor: this.manualForm.nombreRazonSocialDeudor.trim(),
      montoTotal: this.parseMonto(this.manualForm.montoTotal),
      fechaVencimiento: this.manualForm.fechaVencimiento
    });
  }

  markFieldTouched(field: ManualField): void {
    this.touchedFields[field] = true;
  }

  shouldShowFieldError(field: ManualField): boolean {
    return this.touchedFields[field] && !this.isFieldValid(field);
  }

  getFieldErrorMessage(field: ManualField): string {
    switch (field) {
      case 'numeroFactura':
        if (!this.manualForm.numeroFactura.trim()) {
          return 'El numero de factura es obligatorio.';
        }
        return 'Debe contener solo numeros, sin formato.';

      case 'rutDeudor':
        if (!this.manualForm.rutDeudor.trim()) {
          return 'El RUT deudor es obligatorio.';
        }
        return 'Formato esperado: xx.xxx.xxx-x.';

      case 'nombreRazonSocialDeudor':
        if (!this.manualForm.nombreRazonSocialDeudor.trim()) {
          return 'La razon social es obligatoria.';
        }
        return 'Debe tener al menos 5 caracteres.';

      case 'montoTotal':
        if (!this.manualForm.montoTotal.trim()) {
          return 'El monto total es obligatorio.';
        }
        return 'Debe ser numerico y mayor a 0.';

      case 'fechaVencimiento':
        if (!this.manualForm.fechaVencimiento.trim()) {
          return 'La fecha de vencimiento es obligatoria.';
        }
        return 'Debe ser hoy o una fecha posterior.';

      default:
        return 'Campo invalido.';
    }
  }

  onNumeroFacturaInput(event: Event): void {
    this.markFieldTouchedDebounced('numeroFactura');
    const target = event.target as HTMLInputElement;
    const digitsOnly = (target.value || '').replace(/\D+/g, '');
    this.manualForm.numeroFactura = digitsOnly;
    target.value = digitsOnly;
  }

  onRutInput(event: Event): void {
    this.markFieldTouchedDebounced('rutDeudor');
    const target = event.target as HTMLInputElement;
    const formatted = this.formatRut(target.value || '');
    this.manualForm.rutDeudor = formatted;
    target.value = formatted;
  }

  onNombreRazonSocialInput(): void {
    this.markFieldTouchedDebounced('nombreRazonSocialDeudor');
  }

  onMontoInput(event: Event): void {
    this.markFieldTouchedDebounced('montoTotal');
    const target = event.target as HTMLInputElement;
    const numericText = (target.value || '').replace(/\D+/g, '');

    if (!numericText) {
      this.manualForm.montoTotal = '';
      target.value = '';
      return;
    }

    const numericValue = Number.parseInt(numericText, 10);
    const formatted = Number.isFinite(numericValue) ? new Intl.NumberFormat('es-CL').format(numericValue) : '';
    this.manualForm.montoTotal = formatted;
    target.value = formatted;
  }

  isManualFormValid(): boolean {
    return this.isFieldValid('numeroFactura')
      && this.isFieldValid('rutDeudor')
      && this.isFieldValid('nombreRazonSocialDeudor')
      && this.isFieldValid('montoTotal')
      && this.isFieldValid('fechaVencimiento');
  }

  private isFieldValid(field: ManualField): boolean {
    switch (field) {
      case 'numeroFactura':
        return /^\d+$/.test(this.manualForm.numeroFactura.trim());

      case 'rutDeudor':
        return /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/.test(this.manualForm.rutDeudor.trim());

      case 'nombreRazonSocialDeudor':
        return this.manualForm.nombreRazonSocialDeudor.trim().length >= 5;

      case 'montoTotal':
        return this.parseMonto(this.manualForm.montoTotal) > 0;

      case 'fechaVencimiento':
        return this.isDateTodayOrLater(this.manualForm.fechaVencimiento);

      default:
        return false;
    }
  }

  private isDateTodayOrLater(value: string): boolean {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return false;
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    const parsed = new Date(year, month - 1, day);

    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
      return false;
    }

    return parsed.getTime() >= this.startOfToday().getTime();
  }

  private parseMonto(value: string): number {
    const digits = String(value ?? '').replace(/\D+/g, '');
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : 0;
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

  private markAllFieldsTouched(): void {
    this.touchedFields.numeroFactura = true;
    this.touchedFields.rutDeudor = true;
    this.touchedFields.nombreRazonSocialDeudor = true;
    this.touchedFields.montoTotal = true;
    this.touchedFields.fechaVencimiento = true;
  }

  private markFieldTouchedDebounced(field: ManualField): void {
    const existingTimer = this.touchDebounceTimers[field];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.touchDebounceTimers[field] = setTimeout(() => {
      this.markFieldTouched(field);
      this.touchDebounceTimers[field] = undefined;
    }, this.inputValidationDebounceMs);
  }

  private toDateStruct(value: Date): NgbDateStruct {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate()
    };
  }

  private toIsoDate(value: Date): string {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private plusDays(baseDate: Date, days: number): Date {
    const result = new Date(baseDate);
    result.setDate(result.getDate() + days);
    return result;
  }
}
