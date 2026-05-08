import { Component, OnDestroy, OnInit, Signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ObjectUploadService, PATH_TYPES, UploadModalResult, UploadModalService, UserStateService } from 'shared-utils';


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

  ultimasPublicaciones = [
    { folio: 'FAC-2026-00121', estado: 'Publicado' },
    { folio: 'FAC-2026-00122', estado: 'En validacion' },
    { folio: 'FAC-2026-00123', estado: 'Pendiente' }
  ];

  private sub?: Subscription;
  readonly orgSelected!: Signal<string>;

  constructor(
    private objectUploadService: ObjectUploadService,
    private uploadModalService: UploadModalService,
    private userStateService: UserStateService,
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
      } catch (err) {
        console.error('Error al subir factura con presigned URL:', err);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  openUploadModal(): void {
    this.uploadModalService.open({
      context: 'publicador-facturas',
      title: 'Publicar factura',
      hint: 'Acepta PDF, XML o imagen (JPG/PNG).',
      accept: '.pdf,.xml,image/*'
    });
  }
}
