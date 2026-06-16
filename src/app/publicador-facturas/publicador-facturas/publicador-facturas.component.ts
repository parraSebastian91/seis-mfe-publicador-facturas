import { Component, computed, EffectRef, Injector, NgZone, OnDestroy, OnInit, Signal, effect, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { AutorizacionPublicacionDto, createdBy, FacturaCreateRequestDto, facturaEstado, FacturaResponseUpdateDTO, FacturaType, NotificationSocketService, ObjectUploadService, PATH_TYPES, UploadModalService, UserOrgProfileState, UserProfileService, UserStateService, VersionTerminos } from 'shared-utils';
import { FacturasService } from '../../../../../shared-utils/src/lib/services/facturas/factura.service';
import { FacturaData, FacturaFormularioPublicacion, ModalPublishMetadata } from '../component/modal-publicacion-factura/modal-publicacion-factura.component';
import { FacturaFilters } from '../component/atomic-factura-filters/atomic-factura-filters.component';
import { FacturaConfirmRequestEvent, FacturaRespaldoRequestEvent } from '../component/factura-view/factura-view.component';
import Swal from 'sweetalert2';

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
  private readonly respaldoModalContextPrefix = 'factura-respaldo:';
  private readonly publishedHighlightDurationMs = 2400;
  private readonly statusPriority: Record<string, number> = Object.values(facturaEstado).reduce((acc, estado, index) => {
    acc[estado] = index;
    return acc;
  }, {} as Record<string, number>);
  private publishedHighlightTimeoutId?: ReturnType<typeof setTimeout>;
  private respaldoModalSubscription?: Subscription;
  loading = false;
  readonly estadoChips: { label: string; value: string }[] = [
    { label: 'Todas', value: '' },
    { label: 'Procesando', value: facturaEstado.PROCESANDO },
    { label: 'Pend. autorización', value: facturaEstado.PENDIENTE_AUTORIZACION },
    { label: 'Publicada', value: facturaEstado.PUBLICADA },
    { label: 'Financiada', value: facturaEstado.FINANCIADA },
    { label: 'Rechazada', value: facturaEstado.RECHAZADA },
    { label: 'Vencida', value: facturaEstado.VENCIDA },
  ];
  readonly selectedEstadoChips = new Set<string>();
  pageSize = 10;
  visibleCount = 10;

  facturas: FacturaType[] = [];
  filteredFacturas: FacturaType[] = [];
  isPublicationModalOpen = false;
  isMobileFiltersModalOpen = false;
  isPublishing = false;
  modalErrorMessage = '';
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

  // T&C modal state
  pendingTncFactura: FacturaType | null = null;
  pendingTncVersionTerminos: VersionTerminos | null = null;
  isTncSubmitting = false;
  tncErrorMessage = '';
  private onTncAcceptedCallback?: () => Promise<void>;
  private onTncDismissedCallback?: () => void;

  private readonly notificationSocketService = inject(NotificationSocketService);
  private socketEffect?: EffectRef;

  constructor(
    private readonly injector: Injector,
    private readonly ngZone: NgZone,
    private readonly objectUploadService: ObjectUploadService,
    private readonly uploadModalService: UploadModalService,
    private readonly userStateService: UserStateService,
    private readonly userProfileService: UserProfileService,
    private readonly facturasService: FacturasService
  ) {
    this.userName = this.userStateService.userName;
    this.orgSelected = this.userStateService.orgSelected;
    this.userRole = computed(() => this.userStateService.roles().join(','));
  }

  ngOnInit(): void {
    this.loading = true;
    this.respaldoModalSubscription = this.uploadModalService.fileSelected$.subscribe((result) => {
      void this.handleRespaldoSelected(result.file, result.context);
    });

    this.orgEffect = effect(() => {
      const organizacionUUID = this.orgSelected();

      if (!organizacionUUID) {
        this.facturas = [];
        this.filteredFacturas = [];
        return;
      }

      void this.loadFacturas(organizacionUUID);
    }, { injector: this.injector });

    this.socketEffect = effect(() => {
      const notifications = this.notificationSocketService.notifications();
      if (!notifications.length) {
        return;
      }
      const latest = notifications[notifications.length - 1];
      this.handleSocketNotification(latest);
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.orgEffect?.destroy();
    this.socketEffect?.destroy();
    this.respaldoModalSubscription?.unsubscribe();
    if (this.publishedHighlightTimeoutId) {
      clearTimeout(this.publishedHighlightTimeoutId);
    }
  }

  openUploadModal(): void {
    this.modalErrorMessage = '';
    this.isPublicationModalOpen = true;
  }

  closePublicationModal(): void {
    if (this.isPublishing) {
      return;
    }

    this.modalErrorMessage = '';
    this.isPublicationModalOpen = false;
  }

  openMobileFiltersModal(): void {
    this.mobileDraftFilters = { ...this.activeFilters };
    this.isMobileFiltersModalOpen = true;
  }

  closeMobileFiltersModal(): void {
    this.isMobileFiltersModalOpen = false;
  }

  //**
  // ==========================================
  // Bloque para publicar y validar Factura
  // ========================================== */

  async handleFilePublish(file: File): Promise<void> {
    await this.publishFile(file);
  }

  async handleManualFormPublish(data: FacturaData, correlationId: string): Promise<{ data?: FacturaType; errorMsg?: string }> {
    const requestFactura: FacturaCreateRequestDto = {
      facturaId: '',
      ownerUUID: this.orgSelected(),
      numeroFactura: data.numeroFactura,
      rutDeudor: data.rutDeudor,
      nombreDeudor: data.nombreRazonSocialDeudor,
      correlationId,
      montoTotal: data.montoTotal,
      fechaVencimiento: new Date(data.fechaVencimiento),
      fechaEmision: data.fechaEmision ? new Date(data.fechaEmision) : undefined,
      status: facturaEstado.PENDIENTE_AUTORIZACION,
      gestor: {
        uuid: '',
        username: this.userName(),
      },
    };

    this.isPublishing = true;
    try {
      const factura = await this.facturasService.publicarFactura(requestFactura);
      return { data: factura };
    } catch (err: any) {
      const errorMsg = err?.error?.message || err?.message || 'Error desconocido al publicar la factura.';
      console.error('Error al publicar factura manual:', err);
      return { errorMsg };
    } finally {
      this.isPublishing = false;
    }
  }

  /**
   * Se ejecuta cuando Confirma validacion de formulario factura.
   * @param event 
   * @returns 
   */
  async handleFacturaConfirmRequest(event: FacturaConfirmRequestEvent): Promise<void> {
    if (!event.data.factura.facturaId) {
      event.data.onCompleted({ authorized: false, updated: false, status: event.data.factura.status });
      return;
    }

    let versionTerminos: VersionTerminos | null = null;
    try {
      versionTerminos = await this.facturasService.obtenerVersionTerminosActiva();
    } catch { /* usa texto genérico en el modal */ }

    this.pendingTncVersionTerminos = versionTerminos;
    // EB-02: Se abre el modal T&C al confirmar validación, y se pasan callbacks para manejar la respuesta del usuario
    this.pendingTncFactura = event.data.factura;

    this.onTncAcceptedCallback = async () => {
      try {
        await this.facturasService.actualizarEstadoFactura(event.data.factura, facturaEstado.PUBLICADA);
        const updatedFactura: FacturaType = { ...event.data.factura, status: facturaEstado.PUBLICADA };
        this.actualizarFacturaInMemory(updatedFactura);
        event.data.onCompleted({ authorized: true, updated: true, status: facturaEstado.PUBLICADA });
      } catch (err) {
        console.error('Error al publicar factura:', err);
        this.tncErrorMessage = 'Error al publicar la factura. Intente nuevamente.';
        event.data.onCompleted({ authorized: true, updated: false, status: event.data.factura.status });
      }
    };

    this.onTncDismissedCallback = () => {
      event.data.onCompleted({ authorized: false, updated: false, status: event.data.factura.status });
    };
  }

  async handleFacturaCorregirRequest(event: FacturaConfirmRequestEvent): Promise<void> {
    if (!event.data.factura.facturaId) {
      event.data.onCompleted({ authorized: false, updated: false, status: event.data.factura.status });
      return;
    }

    try {
      const nextStatus = facturaEstado.PENDIENTE_VALIDACION;
      await this.facturasService.actualizarEstadoFactura(event.data.factura, nextStatus);
      const updatedFactura: FacturaType = { ...event.data.factura, status: nextStatus };
      this.actualizarFacturaInMemory(updatedFactura);
      event.data.onCompleted({ authorized: true, updated: true, status: nextStatus });
    } catch (err) {
      console.error('Error al reenviar factura:', err);
      event.data.onCompleted({ authorized: false, updated: false, status: event.data.factura.status });
    }
  }


  public async publicarFactura(event: FacturaFormularioPublicacion | FacturaConfirmRequestEvent): Promise<void> {
    const orgInfo = this.userStateService.organizationProfile().find((org: UserOrgProfileState) => org.uuid === this.orgSelected()) || { razonSocial: '', rut: '' };
    switch (event.type) {
      case 'formulario': {
        const data = (event as FacturaFormularioPublicacion).data;
        const optimisticCorrelationId = this.buildOptimisticCorrelationId();

        // Paso 1: Insertar factura optimista en estado PROCESANDO y cerrar el modal inmediatamente
        const newFactura: FacturaType = {
          assetId: '',
          facturaId: '',
          ownerUUID: this.orgSelected(),
          nombre_cliente_cedente: orgInfo.razonSocial || '',
          rut_cliente_cedente: orgInfo.rut || 'Recuperando...',
          gestor: {
            uuid: '',
            username: this.userName(),
          },
          deudorNombre: data.nombreRazonSocialDeudor,
          deudorRut: data.rutDeudor,
          facturaNumero: data.numeroFactura,
          montoTotal: data.montoTotal,
          fechaVencimiento: new Date(data.fechaVencimiento),
          status: facturaEstado.PROCESANDO,
          ofertas_aceptadas: 0,
          ofertas_enviadas: 0,
          ofertas_rechazadas: 0,
          ofertas_revisadas: 0,
          correlationId: optimisticCorrelationId,
          total_ofertas: 0,
          url_factura: 'N/A',
          createdBy: createdBy.FORM,
          notas: []
        };
        this.facturas = [newFactura, ...this.facturas];
        this.applyFiltersAndSort();

        // Paso 2: Enviar al backend (modal sigue abierto — EB-01)
        const { data: facturaCreada, errorMsg } = await this.handleManualFormPublish(data, optimisticCorrelationId);
        if (!facturaCreada) {
          // Error backend — mantener modal abierto y mostrar el error (EB-01)
          this.modalErrorMessage = errorMsg ?? 'Error desconocido al publicar la factura.';
          // Revertir factura optimista
          this.facturas = this.facturas.filter(f => f.correlationId !== optimisticCorrelationId);
          this.applyFiltersAndSort();
          return;
        }

        // Éxito: cerrar modal y limpiar error
        this.isPublicationModalOpen = false;
        this.modalErrorMessage = '';

        // Paso 3: Obtener términos vigentes del backend
        let versionTerminos: VersionTerminos | undefined;
        try {
          versionTerminos = await this.facturasService.obtenerVersionTerminosActiva();
        } catch {
          // Continúa con texto genérico si el fetch falla
        }

        // Paso 4: Abrir modal T&C (callbacks ejecutados al aceptar/descartar)
        this.pendingTncVersionTerminos = versionTerminos ?? null;
        this.pendingTncFactura = facturaCreada;

        this.onTncAcceptedCallback = async () => {
          try {
            if (versionTerminos) {
              await this.facturasService.registrarAutorizacion({
                facturaId: facturaCreada.facturaId,
                versionTerminosId: versionTerminos.id,
                acepto: true,
                correlationId: facturaCreada.correlationId || undefined
              } satisfies AutorizacionPublicacionDto);
            } else {
              await this.facturasService.actualizarEstadoFactura(facturaCreada, facturaEstado.PUBLICADA);
            }
            this.actualizarFacturaInMemory({ ...facturaCreada, status: facturaEstado.PUBLICADA }, optimisticCorrelationId, data);
          } catch (err) {
            console.error('Error al registrar autorización:', err);
            this.tncErrorMessage = 'Error al registrar la autorización. Intente nuevamente.';
          }
        };

        this.onTncDismissedCallback = () => {
          this.actualizarFacturaInMemory(
            { ...facturaCreada, status: facturaEstado.PENDIENTE_AUTORIZACION },
            optimisticCorrelationId,
            data
          );
        };
        break;
      }
      case 'confirmar':
      case 'validar':
        await this.handleFacturaConfirmRequest(event);
        break;
      case 'corregir':
        await this.handleFacturaCorregirRequest(event);
        break;
      default:
        console.warn('Evento de publicación desconocido:', event);
    }
  }


  async handleTncAccepted(): Promise<void> {
    if (!this.onTncAcceptedCallback) {
      return;
    }
    this.isTncSubmitting = true;
    this.tncErrorMessage = '';
    await this.onTncAcceptedCallback();
    this.isTncSubmitting = false;
    if (!this.tncErrorMessage) {
      this.pendingTncFactura = null;
      this.pendingTncVersionTerminos = null;
      this.onTncAcceptedCallback = undefined;
      this.onTncDismissedCallback = undefined;
    }
  }

  handleTncDismissed(): void {
    this.onTncDismissedCallback?.();
    this.pendingTncFactura = null;
    this.pendingTncVersionTerminos = null;
    this.tncErrorMessage = '';
    this.onTncAcceptedCallback = undefined;
    this.onTncDismissedCallback = undefined;
  }

  //**
  // ==========================================
  // Bloque para publicar y validar Factura
  // ========================================== */

  actualizarFacturaInMemory(
    updatedFactura: FacturaType,
    optimisticCorrelationId?: string,
    originalFormValue?: FacturaData
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

  get hasMore(): boolean {
    return this.visibleCount < this.filteredFacturas.length;
  }

  get paginatedFacturas(): FacturaType[] {
    return this.filteredFacturas.slice(0, this.visibleCount);
  }

  loadMore(): void {
    this.visibleCount = Math.min(this.visibleCount + this.pageSize, this.filteredFacturas.length);
  }

  isChipActive(value: string): boolean {
    if (!value) {
      return this.selectedEstadoChips.size === 0;
    }
    return this.selectedEstadoChips.has(value);
  }

  toggleEstadoChip(value: string): void {
    if (!value) {
      this.selectedEstadoChips.clear();
    } else if (this.selectedEstadoChips.has(value)) {
      this.selectedEstadoChips.delete(value);
    } else {
      this.selectedEstadoChips.add(value);
    }
    this.visibleCount = this.pageSize;
    this.applyFiltersAndSort();
  }

  get isAdminUser(): boolean {
    return this.normalizeText(this.userRole()).includes('ADMIN');
  }

  publicationMetadata: ModalPublishMetadata = { numeroFacturaExistentes: [], deudoresExistentes: [] };

  trackByFacturaId(index: number, factura: FacturaType): string {
    return factura.correlationId || String(index);
  }

  private rebuildPublicationMetadata(): void {
    const seen = new Set<string>();
    const deudoresExistentes: ModalPublishMetadata['deudoresExistentes'] = [];
    for (const f of this.facturas) {
      const rut = (f.deudorRut ?? '').trim();
      if (rut && !seen.has(rut)) {
        seen.add(rut);
        deudoresExistentes.push({ rut, nombre: (f.deudorNombre ?? '').trim() });
      }
    }
    const numeroFacturaExistentes = this.facturas
      .map(f => Number.parseInt(f.facturaNumero, 10))
      .filter(n => Number.isFinite(n) && n > 0);
    this.publicationMetadata = { numeroFacturaExistentes, deudoresExistentes };
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

  /**
   * Bloque que resalta la factura publicada recientemente
   * 
   */

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
      
      const facturas = await this.facturasService.getFacturas(organizacionUUID, organizacionUUID);
      // Las continuaciones async dentro de effect() corren fuera de la Angular Zone.
      // ngZone.run() garantiza que las mutaciones de estado activen Change Detection.
      this.ngZone.run(() => {
        this.facturas = facturas;
        this.applyFiltersAndSort();
      });
    } catch (err) {
      this.ngZone.run(() => {
        this.facturas = [];
        this.filteredFacturas = [];
      });
      console.error('Error al obtener facturas:', err);
    } finally {
      this.ngZone.run(() => {
        this.loading = false;
      });
    }
  }

  private applyFiltersAndSort(): void {
    const filters = this.activeFilters;
    let filtered = [...this.facturas];

    if (this.selectedEstadoChips.size > 0) {
      filtered = filtered.filter(factura => this.selectedEstadoChips.has(factura.status));
    } else if (filters.status) {
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
    this.rebuildPublicationMetadata();
  }

  private handleSocketNotification(notification: unknown): void {
    const payload = notification as Record<string, unknown>;
    const eventType = String(payload?.['type'] as string ?? payload?.['event'] as string ?? '');
    const facturaId = String(payload?.['facturaId'] as string ?? payload?.['factura_id'] as string ?? '');

    if (!facturaId) {
      return;
    }

    const target = this.facturas.find(f => f.facturaId === facturaId || f.correlationId === facturaId);
    if (!target) {
      return;
    }

    if (eventType === 'factura.ocr_completado' || eventType === 'ocr_completado') {
      const updatedFactura: FacturaType = {
        ...target,
        status: facturaEstado.PENDIENTE_AUTORIZACION,
        notas: (payload?.['notas'] as string[]) ?? target.notas
      };
      this.actualizarFacturaInMemory(updatedFactura);
      return;
    }

    if (eventType === 'factura.estado_cambiado' || eventType === 'estado_cambiado') {
      const newStatus = String(payload?.['status'] as string ?? payload?.['estado'] as string ?? '') as facturaEstado;
      if (newStatus) {
        const updatedFactura: FacturaType = { ...target, status: newStatus };
        this.actualizarFacturaInMemory(updatedFactura);
      }
      return;
    }

    if (eventType === 'oferta.nueva' || eventType === 'nueva_oferta') {
      const updatedFactura: FacturaType = {
        ...target,
        total_ofertas: Number(target.total_ofertas ?? 0) + 1
      };
      this.actualizarFacturaInMemory(updatedFactura);
    }
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
    } catch (err) {
      console.error('Error al actualizar factura:', err);
      onError();
    }
  }

  handleUploadRespaldoRequest(event: FacturaRespaldoRequestEvent): void {
    const factura = event.factura;
    const contextKey = this.getFacturaRespaldoContextKey(factura);
    if (!contextKey) {
      Swal.fire({
        icon: 'warning',
        title: 'No se pudo abrir carga',
        text: 'La factura no tiene identificador para asociar el respaldo.'
      });
      return;
    }

    if (this.hasFacturaAssetAnexo(factura)) {
      Swal.fire({
        icon: 'info',
        title: 'Factura con respaldo',
        text: 'Esta factura ya tiene un respaldo asociado. ¿Deseas reemplazarlo?',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
      }).then((result: { isConfirmed: boolean }) => {
        if (!result.isConfirmed) {
          return;
        }
        this.uploadModalService.open({
          title: 'Subir respaldo',
          hint: 'Selecciona el nuevo respaldo de la factura para reemplazar el anterior.',
          accept: '.pdf,image/*',
          context: `${this.respaldoModalContextPrefix}${contextKey}`
        });
      });
      return;
    }

    this.uploadModalService.open({
      title: 'Subir respaldo',
      hint: 'Selecciona el respaldo de la factura para anexarlo.',
      accept: '.pdf,image/*',
      context: `${this.respaldoModalContextPrefix}${contextKey}`
    });
  }

  private async handleRespaldoSelected(file: File, context?: string): Promise<void> {
    const safeContext = String(context ?? '');
    if (!safeContext.startsWith(this.respaldoModalContextPrefix)) {
      return;
    }

    const contextKey = safeContext.slice(this.respaldoModalContextPrefix.length).trim();
    if (!contextKey) {
      return;
    }

    const factura = this.findFacturaByRespaldoContext(contextKey);
    if (!factura) {
      Swal.fire({
        icon: 'warning',
        title: 'Factura no encontrada',
        text: 'No se encontró la factura para asociar el respaldo.'
      });
      return;
    }

    if (this.hasFacturaAssetAnexo(factura)) {
      const confirmReplace = await Swal.fire({
        icon: 'info',
        title: 'Factura con respaldo',
        text: 'La factura ya tiene respaldo asociado. ¿Deseas reemplazarlo?',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
      });

      if (!confirmReplace.isConfirmed) {
        return;
      }
    }

    const facturaId = String(factura.facturaId ?? '').trim();
    if (!facturaId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Factura sin identificador',
        text: 'No se puede anexar respaldo porque la factura no tiene idFactura.'
      });
      return;
    }

    try {
      const { uuid } = await this.resolveCurrentUserName();
      const respaldoTypeUpload = PATH_TYPES.DTE_FACTURA_RESPALDO || 'DTE-factura-respaldo';
      const respuesta = await this.objectUploadService.uploadFileUsingPresignedUrl(
        this.apiBase,
        respaldoTypeUpload,
        file,
        uuid,
        this.orgSelected(),
        facturaId
      );

      if (!respuesta?.objectUrl) {
        throw new Error('No se obtuvo URL del respaldo subido.');
      }

      this.facturas = this.facturas.map((item) => {
        if (!this.matchesFacturaContext(item, contextKey)) {
          return item;
        }

        const updated = {
          ...item,
          storage_key: respuesta.objectUrl
        } as FacturaType & { objectUrl?: string };
        updated.objectUrl = respuesta.objectUrl;
        return updated;
      });

      this.applyFiltersAndSort();

      await Swal.fire({
        icon: 'success',
        title: 'Respaldo cargado',
        text: 'El respaldo se subió correctamente.'
      });
    } catch (error: any) {
      console.error('Error al subir respaldo de factura:', error);
      await Swal.fire({
        icon: 'error',
        title: 'Error al subir respaldo',
        text: error?.message || 'No se pudo subir el respaldo de la factura.'
      });
    }
  }

  private getFacturaRespaldoContextKey(factura: FacturaType): string {
    const facturaId = this.normalizeText(factura.facturaId).toLowerCase();
    if (facturaId) {
      return `id:${facturaId}`;
    }

    const correlationId = this.normalizeText(factura.correlationId).toLowerCase();
    if (correlationId) {
      return `corr:${correlationId}`;
    }

    return '';
  }

  private findFacturaByRespaldoContext(contextKey: string): FacturaType | undefined {
    return this.facturas.find((item) => this.matchesFacturaContext(item, contextKey));
  }

  private matchesFacturaContext(factura: FacturaType, contextKey: string): boolean {
    if (contextKey.startsWith('id:')) {
      return this.normalizeText(factura.facturaId).toLowerCase() === contextKey.slice(3);
    }

    if (contextKey.startsWith('corr:')) {
      return this.normalizeText(factura.correlationId).toLowerCase() === contextKey.slice(5);
    }

    return false;
  }

  private hasFacturaAssetAnexo(factura: FacturaType): boolean {
    const assetId = String(factura.assetId ?? '').trim();
    if (assetId) {
      return true;
    }

    const dynamicFactura = factura as FacturaType & { objectUrl?: string };
    const source = String(dynamicFactura.objectUrl ?? factura.url_factura ?? '').trim();
    if (!source || source.toUpperCase() === 'N/A') {
      return false;
    }

    return source.startsWith('http://')
      || source.startsWith('https://')
      || source.startsWith('blob:')
      || source.startsWith('data:')
      || source.includes('.pdf')
      || source.includes('.png')
      || source.includes('.jpg')
      || source.includes('.jpeg')
      || source.includes('.webp');
  }

  private async resolveCurrentUserName(): Promise<{ username: string; uuid: string }> {
    let currentUserName = (this.userStateService.userName() || '').trim();
    if (!currentUserName) {
      const profile = await this.userProfileService.getUserProfile(this.apiBase);
      currentUserName = (profile?.username || '').trim();
      if (currentUserName) {
        this.userStateService.patch({ username: currentUserName });
      }
    }

    if (!currentUserName) {
      throw new Error('No se pudo resolver el usuario para subir el respaldo.');
    }

    const uuid = (this.userStateService.state().id || '').trim();
    return { username: currentUserName, uuid };
  }

  private async publishFile(file: File): Promise<void> {
    this.isPublishing = true;
    try {
      const { uuid } = await this.resolveCurrentUserName();

      const respuesta = await this.objectUploadService.uploadFileUsingPresignedUrl(
        this.apiBase,
        PATH_TYPES.DOCUMENT,
        file,
        uuid,
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
