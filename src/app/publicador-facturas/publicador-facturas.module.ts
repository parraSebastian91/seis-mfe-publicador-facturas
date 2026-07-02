import { NgModule, LOCALE_ID } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import localeEsCl from '@angular/common/locales/es-CL';
import { FormsModule } from '@angular/forms';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
// Única excepción Angular Material permitida: solo iconografía, sin estilos adicionales.
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CdkAutofill } from '@angular/cdk/text-field';
import { ImagePanzoomViewerComponent } from './component/image-panzoom-viewer/image-panzoom-viewer.component';
import { ModalPublicacionFacturaComponent } from './component/modal-publicacion-factura/modal-publicacion-factura.component';
// ng-bootstrap (no Angular Material): usado por AtomicDatepickerComponent.
import { NgbDatepickerModule } from '@ng-bootstrap/ng-bootstrap';
import { AtomicDatepickerComponent } from './component/atomic-datepicker/atomic-datepicker.component';
import { AtomicFacturaFiltersComponent } from './component/atomic-factura-filters/atomic-factura-filters.component';
import { A11yModule } from '@angular/cdk/a11y';
import { TermsAndConditionsModalComponent } from './component/terms-and-conditions-modal/terms-and-conditions-modal.component';
import { FacturaDetalleComponent } from './component/factura-detalle/factura-detalle.component';
import {
  NegotiationChatComponent,
  ExpansionPanelComponent,
  PanelHeaderDirective,
  PanelContentDirective,
  PanelFooterDirective,
  CardComponent,
  CardTitleDirective,
  CardFooterDirective,
  AdjuntosListComponent,
} from 'shared-utils';

registerLocaleData(localeEsCl);

@NgModule({
  declarations: [
    PublicadorFacturasComponent,
    FacturaViewComponent,
    ImagePanzoomViewerComponent,
    ModalPublicacionFacturaComponent,
    AtomicDatepickerComponent,
    AtomicFacturaFiltersComponent,
    TermsAndConditionsModalComponent,
    FacturaDetalleComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    PublicadorFacturasRoutingModule,
    MatIconModule,
    MatProgressSpinnerModule,
    NgbDatepickerModule,
    CdkAutofill,
    A11yModule,
    NegotiationChatComponent,
    // Sistema de diseño propio — reemplaza MatExpansionModule + MatBadgeModule
    ExpansionPanelComponent,
    PanelHeaderDirective,
    PanelContentDirective,
    PanelFooterDirective,
    CardComponent,
    CardTitleDirective,
    CardFooterDirective,
    AdjuntosListComponent,
  ],
  providers: [
    { provide: LOCALE_ID, useValue: 'es-CL' },
  ],
})
export class PublicadorFacturasModule {}
