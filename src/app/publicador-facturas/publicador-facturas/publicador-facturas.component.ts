import { Component } from '@angular/core';

@Component({
  selector: 'app-publicador-facturas',
  templateUrl: './publicador-facturas.component.html',
  styleUrl: './publicador-facturas.component.scss',
  standalone: false
})
export class PublicadorFacturasComponent {
  ultimasPublicaciones = [
    { folio: 'FAC-2026-00121', estado: 'Publicado' },
    { folio: 'FAC-2026-00122', estado: 'En validacion' },
    { folio: 'FAC-2026-00123', estado: 'Pendiente' }
  ];
}
