import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface FacturaManualFormValue {
  numeroFactura: string;
  rutDeudor: string;
  nombreRazonSocialDeudor: string;
  montoTotal: number;
  fechaVencimiento: string;
}

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
    montoTotal: null as number | null,
    fechaVencimiento: ''
  };

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
    if (this.isSubmitting || !this.isManualFormValid()) {
      return;
    }

    this.submitForm.emit({
      numeroFactura: this.manualForm.numeroFactura.trim(),
      rutDeudor: this.manualForm.rutDeudor.trim(),
      nombreRazonSocialDeudor: this.manualForm.nombreRazonSocialDeudor.trim(),
      montoTotal: Number(this.manualForm.montoTotal ?? 0),
      fechaVencimiento: this.manualForm.fechaVencimiento
    });
  }

  private isManualFormValid(): boolean {
    return !!this.manualForm.numeroFactura.trim()
      && !!this.manualForm.rutDeudor.trim()
      && !!this.manualForm.nombreRazonSocialDeudor.trim()
      && Number(this.manualForm.montoTotal ?? 0) > 0
      && !!this.manualForm.fechaVencimiento;
  }
}
