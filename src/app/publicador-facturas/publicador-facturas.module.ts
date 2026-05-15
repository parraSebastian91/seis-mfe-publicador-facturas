import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { CdkAutofill } from "@angular/cdk/text-field";
import { ImagePanzoomViewerComponent } from './component/image-panzoom-viewer/image-panzoom-viewer.component';
import { ModalPublicacionFacturaComponent } from './component/modal-publicacion-factura/modal-publicacion-factura.component';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';
import { AtomicDatepickerComponent } from './component/atomic-datepicker/atomic-datepicker.component';
@NgModule({
  declarations: [
    PublicadorFacturasComponent,
    FacturaViewComponent,
    ImagePanzoomViewerComponent,
    ModalPublicacionFacturaComponent,
    AtomicDatepickerComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    PublicadorFacturasRoutingModule,
    MatExpansionModule,
    MatIconModule,
    MatBadgeModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    CdkAutofill
  ],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'es-CL' }
  ]
})
export class PublicadorFacturasModule { }
