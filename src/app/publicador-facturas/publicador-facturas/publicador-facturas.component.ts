import { Component, EffectRef, Injector, OnDestroy, OnInit, Signal, effect, signal } from '@angular/core';
import { FacturaCreateRequestDto, facturaEstado, FacturaResponseUpdateDTO, FacturaType, ObjectUploadService, PATH_TYPES, UserProfileService, UserStateService } from 'shared-utils';
import { FacturasService } from '../../../../../shared-utils/src/lib/services/facturas/factura.service';
import { FacturaManualFormValue } from '../component/modal-publicacion-factura/modal-publicacion-factura.component';
import { FacturaFilters } from '../component/atomic-factura-filters/atomic-factura-filters.component';
import Swal from 'sweetalert2';
import { FacturaConfirmRequestEvent } from '../component/factura-view/factura-view.component';

interface FacturaFieldUpdateEvent {
  factura: FacturaType;
  campoNombre: string;
  value: string;
  onResponse: (response: FacturaResponseUpdateDTO) => void;
  onError: () => void;
}


@Component({
  selector: 'app-publicador-facturas',
  templateUrl: './publicador-facturas.component.html',
  styleUrl: './publicador-facturas.component.scss',
  standalone: false
})
export class PublicadorFacturasComponent implements OnInit, OnDestroy {
  private readonly apiBase = 'http://localhost:8000';
  private readonly publishedHighlightDurationMs = 2400;
  private readonly statusPriority: Record<string, number> = Object.values(facturaEstado).reduce((acc, estado, index) => {
    acc[estado] = index;
    return acc;
  }, {} as Record<string, number>);
  private publishedHighlightTimeoutId?: ReturnType<typeof setTimeout>;

  facturas: FacturaType[] = [];
  filteredFacturas: FacturaType[] = [];
  isPublicationModalOpen = false;
  isMobileFiltersModalOpen = false;
  isPublishing = false;
  highlightedFacturaKey: string | null = null;
  activeFilters: FacturaFilters = {
    status: '',
    gestor: '',
    deudor: '',
    numeroFactura: '',
    sortBy: 'none',
  };
  mobileDraftFilters: FacturaFilters = {
    status: '',
    gestor: '',
    deudor: '',
    numeroFactura: '',
    sortBy: 'none',
  };

  private orgEffect?: EffectRef;
  readonly orgSelected!: Signal<string>;
  readonly userName!: Signal<string>;
  readonly userRole!: Signal<string>;

  constructor(
    private injector: Injector,
    private objectUploadService: ObjectUploadService,
    private userStateService: UserStateService,
    private userProfileService: UserProfileService,
    private facturasService: FacturasService
  ) {
    this.userName = this.userStateService.userName;
    this.orgSelected = this.userStateService.orgSelected;
    this.userRole = this.userStateService.role;
  }

  ngOnInit(): void {
    this.orgEffect = effect(() => {
      const organizacionUUID = this.orgSelected();

      if (!organizacionUUID) {
        this.facturas = [];
        this.filteredFacturas = [];
        return;
      }

      void this.loadFacturas(organizacionUUID);
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.orgEffect?.destroy();
    if (this.publishedHighlightTimeoutId) {
      clearTimeout(this.publishedHighlightTimeoutId);
    }
  }

  openUploadModal(): void {
    this.isPublicationModalOpen = true;
  }

  closePublicationModal(): void {
    if (this.isPublishing) {
      return;
    }

    this.isPublicationModalOpen = false;
  }

  openMobileFiltersModal(): void {
    this.mobileDraftFilters = { ...this.activeFilters };
    this.isMobileFiltersModalOpen = true;
  }

  closeMobileFiltersModal(): void {
    this.isMobileFiltersModalOpen = false;
  }

  async handleFilePublish(file: File): Promise<void> {
    await this.publishFile(file);
  }

  async handleManualFormPublish(formValue: FacturaManualFormValue): Promise<void> {
    const hasAuthorization = await this.confirmPublicationAuthorization();
    const status = this.facturasService.resolveEstadoFromAuthorization(hasAuthorization);

    const optimisticCorrelationId = this.buildOptimisticCorrelationId();
    const orgInfo = this.userStateService.organizationProfile().find(org => org.uuid === this.orgSelected()) || { razonSocial: '', rut: '' };
    const newFactura: FacturaType = {
      assetId: '',
      facturaId: '',
      ownerUUID: this.orgSelected(),
      nombre_mandante: orgInfo.razonSocial || '',
      rut_mandante: orgInfo.rut || 'Recuperando...', // Podríamos obtenerlo de orgSelectedInfo si lo tuviéramos allí
      gestor: {
        uuid: '',
        username: this.userName(),
      },
      gestorUUID: '',
      deudorNombre: formValue.nombreRazonSocialDeudor,
      deudorRut: formValue.rutDeudor,
      facturaNumero: formValue.numeroFactura,
      montoTotal: formValue.montoTotal,
      fechaVencimiento: new Date(formValue.fechaVencimiento),
      status: status,
      correlationId: optimisticCorrelationId,
      storage_key: '',
      ofertas: '0',
    }

    const requestFactura: FacturaCreateRequestDto = {
      facturaId: '',
      ownerUUID: this.orgSelected(),
      numeroFactura: formValue.numeroFactura,
      rutDeudor: formValue.rutDeudor,
      nombreDeudor: formValue.nombreRazonSocialDeudor,
      correlationId: optimisticCorrelationId,
      montoTotal: formValue.montoTotal,
      fechaVencimiento: new Date(formValue.fechaVencimiento),
      status: status,
      gestor: {
        uuid: '',
        username: this.userName(),
      },
    };

    this.facturas = [newFactura, ...this.facturas];
    this.applyFiltersAndSort();
    this.isPublicationModalOpen = false;

    this.isPublishing = true;
    try {
      const response: FacturaType = await this.facturasService.publicarFactura(requestFactura);
      console.log('Factura publicada:', response);
      this.actualizarFacturaInMemory(response, optimisticCorrelationId, formValue);
    } catch (err) {
      console.error('Error al publicar factura manual:', err);
    } finally {
      this.isPublishing = false;
    }
  }

  async handleFacturaConfirmRequest(event: FacturaConfirmRequestEvent): Promise<void> {
    const hasAuthorization = await this.confirmPublicationAuthorization(event.factura.facturaNumero || undefined);
    const nextStatus = this.facturasService.resolveEstadoFromAuthorization(hasAuthorization);

    if (!event.factura.facturaId) {
      event.onCompleted({ authorized: hasAuthorization, updated: false, status: nextStatus });
      return;
    }

    try {
      await this.facturasService.actualizarEstadoFactura(event.factura, nextStatus);
      const updatedFactura: FacturaType = { ...event.factura, status: nextStatus };
      this.actualizarFacturaInMemory(updatedFactura);
      event.onCompleted({ authorized: hasAuthorization, updated: true, status: nextStatus });
    } catch (err) {
      console.error('Error al actualizar estado de factura:', err);
      event.onCompleted({ authorized: hasAuthorization, updated: false, status: event.factura.status });
    }
  }

  private async confirmPublicationAuthorization(facturaNumero?: string): Promise<boolean> {
    const facturaReference = String(facturaNumero ?? '').trim();
    const facturaLabel = facturaReference ? `Factura N° ${facturaReference}` : 'Factura';
    const authorizationText = [
      `<p><strong>${facturaLabel}</strong></p>`,
      '<p>Debes confirmar expresamente la autorización para continuar.</p>',
      '<p>Al aceptar, declaras que:</p>',
      '<ul style="text-align:left; margin:0.5rem 0 0 1.25rem;">',
      '<li>Autorizas la publicación de la factura.</li>',
      '<li>Autorizas la notificación a entidades financieras para su evaluación.</li>',
      '</ul>'
    ].join('');

    const result = await Swal.fire({
      title: 'Confirmar autorización',
      html: authorizationText,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Aceptar',
      cancelButtonText: 'Volver a revisar',
      reverseButtons: true,
      allowOutsideClick: !this.isPublishing,
      allowEscapeKey: !this.isPublishing,
      focusCancel: true
    });

    return result.isConfirmed;
  }

  actualizarFacturaInMemory(
    updatedFactura: FacturaType,
    optimisticCorrelationId?: string,
    originalFormValue?: FacturaManualFormValue
  ): void {
    const targetFacturaId = this.normalizeText(updatedFactura.facturaId);
    const targetCorrelationId = this.normalizeText(updatedFactura.correlationId) || this.normalizeText(optimisticCorrelationId);
    const targetNumero = this.normalizeText(updatedFactura.facturaNumero || originalFormValue?.numeroFactura || '');
    const targetRut = this.normalizeRut(updatedFactura.deudorRut || originalFormValue?.rutDeudor || '');

    const shouldReplace = (factura: FacturaType): boolean => {
      const matchById = !!targetFacturaId && this.normalizeText(factura.facturaId) === targetFacturaId;
      const matchByCorrelation = !!targetCorrelationId && this.normalizeText(factura.correlationId) === targetCorrelationId;
      const matchByNumeroRut = this.normalizeText(factura.facturaNumero) === targetNumero
        && this.normalizeRut(factura.deudorRut) === targetRut;

      return matchById || matchByCorrelation || matchByNumeroRut;
    };

    const hasMatch = this.facturas.some(shouldReplace);

    if (!hasMatch) {
      this.facturas = [updatedFactura, ...this.facturas];
      this.applyFiltersAndSort();
      this.highlightPublishedFactura(updatedFactura);
      return;
    }

    this.facturas = this.facturas.map(factura => (shouldReplace(factura) ? updatedFactura : factura));
    this.applyFiltersAndSort();
    this.highlightPublishedFactura(updatedFactura);
  }

  private buildOptimisticCorrelationId(): string {
    const randomChunk = Math.random().toString(36).slice(2, 8);
    return `tmp-${Date.now()}-${randomChunk}`;
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
  }

  private normalizeRut(value: unknown): string {
    return String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  }

  trackByFacturaId(index: number, factura: FacturaType): string {
    return factura.correlationId || String(index);
  }

  get isAdminUser(): boolean {
    return this.normalizeText(this.userRole()).includes('ADMIN');
  }

  onFiltersChange(filters: FacturaFilters): void {
    this.activeFilters = { ...filters };
    this.applyFiltersAndSort();
  }

  onMobileFiltersDraftChange(filters: FacturaFilters): void {
    this.mobileDraftFilters = { ...filters };
  }

  applyMobileFilters(): void {
    this.onFiltersChange(this.mobileDraftFilters);
    this.closeMobileFiltersModal();
  }

  cancelMobileFilters(): void {
    this.mobileDraftFilters = { ...this.activeFilters };
    this.closeMobileFiltersModal();
  }

  get activeFilterCount(): number {
    let count = 0;

    if (this.activeFilters.status) {
      count += 1;
    }

    if (this.activeFilters.gestor) {
      count += 1;
    }

    if (this.activeFilters.deudor.trim()) {
      count += 1;
    }

    if (this.activeFilters.numeroFactura.trim()) {
      count += 1;
    }

    if (this.activeFilters.sortBy !== 'none') {
      count += 1;
    }

    return count;
  }

  isFacturaRecentlyPublished(factura: FacturaType): boolean {
    return this.highlightedFacturaKey === this.getFacturaVisualKey(factura);
  }

  private getFacturaVisualKey(factura: FacturaType): string {
    const facturaId = this.normalizeText(factura.facturaId);
    if (facturaId) {
      return `id:${facturaId}`;
    }

    const correlationId = this.normalizeText(factura.correlationId);
    if (correlationId) {
      return `corr:${correlationId}`;
    }

    const numero = this.normalizeText(factura.facturaNumero);
    const rut = this.normalizeRut(factura.deudorRut);
    return `nr:${numero}|${rut}`;
  }

  private highlightPublishedFactura(factura: FacturaType): void {
    this.highlightedFacturaKey = this.getFacturaVisualKey(factura);

    if (this.publishedHighlightTimeoutId) {
      clearTimeout(this.publishedHighlightTimeoutId);
    }

    this.publishedHighlightTimeoutId = setTimeout(() => {
      this.highlightedFacturaKey = null;
      this.publishedHighlightTimeoutId = undefined;
    }, this.publishedHighlightDurationMs);
  }

  private async loadFacturas(organizacionUUID: string): Promise<void> {
    try {
      const facturas = await this.facturasService.getFacturas(organizacionUUID);
      this.facturas = facturas;
      this.applyFiltersAndSort();
      console.log('Facturas obtenidas:', facturas);
    } catch (err) {
      this.facturas = [];
      this.filteredFacturas = [];
      console.error('Error al obtener facturas:', err);
    }
  }

  private applyFiltersAndSort(): void {
    const filters = this.activeFilters;
    let filtered = [...this.facturas];

    if (filters.status) {
      filtered = filtered.filter(factura => factura.status === filters.status);
    }

    if (filters.gestor) {
      const selectedGestor = this.normalizeText(filters.gestor);
      filtered = filtered.filter(factura => this.normalizeText(factura.gestor) === selectedGestor);
    }

    if (filters.deudor.trim()) {
      const deudorQuery = this.normalizeText(filters.deudor);
      const deudorRutQuery = this.normalizeRut(filters.deudor);

      filtered = filtered.filter(factura => {
        const deudorNombre = this.normalizeText(factura.deudorNombre);
        const deudorRut = this.normalizeRut(factura.deudorRut);
        return deudorNombre.includes(deudorQuery) || (!!deudorRutQuery && deudorRut.includes(deudorRutQuery));
      });
    }

    if (filters.numeroFactura.trim()) {
      const numeroQuery = this.normalizeText(filters.numeroFactura);
      filtered = filtered.filter(factura => this.normalizeText(factura.facturaNumero).includes(numeroQuery));
    }

    switch (filters.sortBy) {
      case 'monto-asc':
        filtered.sort((a, b) => Number(a.montoTotal || 0) - Number(b.montoTotal || 0));
        break;
      case 'monto-desc':
        filtered.sort((a, b) => Number(b.montoTotal || 0) - Number(a.montoTotal || 0));
        break;
      case 'estado-asc':
        filtered.sort((a, b) => this.compareFacturaStatus(a.status, b.status));
        break;
      case 'estado-desc':
        filtered.sort((a, b) => this.compareFacturaStatus(b.status, a.status));
        break;
      default:
        break;
    }

    this.filteredFacturas = filtered;
  }

  private compareFacturaStatus(a: facturaEstado, b: facturaEstado): number {
    const rankA = this.statusPriority[a] ?? Number.MAX_SAFE_INTEGER;
    const rankB = this.statusPriority[b] ?? Number.MAX_SAFE_INTEGER;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return String(a).localeCompare(String(b), 'es');
  }

  async handleFacturaChange(event: FacturaFieldUpdateEvent): Promise<void> {
    const { factura, campoNombre, value, onResponse, onError } = event;
    try {
      const response = await this.facturasService.updateFactura(factura, campoNombre, value);
      console.log('Factura actualizada:', response);
      onResponse(response);
      //await this.loadFacturas(this.orgSelected());
    } catch (err) {
      console.error('Error al actualizar factura:', err);
      onError();
    }
  }

  private async publishFile(file: File): Promise<void> {
    this.isPublishing = true;
    try {
      let currentUserName = (this.userStateService.userName() || '').trim();
      if (!currentUserName) {
        const profile = await this.userProfileService.getUserProfile(this.apiBase);
        currentUserName = (profile?.username || '').trim();
        if (currentUserName) {
          this.userStateService.patch({ username: currentUserName });
        }
      }

      if (!currentUserName) {
        throw new Error('No se pudo publicar porque userName está vacío en UserStateService.');
      }

      const respuesta = await this.objectUploadService.uploadFileUsingPresignedUrl(
        this.apiBase,
        PATH_TYPES.DOCUMENT,
        file,
        currentUserName,
        this.orgSelected()
      );

      if (!respuesta?.objectUrl) {
        throw new Error('Presigned URL not received from API.');
      }

      console.log('Factura subida correctamente:', {
        fileName: file.name,
        key: respuesta.key,
        url: respuesta.objectUrl.split('?')[0]
      });

      await this.loadFacturas(this.orgSelected());
      this.isPublicationModalOpen = false;
    } catch (err) {
      console.error('Error al subir factura con presigned URL:', err);
    } finally {
      this.isPublishing = false;
    }
  }




}
