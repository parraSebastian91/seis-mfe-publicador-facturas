import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

export interface MediaCategoryExtensionRow {
    extension: string;
    mime: string;
    descripcion: string | null;
}

export interface MediaCategoryRow {
    codigo: number;
    nombre: string;
    extensiones: MediaCategoryExtensionRow[];
}

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
    /** Adjuntos pendientes de subir (se cargan al bucket DESPUÉS de crear el registro de factura). */
    adjuntos?: AdjuntoParaSubir[];
}

/** Adjunto listo para subir, entregado al padre junto con el evento de publicación. */
export interface AdjuntoParaSubir {
    categoriaId: string;
    file: File;
}

type ManualField = 'numeroFactura' | 'rutDeudor' | 'nombreRazonSocialDeudor' | 'montoTotal' | 'fechaEmision' | 'fechaVencimiento';

// ── Adjuntos (Paso 3) ──────────────────────────────────────────────────────────

export interface AdjuntoCategoria {
    id: string;
    nombre: string;
    descripcion?: string;
    mimeTypesAdmitidos?: string[];
}

// 'pending' = archivo validado y listo; la subida ocurre en el padre DESPUÉS de crear el registro de factura.
export type AdjuntoUploadStatus = 'idle' | 'pending' | 'uploading' | 'success' | 'error';

export interface AdjuntoRow {
    rowId: string;         // identificador local de la fila
    categoriaId: string;   // id de la categoría seleccionada
    file: File | null;
    isDragging: boolean;
    validationError: string | null;
    status: AdjuntoUploadStatus;
    uploadProgress: number; // 0–100
    uploadedUrl: string | null;
    uploadError: string | null;
}

@Component({
    selector: 'app-modal-publicacion-factura',
    templateUrl: './modal-publicacion-factura.component.html',
    styleUrl: './modal-publicacion-factura.component.scss',
    standalone: false
})
export class ModalPublicacionFacturaComponent implements OnInit, OnDestroy {
    private readonly http = inject(HttpClient);
    private readonly defaultAllowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

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

    // Wizard is always manual — tabs removed
    manualStep: 1 | 2 | 3 = 1;
    showCloseConfirm = false;

    // Paso 2 — respaldo PDF
    isDraggingRespaldo = false;
    respaldoFile: File | null = null;
    respaldoValidationError: string | null = null;

    // Paso 3 — adjuntos dinámicos
    categorias: AdjuntoCategoria[] = [];
    loadingCategorias = false;
    adjuntos: AdjuntoRow[] = [];

    /** IDs de categorías ya asignadas a alguna fila */
    get categoriasTomadas(): Set<string> {
        return new Set(this.adjuntos.map(a => a.categoriaId).filter(Boolean));
    }

    /** Categorías disponibles para añadir (aún no asignadas) */
    categoriasDisponibles(rowId: string): AdjuntoCategoria[] {
        const fila = this.adjuntos.find(a => a.rowId === rowId);
        return this.categorias.filter(
            c => !this.categoriasTomadas.has(c.id) || c.id === fila?.categoriaId
        );
    }

    /** Puede añadir otra fila si hay categorías sin asignar */
    get puedeAgregarAdjunto(): boolean {
        return this.categoriasTomadas.size < this.categorias.length;
    }

    /** Todas las filas tienen archivo válido (status 'pending') o no tienen archivo (status 'idle'). */
    get adjuntosListos(): boolean {
        return this.adjuntos.every(a => a.status !== 'error');
    }

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

    ngOnInit(): void {
        this.loadCategorias();
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

    nextStep(): void {
        if (this.manualStep === 1) {
            this.markAllFieldsTouched();
            if (!this.isManualFormValid()) return;
            this.manualStep = 2;
            this.respaldoFile = null;
            this.respaldoValidationError = null;
            return;
        }
        if (this.manualStep === 2) {
            this.manualStep = 3;
            return;
        }
    }

    prevStep(): void {
        if (this.manualStep === 3) { this.manualStep = 2; return; }
        if (this.manualStep === 2) { this.manualStep = 1; return; }
    }

    // ——————————————————
    // Paso 3 — Categorías + Adjuntos
    // ——————————————————


    private async loadCategorias(): Promise<void> {
        this.loadingCategorias = true;
        try {
            const res = await firstValueFrom(
                this.http.get<{ data: MediaCategoryRow[] }>(
                    '/api/bff/catalogo/media-category',
                    { withCredentials: true }
                ),
            );
            this.categorias = res?.data.map((data) => {
                const categoria = {
                    id: String(data.codigo),
                    nombre: data.nombre,
                    descripcion: data.nombre,
                    mimeTypesAdmitidos: data.extensiones
                        .map(ext => ext.mime)
                        .filter(Boolean)
                };
                return categoria;
            }) ?? [];
        } catch {
            // Si el endpoint aún no existe, opera sin categorías
            this.categorias = [
                { id: 'orden-compra', nombre: 'Orden de Compra' },
                { id: 'guia-despacho', nombre: 'Guía de Despacho' },
                { id: 'contrato', nombre: 'Contrato' },
                { id: 'certificado', nombre: 'Certificado' },
                { id: 'otro', nombre: 'Otro' },
            ];
        } finally {
            this.loadingCategorias = false;
        }
    }

    agregarFilaAdjunto(): void {
        if (!this.puedeAgregarAdjunto) return;
        const primeraLibre = this.categorias.find(c => !this.categoriasTomadas.has(c.id));
        this.adjuntos.push({
            rowId: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            categoriaId: primeraLibre?.id ?? '',
            file: null,
            isDragging: false,
            validationError: null,
            status: 'idle',
            uploadProgress: 0,
            uploadedUrl: null,
            uploadError: null,
        });
    }

    eliminarFilaAdjunto(rowId: string): void {
        this.adjuntos = this.adjuntos.filter(a => a.rowId !== rowId);
    }

    onCategoriaCambiada(rowId: string, categoriaId: string): void {
        const row = this.adjuntos.find(a => a.rowId === rowId);
        if (!row) return;

        row.categoriaId = categoriaId;

        // Si el usuario ya cargó archivo y cambia la categoría, se revalida contra el nuevo set permitido.
        if (row.file && !this.isMimeTypeAllowedForRow(row, row.file.type)) {
            row.validationError = this.buildMimeTypeErrorMessage(this.getAllowedMimeTypesForRow(row));
            row.file = null;
            row.status = 'idle';
            row.uploadedUrl = null;
            row.uploadError = null;
            row.uploadProgress = 0;
        }
    }

    onAdjuntoDragOver(event: DragEvent, rowId: string): void {
        event.preventDefault();
        const row = this.adjuntos.find(a => a.rowId === rowId);
        if (row) row.isDragging = true;
    }

    onAdjuntoDragLeave(event: DragEvent, rowId: string): void {
        event.preventDefault();
        const row = this.adjuntos.find(a => a.rowId === rowId);
        if (row) row.isDragging = false;
    }

    onAdjuntoDrop(event: DragEvent, rowId: string): void {
        event.preventDefault();
        const row = this.adjuntos.find(a => a.rowId === rowId);
        if (!row) return;
        row.isDragging = false;
        const file = event.dataTransfer?.files?.[0];
        if (file) this.setAdjuntoFile(row, file);
    }

    onAdjuntoFileSelected(event: Event, rowId: string): void {
        const row = this.adjuntos.find(a => a.rowId === rowId);
        if (!row) return;
        const input = event.target as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (file) this.setAdjuntoFile(row, file);
        if (input) input.value = '';
    }

    private setAdjuntoFile(row: AdjuntoRow, file: File): void {
        row.validationError = null;
        row.status = 'idle';
        row.uploadedUrl = null;
        row.uploadError = null;

        const allowedMimeTypes = this.getAllowedMimeTypesForRow(row);
        if (!this.isMimeTypeAllowedForRow(row, file.type)) {
            row.validationError = this.buildMimeTypeErrorMessage(allowedMimeTypes);
            row.file = null;
            return;
        }
        if (file.size > this.maxFileSizeBytes) {
            row.validationError = `El archivo supera el límite de ${this.maxFileSizeMb} MB.`;
            row.file = null;
            return;
        }
        // Archivo válido: queda en estado 'pending'.
        // La subida al bucket se inicia DESPUÉS de que el padre cree el registro de factura
        // y disponga del facturaId, pasando el archivo via AdjuntoParaSubir en el evento submitForm.
        row.file   = file;
        row.status = 'pending';
    }

    private getAllowedMimeTypesForRow(row: AdjuntoRow): string[] {
        const categoria = this.categorias.find(c => c.id === row.categoriaId);
        const allowed = (categoria?.mimeTypesAdmitidos ?? [])
            .map(mime => String(mime ?? '').trim().toLowerCase())
            .filter(Boolean);

        return allowed.length > 0 ? allowed : this.defaultAllowedMimeTypes;
    }

    private isMimeTypeAllowedForRow(row: AdjuntoRow, mimeType: string): boolean {
        const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase();
        if (!normalizedMimeType) {
            return false;
        }
        const allowed = new Set(this.getAllowedMimeTypesForRow(row));
        return allowed.has(normalizedMimeType);
    }

    private buildMimeTypeErrorMessage(allowedMimeTypes: string[]): string {
        const formatted = allowedMimeTypes.join(', ');
        return `Formato no permitido. Formatos admitidos: ${formatted}.`;
    }

    private async uploadAdjunto(row: AdjuntoRow): Promise<void> {
        row.status = 'uploading';
        row.uploadProgress = 0;
        try {
            // 1. Obtener presigned URL
            const presignedRes = await firstValueFrom(
                this.http.post<{ data: { url: string; key: string } }>(
                    '/api/bff/publicador/adjunto-presigned-url',
                    { categoriaId: row.categoriaId, fileName: row.file!.name, fileType: row.file!.type },
                    { withCredentials: true },
                ),
            );
            const presignedUrl = presignedRes?.data?.url;
            if (!presignedUrl) throw new Error('Presigned URL no disponible.');

            // 2. Subir al bucket con XMLHttpRequest para trackear progreso
            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', presignedUrl);
                xhr.setRequestHeader('Content-Type', row.file!.type);
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        row.uploadProgress = Math.round((e.loaded / e.total) * 100);
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error(`Upload failed: ${xhr.status}`));
                };
                xhr.onerror = () => reject(new Error('Network error during upload.'));
                xhr.send(row.file!);
            });

            row.uploadedUrl = presignedRes.data.key;
            row.status = 'success';
            row.uploadProgress = 100;
        } catch (err: any) {
            row.status = 'error';
            row.uploadError = err?.message ?? 'Error al subir el archivo.';
        }
    }

    trackByRowId(_index: number, row: AdjuntoRow): string {
        return row.rowId;
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
        this.submitForm.emit({
            type: 'formulario',
            data: this.buildFacturaData(),
            adjuntos: this.buildAdjuntosParaSubir(),
        });
    }

    /** Caso 2: con respaldo PDF */
    submitWithRespaldo(): void {
        if (!this.respaldoFile || this.isSubmitting) return;
        this.submitForm.emit({
            type: 'formulario',
            data: this.buildFacturaData(),
            respaldoFile: this.respaldoFile,
            adjuntos: this.buildAdjuntosParaSubir(),
        });
    }

    private buildAdjuntosParaSubir(): AdjuntoParaSubir[] {
        return this.adjuntos
            .filter(a => a.file && a.status === 'pending')
            .map(a => ({ categoriaId: a.categoriaId, file: a.file! }));
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
        const keys = Object.keys(this.manualForm) as Array<keyof typeof this.manualForm>;
        const formHasData = keys.some(key => {
            const v = this.manualForm[key];
            if (key === 'fechaEmision' && v === this.todayIso) return false;
            if (key === 'fechaVencimiento' && v === this.suggestedDateIso) return false;
            return !!String(v ?? '').trim();
        });
        return formHasData || this.manualStep > 1 || !!this.respaldoFile || this.adjuntos.length > 0;
    }

    private resetAll(): void {
        this.manualStep = 1;
        this.showCloseConfirm = false;
        this.respaldoFile = null;
        this.respaldoValidationError = null;
        this.isDraggingRespaldo = false;
        this.adjuntos = [];
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
