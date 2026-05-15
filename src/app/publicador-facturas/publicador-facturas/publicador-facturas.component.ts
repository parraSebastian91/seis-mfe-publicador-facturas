import { Component, EffectRef, Injector, OnDestroy, OnInit, Signal, effect, signal } from '@angular/core';
import { FacturaResponseUpdateDTO, FacturaType, ObjectUploadService, PATH_TYPES, UserStateService } from 'shared-utils';
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
  
 

  constructor(
    private injector: Injector,
    private objectUploadService: ObjectUploadService,
    private userStateService: UserStateService,
    private facturasService: FacturasService
  ) {
    
    this.orgSelected = this.userStateService.orgSelected;
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
    const xmlContent = this.buildFacturaXml(formValue);
    const fileName = `factura-manual-${Date.now()}.xml`;
    const manualFile = new File([xmlContent], fileName, { type: 'application/xml' });
    await this.publishFile(manualFile);
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

  private buildFacturaXml(formValue: FacturaManualFormValue): string {
    const escapedNumeroFactura = this.escapeXml(formValue.numeroFactura);
    const escapedRutDeudor = this.escapeXml(formValue.rutDeudor);
    const escapedNombreDeudor = this.escapeXml(formValue.nombreRazonSocialDeudor);
    const escapedMontoTotal = this.escapeXml(String(formValue.montoTotal));
    const escapedFechaVencimiento = this.escapeXml(formValue.fechaVencimiento);
    const escapedGestor = this.escapeXml(this.userStateService.userName());
    const escapedMandante = this.escapeXml(this.orgSelected());

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<FacturaManual>',
      `  <NumeroFactura>${escapedNumeroFactura}</NumeroFactura>`,
      `  <RutDeudor>${escapedRutDeudor}</RutDeudor>`,
      `  <NombreRazonSocialDeudor>${escapedNombreDeudor}</NombreRazonSocialDeudor>`,
      `  <MontoTotal>${escapedMontoTotal}</MontoTotal>`,
      `  <FechaVencimiento>${escapedFechaVencimiento}</FechaVencimiento>`,
      `  <Gestor>${escapedGestor}</Gestor>`,
      `  <Organizacion>${escapedMandante}</Organizacion>`,
      '</FacturaManual>'
    ].join('\n');
  }

  private escapeXml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }


}
