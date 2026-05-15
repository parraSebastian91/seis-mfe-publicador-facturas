import { NgModule } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import localeEsCl from '@angular/common/locales/es-CL';
import { FormsModule } from '@angular/forms';
import { LOCALE_ID } from '@angular/core';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { CdkAutofill } from "@angular/cdk/text-field";
import { ImagePanzoomViewerComponent } from './component/image-panzoom-viewer/image-panzoom-viewer.component';
import { ModalPublicacionFacturaComponent } from './component/modal-publicacion-factura/modal-publicacion-factura.component';
import { NgbDatepickerModule } from '@ng-bootstrap/ng-bootstrap';
import { AtomicDatepickerComponent } from './component/atomic-datepicker/atomic-datepicker.component';

registerLocaleData(localeEsCl);
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
    NgbDatepickerModule,
    CdkAutofill
  ],
  providers: [
    { provide: LOCALE_ID, useValue: 'es-CL' }
  ]
})
export class PublicadorFacturasModule { }
