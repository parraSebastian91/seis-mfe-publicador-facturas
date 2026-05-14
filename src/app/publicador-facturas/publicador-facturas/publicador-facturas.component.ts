import { Component, EffectRef, Injector, OnDestroy, OnInit, Signal, effect } from '@angular/core';
import { Subscription } from 'rxjs';
import { FacturaType, ObjectUploadService, PATH_TYPES, UploadModalResult, UploadModalService, UserStateService } from 'shared-utils';
import { FacturasService } from '../../../../../shared-utils/src/lib/services/facturas/factura.service';


@Component({
  selector: 'app-publicador-facturas',
  templateUrl: './publicador-facturas.component.html',
  styleUrl: './publicador-facturas.component.scss',
  standalone: false
})
export class PublicadorFacturasComponent implements OnInit, OnDestroy {
  // private readonly uploadModalService = inject(UploadModalService);
  // private readonly objectUploadService = inject(ObjectUploadService);
  private readonly apiBase = 'http://localhost:8000';

  facturas: FacturaType[] = [];

  private sub?: Subscription;
  private orgEffect?: EffectRef;
  readonly orgSelected!: Signal<string>;

  constructor(
    private injector: Injector,
    private objectUploadService: ObjectUploadService,
    private uploadModalService: UploadModalService,
    private userStateService: UserStateService,
    private facturasService: FacturasService
  ) {
    this.orgSelected = this.userStateService.orgSelected;
  }

  ngOnInit(): void {
    this.sub = this.uploadModalService.fileSelected$.subscribe(async (result: UploadModalResult) => {
      if (result.context !== 'publicador-facturas') return;
      try {

        const respuesta = await this.objectUploadService.uploadFileUsingPresignedUrl(this.apiBase, PATH_TYPES.DOCUMENT, result.file, this.userStateService.userName(), this.orgSelected());

        if (!respuesta?.objectUrl) {
          throw new Error('Presigned URL not received from API.');
        }

        console.log('Factura subida correctamente:', {
          fileName: result.file.name,
          key: respuesta.key,
          url: respuesta.objectUrl.split('?')[0]
        });

        await this.loadFacturas(this.orgSelected());
      } catch (err) {
        console.error('Error al subir factura con presigned URL:', err);
      }
    });

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
    this.sub?.unsubscribe();
    this.orgEffect?.destroy();
  }

  openUploadModal(): void {
    this.uploadModalService.open({
      context: 'publicador-facturas',
      title: 'Publicar factura',
      hint: 'Acepta PDF, XML o imagen (JPG/PNG).',
      accept: '.pdf,.xml,image/*'
    });
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

  async handleFacturaChange(event: { factura: FacturaType, campoNombre: string, value: string }): Promise<void> {
    const { factura, campoNombre, value } = event;
    try {
      const response = await this.facturasService.updateFactura(factura, campoNombre, value);
      console.log('Factura actualizada:', response);
      //await this.loadFacturas(this.orgSelected());
    } catch (err) {
      console.error('Error al actualizar factura:', err);
    }
  }

}
