import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { CdkAutofill } from "@angular/cdk/text-field";
import { ImagePanzoomViewerComponent } from './component/image-panzoom-viewer/image-panzoom-viewer.component';
@NgModule({
  declarations: [
    PublicadorFacturasComponent,
    FacturaViewComponent,
    ImagePanzoomViewerComponent
  ],
  imports: [
    CommonModule,
    PublicadorFacturasRoutingModule,
    MatExpansionModule,
    MatIconModule,
    MatBadgeModule,
    CdkAutofill
]
})
export class PublicadorFacturasModule { }
