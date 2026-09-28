import { NgModule, LOCALE_ID } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import localeEsCl from '@angular/common/locales/es-CL';
import { FormsModule } from '@angular/forms';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { FacturaViewComponent } from './component/factura-view/factura-view.component';
import { CdkAutofill } from '@angular/cdk/text-field';
import { ModalPublicacionFacturaComponent } from './component/modal-publicacion-factura/modal-publicacion-factura.component';
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
  ButtonComponent,
  IconButtonComponent,
  IconComponent,
  DatepickerComponent,
  DocumentViewerComponent,
} from 'shared-utils';

registerLocaleData(localeEsCl);

@NgModule({
  declarations: [
    PublicadorFacturasComponent,
    FacturaViewComponent,
    ModalPublicacionFacturaComponent,
    AtomicFacturaFiltersComponent,
    TermsAndConditionsModalComponent,
    FacturaDetalleComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    PublicadorFacturasRoutingModule,
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
    ButtonComponent,
    IconButtonComponent,
    IconComponent,
    // Reemplaza AtomicDatepickerComponent + NgbDatepickerModule: con esto el MFE
    // deja de depender de @ng-bootstrap/ng-bootstrap (era su único uso).
    DatepickerComponent,
    // Reemplaza ImagePanzoomViewerComponent; mismo visor que usa el ofertador.
    DocumentViewerComponent,
  ],
  providers: [
    { provide: LOCALE_ID, useValue: 'es-CL' },
  ],
})
export class PublicadorFacturasModule {}
