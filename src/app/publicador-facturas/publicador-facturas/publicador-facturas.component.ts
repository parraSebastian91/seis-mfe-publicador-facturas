import { Component, EffectRef, Injector, OnDestroy, OnInit, Signal, effect, signal } from '@angular/core';
import { FacturaCreateRequestDto, facturaEstado, FacturaResponseUpdateDTO, FacturaType, ObjectUploadService, PATH_TYPES, UserOrgProfileState, UserStateService } from 'shared-utils';
import { FacturasService } from '../../../../../shared-utils/src/lib/services/facturas/factura.service';
import { FacturaManualFormValue } from '../component/modal-publicacion-factura/modal-publicacion-factura.component';

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

  facturas: FacturaType[] = [];
  isPublicationModalOpen = false;
  isPublishing = false;

  private orgEffect?: EffectRef;
  readonly orgSelected!: Signal<string>;
  readonly userName!: Signal<string>;
  readonly orgSelectedInfo!: Signal<UserOrgProfileState | null>;

  constructor(
    private injector: Injector,
    private objectUploadService: ObjectUploadService,
    private userStateService: UserStateService,
    private facturasService: FacturasService
  ) {
    this.userName = this.userStateService.userName;
    this.orgSelected = this.userStateService.orgSelected;
    this.orgSelectedInfo = this.userStateService.getOrgSelectedInfo;
  }

  ngOnInit(): void {
    this.orgEffect = effect(() => {
      const organizacionUUID = this.orgSelected();

      if (!organizacionUUID) {
        this.facturas = [];
        return;
      }

      void this.loadFacturas(organizacionUUID);
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.orgEffect?.destroy();
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

  async handleFilePublish(file: File): Promise<void> {
    await this.publishFile(file);
  }

  async handleManualFormPublish(formValue: FacturaManualFormValue): Promise<void> {
    const optimisticCorrelationId = this.buildOptimisticCorrelationId();

    const newFactura: FacturaType = {
      assetId: '',
      facturaId: '',
      ownerUUID: this.orgSelected(),
      nombre_mandante: this.orgSelectedInfo()?.razonSocial || '',
      rut_mandante: this.orgSelectedInfo()?.rut || 'Recuperando...', // Podríamos obtenerlo de orgSelectedInfo si lo tuviéramos allí
      gestor: this.userName(),
      gestorUUID: '',
      deudorNombre: formValue.nombreRazonSocialDeudor,
      deudorRut: formValue.rutDeudor,
      facturaNumero: formValue.numeroFactura,
      montoTotal: formValue.montoTotal,
      fechaVencimiento: new Date(formValue.fechaVencimiento),
      status: facturaEstado.PROCESANDO,
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
      gestor: this.userName(),
    };

    this.facturas = [newFactura, ...this.facturas];
    this.isPublicationModalOpen = false;

    this.isPublishing = true;
    try {
      const response = await this.facturasService.publicarFactura(requestFactura);
      console.log('Factura publicada:', response);
      this.actualizarFacturaInMemory(response, optimisticCorrelationId, formValue);
    } catch (err) {
      console.error('Error al publicar factura manual:', err);
    } finally {
      this.isPublishing = false;
    }
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
      return;
    }

    this.facturas = this.facturas.map(factura => (shouldReplace(factura) ? updatedFactura : factura));
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

  private async loadFacturas(organizacionUUID: string): Promise<void> {
    try {
      const facturas = await this.facturasService.getFacturas(organizacionUUID);
      this.facturas = facturas;
      console.log('Facturas obtenidas:', facturas);
    } catch (err) {
      this.facturas = [];
      console.error('Error al obtener facturas:', err);
    }
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
      const respuesta = await this.objectUploadService.uploadFileUsingPresignedUrl(
        this.apiBase,
        PATH_TYPES.DOCUMENT,
        file,
        this.userStateService.userName(),
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
