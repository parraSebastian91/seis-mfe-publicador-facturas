import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PublicadorFacturasComponent } from './publicador-facturas/publicador-facturas.component';

const routes: Routes = [
  {
    path: '',
    component: PublicadorFacturasComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PublicadorFacturasRoutingModule { }
