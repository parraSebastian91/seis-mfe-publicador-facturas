import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

export interface ModalPublishMetadata {
    numeroFacturaExistentes: number[];
    deudoresExistentes: {
        rut: string;
        nombre: string;
    }[];
}

export interface FacturaData {
    numeroFactura: string;
    rutDeudor: string;
    nombreRazonSocialDeudor: string;
    montoTotal: number;
    fechaEmision: string;
    fechaVencimiento: string;
}

export interface FacturaFormularioPublicacion {
    type: 'formulario';
    data: FacturaData;
    respaldoFile?: File;
}

type ManualField = 'numeroFactura' | 'rutDeudor' | 'nombreRazonSocialDeudor' | 'montoTotal' | 'fechaEmision' | 'fechaVencimiento';

@Component({
    selector: 'app-modal-publicacion-factura',
    templateUrl: './modal-publicacion-factura.component.html',
    styleUrl: './modal-publicacion-factura.component.scss',
    standalone: false
})
export class ModalPublicacionFacturaComponent implements OnDestroy {
    @Input() isOpen = false;
    @Input() isSubmitting = false;
    @Input() errorMessage = '';
    @Input() metadata: ModalPublishMetadata | undefined;

    @Output() closeModal = new EventEmitter<void>();
    @Output() submitFile = new EventEmitter<File>();
    @Output() submitForm = new EventEmitter<FacturaFormularioPublicacion>();

    readonly maxFileSizeMb = 10;
    private readonly maxFileSizeBytes = this.maxFileSizeMb * 1024 * 1024;
    private readonly inputValidationDebounceMs = 300;
    private readonly touchDebounceTimers: Partial<Record<ManualField, ReturnType<typeof setTimeout>>> = {};

    // Tab / step state
    activeTab: 'automatica' | 'manual' = 'automatica';
    manualStep: 1 | 2 = 1;
    showCloseConfirm = false;

    // Automática (Caso 3)
    isDragging = false;
    selectedFile: File | null = null;
    fileValidationError: string | null = null;

    // Manual paso 2 — respaldo PDF (Caso 2)
    isDraggingRespaldo = false;
    respaldoFile: File | null = null;
    respaldoValidationError: string | null = null;

    manualForm = {
        numeroFactura: '',
        rutDeudor: '',
        nombreRazonSocialDeudor: '',
        montoTotal: '',
        fechaEmision: '',
        fechaVencimiento: ''
    };

    touchedFields: Record<ManualField, boolean> = {
        numeroFactura: false,
        rutDeudor: false,
        nombreRazonSocialDeudor: false,
        montoTotal: false,
        fechaEmision: false,
        fechaVencimiento: false
    };

    readonly minDateStruct = this.toDateStruct(this.startOfToday());
    readonly maxDateStruct = this.toDateStruct(this.startOfToday());
    readonly suggestedDateIso = this.toIsoDate(this.plusDays(this.startOfToday(), 30));
    readonly todayIso = this.toIsoDate(this.startOfToday());

    constructor() {
        this.manualForm.fechaVencimiento = this.suggestedDateIso;
        this.manualForm.fechaEmision = this.todayIso;
    }

    ngOnDestroy(): void {
        Object.values(this.touchDebounceTimers).forEach(timer => {
            if (timer) clearTimeout(timer);
        });
        this.resetAll();
    }

    // ——————————————————
    // Open / close
    // ——————————————————

    tryClose(): void {
        if (this.isSubmitting) return;
        if (this.hasAnyDataEntered()) {
            this.showCloseConfirm = true;
        } else {
            this.close();
        }
    }

    confirmClose(): void {
        this.showCloseConfirm = false;
        this.close();
    }

    cancelClose(): void {
        this.showCloseConfirm = false;
    }

    close(): void {
        this.resetAll();
        this.closeModal.emit();
    }

    onBackdropClick(): void {
        if (this.isSubmitting) return;
        this.tryClose();
    }

    // ——————————————————
    // Tabs / stepper
    // ——————————————————

    selectTab(tab: 'automatica' | 'manual'): void {
        if (this.isSubmitting) return;
        // EB-03: preserve form data; discard automática file if switching to manual
        if (tab === 'manual') {
            this.selectedFile = null;
            this.fileValidationError = null;
        }
        this.activeTab = tab;
    }

    nextStep(): void {
        this.markAllFieldsTouched();
        if (!this.isManualFormValid()) return;
        this.manualStep = 2;
        this.respaldoFile = null;
        this.respaldoValidationError = null;
    }

    prevStep(): void {
        this.manualStep = 1;
    }

    // ——————————————————
    // Automática — Dropzone (Caso 3)
    // ——————————————————

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        if (this.isSubmitting) return;
        this.isDragging = true;
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        this.isDragging = false;
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        this.isDragging = false;
        if (this.isSubmitting) return;
        const file = event.dataTransfer?.files?.[0];
        if (file) this.setAutoFile(file);
    }

    onFileSelected(event: Event): void {
        if (this.isSubmitting) return;
        const input = event.target as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (file) this.setAutoFile(file);
        if (input) input.value = '';
    }

    private setAutoFile(file: File): void {
        this.fileValidationError = null;
        if (file.type !== 'application/pdf') {
            this.fileValidationError = 'Solo se aceptan archivos en formato PDF.';
            this.selectedFile = null;
            return;
        }
        if (file.size > this.maxFileSizeBytes) {
            this.fileValidationError = `El archivo supera el límite de ${this.maxFileSizeMb} MB.`;
            this.selectedFile = null;
            return;
        }
        this.selectedFile = file;
    }

    submitSelectedFile(): void {
        if (!this.selectedFile || this.isSubmitting) return;
        this.submitFile.emit(this.selectedFile);
    }

    // ——————————————————
    // Respaldo — Dropzone (Paso 2 / Caso 2)
    // ——————————————————

    onDragOverRespaldo(event: DragEvent): void {
        event.preventDefault();
        if (this.isSubmitting) return;
        this.isDraggingRespaldo = true;
    }

    onDragLeaveRespaldo(event: DragEvent): void {
        event.preventDefault();
        this.isDraggingRespaldo = false;
    }

    onDropRespaldo(event: DragEvent): void {
        event.preventDefault();
        this.isDraggingRespaldo = false;
        if (this.isSubmitting) return;
        const file = event.dataTransfer?.files?.[0];
        if (file) this.setRespaldoFile(file);
    }

    onRespaldoFileSelected(event: Event): void {
        if (this.isSubmitting) return;
        const input = event.target as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (file) this.setRespaldoFile(file);
        if (input) input.value = '';
    }

    private setRespaldoFile(file: File): void {
        this.respaldoValidationError = null;
        if (file.type !== 'application/pdf') {
            this.respaldoValidationError = 'Solo se aceptan archivos en formato PDF.';
            this.respaldoFile = null;
            return;
        }
        if (file.size > this.maxFileSizeBytes) {
            this.respaldoValidationError = `El archivo supera el límite de ${this.maxFileSizeMb} MB.`;
            this.respaldoFile = null;
            return;
        }
        this.respaldoFile = file;
    }

    // ——————————————————
    // Manual form submit
    // ——————————————————

    /** Caso 1: sin respaldo PDF */
    submitWithoutRespaldo(): void {
        if (this.isSubmitting) return;
        this.submitForm.emit({ type: 'formulario', data: this.buildFacturaData() });
    }

    /** Caso 2: con respaldo PDF */
    submitWithRespaldo(): void {
        if (!this.respaldoFile || this.isSubmitting) return;
        this.submitForm.emit({ type: 'formulario', data: this.buildFacturaData(), respaldoFile: this.respaldoFile });
    }

    private buildFacturaData(): FacturaData {
        return {
            numeroFactura: this.manualForm.numeroFactura.trim(),
            rutDeudor: this.manualForm.rutDeudor.trim(),
            nombreRazonSocialDeudor: this.manualForm.nombreRazonSocialDeudor.trim(),
            montoTotal: this.parseMonto(this.manualForm.montoTotal),
            fechaEmision: this.manualForm.fechaEmision,
            fechaVencimiento: this.manualForm.fechaVencimiento,
        };
    }

    // ——————————————————
    // Field helpers
    // ——————————————————

    markFieldTouched(field: ManualField): void {
        this.touchedFields[field] = true;
    }

    shouldShowFieldError(field: ManualField): boolean {
        return this.touchedFields[field] && !this.isFieldValid(field);
    }

    getFieldErrorMessage(field: ManualField): string {
        return this.getRequiredFieldError(field) ?? this.getFormatFieldError(field);
    }

    private getRequiredFieldError(field: ManualField): string | null {
        if (field === 'numeroFactura' && !this.manualForm.numeroFactura.trim()) return 'El número de factura es obligatorio.';
        if (field === 'rutDeudor' && !this.manualForm.rutDeudor.trim()) return 'El RUT deudor es obligatorio.';
        if (field === 'nombreRazonSocialDeudor' && !this.manualForm.nombreRazonSocialDeudor.trim()) return 'La razón social es obligatoria.';
        if (field === 'montoTotal' && !this.manualForm.montoTotal.trim()) return 'El monto total es obligatorio.';
        if (field === 'fechaEmision' && !this.manualForm.fechaEmision.trim()) return 'La fecha de emisión es obligatoria.';
        if (field === 'fechaVencimiento' && !this.manualForm.fechaVencimiento.trim()) return 'La fecha de vencimiento es obligatoria.';
        return null;
    }

    private getFormatFieldError(field: ManualField): string {
        switch (field) {
            case 'numeroFactura': return this.isNumeroFacturaDuplicado() ? 'Este número de factura ya existe en el listado.' : 'Debe contener solo números, sin formato.';
            case 'rutDeudor': return 'Formato esperado: XX.XXX.XXX-X.';
            case 'nombreRazonSocialDeudor': return 'Debe tener al menos 5 caracteres.';
            case 'montoTotal': return 'Debe ser numérico y mayor a 0.';
            case 'fechaEmision': return 'No puede ser una fecha futura.';
            case 'fechaVencimiento': return this.isDateAfterEmision(this.manualForm.fechaVencimiento) ? 'Debe ser hoy o una fecha posterior.' : 'Debe ser posterior a la fecha de emisión.';
            default: return 'Campo inválido.';
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

    /** Auto-fill nombre from RUT selection. */
    onRutChange(event: Event): void {
        const value = (event.target as HTMLInputElement).value.trim();
        const match = this.metadata?.deudoresExistentes.find(d => d.rut === value);
        if (match?.nombre && !this.manualForm.nombreRazonSocialDeudor.trim()) {
            this.manualForm.nombreRazonSocialDeudor = match.nombre;
            this.touchedFields.nombreRazonSocialDeudor = true;
        }
    }

    /** Auto-fill RUT from nombre selection. */
    onNombreDeudorChange(event: Event): void {
        const value = (event.target as HTMLInputElement).value.trim();
        const match = this.metadata?.deudoresExistentes.find(d => d.nombre === value);
        if (match?.rut && !this.manualForm.rutDeudor.trim()) {
            this.manualForm.rutDeudor = match.rut;
            this.touchedFields.rutDeudor = true;
        }
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
            && this.isFieldValid('fechaEmision')
            && this.isFieldValid('fechaVencimiento');
    }

    formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private isFieldValid(field: ManualField): boolean {
        switch (field) {
            case 'numeroFactura':
                return /^\d+$/.test(this.manualForm.numeroFactura.trim())
                    && !this.isNumeroFacturaDuplicado();

            case 'rutDeudor':
                return /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/.test(this.manualForm.rutDeudor.trim());

            case 'nombreRazonSocialDeudor':
                return this.manualForm.nombreRazonSocialDeudor.trim().length >= 5;

            case 'montoTotal':
                return this.parseMonto(this.manualForm.montoTotal) > 0;

            case 'fechaEmision':
                return this.isDateTodayOrBefore(this.manualForm.fechaEmision);

            case 'fechaVencimiento':
                return this.isDateTodayOrLater(this.manualForm.fechaVencimiento)
                    && this.isDateAfterEmision(this.manualForm.fechaVencimiento);

            default:
                return false;
        }
    }

    trackByDeudorRut(_index: number, d: { rut: string; nombre: string }): string {
        return d.rut;
    }

    private isNumeroFacturaDuplicado(): boolean {
        const numero = Number.parseInt(this.manualForm.numeroFactura.trim(), 10);
        if (!Number.isFinite(numero)) {
            return false;
        }
        return (this.metadata?.numeroFacturaExistentes ?? []).includes(numero);
    }

    private isDateTodayOrBefore(value: string): boolean {
        const normalized = String(value ?? '').trim();
        const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
        const match = isoDatePattern.exec(normalized);
        if (!match) return false;
        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);
        const parsed = new Date(year, month - 1, day);
        if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return false;
        return parsed.getTime() <= this.startOfToday().getTime();
    }

    private isDateAfterEmision(vencimiento: string): boolean {
        const emision = this.manualForm.fechaEmision.trim();
        if (!emision || !vencimiento.trim()) return true;
        const parseIso = (s: string): Date | null => {
            const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
            const m = isoDatePattern.exec(s.trim());
            if (!m) return null;
            return new Date(Number.parseInt(m[1], 10), Number.parseInt(m[2], 10) - 1, Number.parseInt(m[3], 10));
        };
        const emisionDate = parseIso(emision);
        const vencimientoDate = parseIso(vencimiento);
        if (!emisionDate || !vencimientoDate) return true;
        return vencimientoDate.getTime() > emisionDate.getTime();
    }

    private isDateTodayOrLater(value: string): boolean {
        const normalized = String(value ?? '').trim();
        const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
        const match = isoDatePattern.exec(normalized);
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
        (Object.keys(this.touchedFields) as ManualField[]).forEach(field => {
            this.touchedFields[field] = true;
        });
    }

    private hasAnyDataEntered(): boolean {
        if (this.activeTab === 'automatica') return !!this.selectedFile;
        const keys = Object.keys(this.manualForm) as Array<keyof typeof this.manualForm>;
        const formHasData = keys.some(key => {
            const v = this.manualForm[key];
            if (key === 'fechaEmision' && v === this.todayIso) return false;
            if (key === 'fechaVencimiento' && v === this.suggestedDateIso) return false;
            return !!String(v ?? '').trim();
        });
        return formHasData || this.manualStep === 2 || !!this.respaldoFile;
    }

    private resetAll(): void {
        this.manualStep = 1;
        this.activeTab = 'automatica';
        this.showCloseConfirm = false;
        this.selectedFile = null;
        this.fileValidationError = null;
        this.isDragging = false;
        this.respaldoFile = null;
        this.respaldoValidationError = null;
        this.isDraggingRespaldo = false;
        this.manualForm = {
            numeroFactura: '',
            rutDeudor: '',
            nombreRazonSocialDeudor: '',
            montoTotal: '',
            fechaEmision: this.todayIso,
            fechaVencimiento: this.suggestedDateIso,
        };
        (Object.keys(this.touchedFields) as ManualField[]).forEach(field => {
            this.touchedFields[field] = false;
        });
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
