import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./publicador-facturas/publicador-facturas.module').then(m => m.PublicadorFacturasModule)
  },
  {
    path: '**',
    redirectTo: 'publicador',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
