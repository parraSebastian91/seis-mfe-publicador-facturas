import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PublicadorFacturasRoutingModule } from './publicador-facturas-routing.module';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';

@NgModule({
  declarations: [PublicadorFacturasComponent],
  imports: [
    CommonModule,
    PublicadorFacturasRoutingModule
  ]
})
export class PublicadorFacturasModule { }
