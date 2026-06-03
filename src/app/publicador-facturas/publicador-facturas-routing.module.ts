import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';
import { FacturaDetalleComponent } from './component/factura-detalle/factura-detalle.component';

const routes: Routes = [
  {
    path: '',
    component: PublicadorFacturasComponent
  },
  {
    path: 'factura/:id',
    component: FacturaDetalleComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PublicadorFacturasRoutingModule { }
