import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { CdkAutofill } from "@angular/cdk/text-field";
@NgModule({
  declarations: [
    PublicadorFacturasComponent,
    FacturaViewComponent
  ],
  imports: [
    CommonModule,
    PublicadorFacturasRoutingModule,
    MatExpansionModule,
    NgxExtendedPdfViewerModule,
    MatIconModule,
    MatBadgeModule,
    CdkAutofill
]
})
export class PublicadorFacturasModule { }
