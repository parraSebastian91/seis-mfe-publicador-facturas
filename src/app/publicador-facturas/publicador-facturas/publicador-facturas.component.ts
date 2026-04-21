import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { UploadModalResult, UploadModalService } from 'shared-utils';

@Component({
  selector: 'app-publicador-facturas',
  templateUrl: './publicador-facturas.component.html',
  styleUrl: './publicador-facturas.component.scss',
  standalone: false
})
export class PublicadorFacturasComponent implements OnInit, OnDestroy {
  private readonly uploadModalService = inject(UploadModalService);

  ultimasPublicaciones = [
    { folio: 'FAC-2026-00121', estado: 'Publicado' },
    { folio: 'FAC-2026-00122', estado: 'En validacion' },
    { folio: 'FAC-2026-00123', estado: 'Pendiente' }
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.uploadModalService.fileSelected$.subscribe((result: UploadModalResult) => {
      if (result.context !== 'publicador-facturas') return;
      console.log('Factura recibida para publicar:', result.file.name);
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
