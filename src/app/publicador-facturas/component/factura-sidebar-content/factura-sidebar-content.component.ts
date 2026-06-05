import { Component, EventEmitter, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DrawerContent, DrawerService } from 'shared-utils';
import { FacturaType } from 'shared-utils';

// ── Tipos de entrada/salida ──────────────────────────────────────────────────

export interface FacturaSidebarInputs {
  factura: FacturaType;
  estadoFactura: string;
  ofertasCount: number;
  notificaciones: string[];
}

export type FacturaSidebarEvent =
  | { type: 'CLOSE' }
  | { type: 'ACCION'; payload: unknown };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contenido del drawer de detalle de factura (Publicador MFE).
 * Implementa DrawerContent para poder recibir datos del caller y emitirle eventos.
 *
 * El caller (FacturaViewComponent) recibe eventos via:
 *   drawerService.open({ component: FacturaSidebarContentComponent, inputs: {...} })
 *     .subscribe(event => { ... });
 */
@Component({
  selector: 'app-factura-sidebar-content',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <!-- Ofertas -->
    <section class="sidebar-section">
      <h4 class="sidebar-section-title">
        <mat-icon class="section-icon">sell</mat-icon>
        Ofertas
      </h4>

      @if (!drawerInputs.ofertasCount) {
        <p class="sidebar-empty">Sin ofertas recibidas aún.</p>
      } @else {
        <div class="sidebar-offers-count">
          <mat-icon class="sidebar-offer-icon">sell</mat-icon>
          <span>{{ drawerInputs.ofertasCount }} oferta(s) recibida(s)</span>
        </div>
      }
    </section>

    <hr class="sidebar-divider" />

    <!-- Estado -->
    <section class="sidebar-section">
      <h4 class="sidebar-section-title">
        <mat-icon class="section-icon">info</mat-icon>
        Actividad
      </h4>
      <div class="activity-item">
        <mat-icon class="activity-icon">fact_check</mat-icon>
        <span>Estado actual: <strong>{{ drawerInputs.estadoFactura }}</strong></span>
      </div>
    </section>

    <hr class="sidebar-divider" />

    <!-- Notificaciones / notas OCR -->
    <section class="sidebar-section">
      <h4 class="sidebar-section-title">
        <mat-icon class="section-icon">notifications</mat-icon>
        Mensajes del sistema
      </h4>

      @if (!drawerInputs.notificaciones.length) {
        <p class="sidebar-empty">Sin mensajes en este hilo.</p>
      } @else {
        <ul class="notif-list">
          @for (nota of drawerInputs.notificaciones; track nota) {
            <li class="notif-item">
              <mat-icon class="notif-icon">arrow_right</mat-icon>
              <span>{{ nota }}</span>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }

    .sidebar-section { margin-bottom: 20px; }

    .sidebar-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 12px;
      font-size: .875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: var(--text-secondary, #666);
    }

    .section-icon { font-size: 16px; width: 16px; height: 16px; }

    .sidebar-empty {
      font-size: .875rem;
      color: var(--text-secondary, #888);
      margin: 0;
    }

    .sidebar-offers-count {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: .9rem;
    }

    .activity-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: .875rem;
    }

    .sidebar-divider {
      border: none;
      border-top: 1px solid var(--divider, #e0e0e0);
      margin: 0 0 20px;
    }

    .notif-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .notif-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: .875rem;
      line-height: 1.4;
    }

    .notif-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; }
  `],
})
export class FacturaSidebarContentComponent
  implements DrawerContent<FacturaSidebarInputs, FacturaSidebarEvent>, OnInit {

  @Input() drawerInputs!: FacturaSidebarInputs;
  readonly drawerEvent = new EventEmitter<FacturaSidebarEvent>();

  constructor(private readonly drawerService: DrawerService) {}

  ngOnInit(): void {
    // Reenvía los eventos locales al bus del DrawerService
    // para que el caller los reciba via el Observable de open()
    this.drawerEvent.subscribe(event => this.drawerService.emit(event));
  }
}
