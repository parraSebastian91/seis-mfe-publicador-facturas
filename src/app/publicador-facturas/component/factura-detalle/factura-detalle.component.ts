import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FacturasService } from '../../../../../../shared-utils/src/lib/services/facturas/factura.service';
import { facturaEstado, FacturaType, OfertaDetalleType, ofertaEstado } from 'shared-utils';

@Component({
  selector: 'app-factura-detalle',
  templateUrl: './factura-detalle.component.html',
  styleUrl: './factura-detalle.component.scss',
  standalone: false
})
export class FacturaDetalleComponent implements OnInit {
  factura: FacturaType | null = null;
  ofertas: OfertaDetalleType[] = [];
  isLoading = true;
  loadError = '';

  readonly selectedOfertaIds = new Set<string>();
  showCompareModal = false;
  confirmOferta: OfertaDetalleType | null = null;
  rejectingOfertaId: string | null = null;
  rejectMotivo = '';

  isAccepting = false;
  acceptError = '';
  isRejecting = false;
  rejectError = '';

  readonly ofertaEstadoEnum = ofertaEstado;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly facturasService: FacturasService
  ) {}

  ngOnInit(): void {
    const facturaId = String(this.route.snapshot.paramMap.get('id') ?? '');
    if (!facturaId) {
      this.router.navigate(['..'], { relativeTo: this.route }).catch(console.error);
      return;
    }
    this.loadData(facturaId).catch(console.error);
  }

  private async loadData(facturaId: string): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const [factura, ofertas] = await Promise.all([
        this.facturasService.getFacturaById(facturaId),
        this.facturasService.getOfertasByFacturaId(facturaId)
      ]);
      this.factura = factura;
      this.ofertas = ofertas;
    } catch {
      this.loadError = 'No se pudo cargar la factura. Redirigiendo...';
      setTimeout(() => { this.router.navigate(['..'], { relativeTo: this.route }).catch(console.error); }, 2500);
    } finally {
      this.isLoading = false;
    }
  }

  goBack(): void {
    this.router.navigate(['..'], { relativeTo: this.route }).catch(console.error);
  }

  // ─── Comparison ───────────────────────────────────────────────────────────

  toggleCompare(ofertaId: string): void {
    if (this.selectedOfertaIds.has(ofertaId)) {
      this.selectedOfertaIds.delete(ofertaId);
    } else if (this.selectedOfertaIds.size < 3) {
      this.selectedOfertaIds.add(ofertaId);
    }
  }

  get selectedOfertas(): OfertaDetalleType[] {
    return this.ofertas.filter(o => this.selectedOfertaIds.has(o.ofertaId));
  }

  openCompareModal(): void {
    this.showCompareModal = true;
  }

  closeCompareModal(): void {
    this.showCompareModal = false;
  }

  // ─── Accept ───────────────────────────────────────────────────────────────

  openAcceptConfirm(oferta: OfertaDetalleType): void {
    this.confirmOferta = oferta;
    this.acceptError = '';
    this.showCompareModal = false;
  }

  closeAcceptConfirm(): void {
    if (!this.isAccepting) {
      this.confirmOferta = null;
      this.acceptError = '';
    }
  }

  async confirmarAceptar(): Promise<void> {
    if (!this.confirmOferta) {
      return;
    }
    this.isAccepting = true;
    this.acceptError = '';
    const ofertaId = this.confirmOferta.ofertaId;
    try {
      await this.facturasService.aceptarOferta(ofertaId);
      this.ofertas = this.ofertas.map(o => {
        let nuevoEstado = o.estado;
        if (o.ofertaId === ofertaId) {
          nuevoEstado = ofertaEstado.ACEPTADA;
        } else if (o.estado === ofertaEstado.ACTIVA) {
          nuevoEstado = ofertaEstado.RECHAZADA;
        }
        return { ...o, estado: nuevoEstado };
      });
      if (this.factura) {
        this.factura = { ...this.factura, status: facturaEstado.FINANCIADA };
      }
      this.confirmOferta = null;
    } catch {
      this.acceptError = 'Error al aceptar la oferta. Intente nuevamente.';
    } finally {
      this.isAccepting = false;
    }
  }

  // ─── Reject ───────────────────────────────────────────────────────────────

  startReject(ofertaId: string): void {
    this.rejectingOfertaId = ofertaId;
    this.rejectMotivo = '';
    this.rejectError = '';
  }

  cancelReject(): void {
    this.rejectingOfertaId = null;
    this.rejectMotivo = '';
    this.rejectError = '';
  }

  async confirmarRechazar(): Promise<void> {
    if (!this.rejectingOfertaId) {
      return;
    }
    this.isRejecting = true;
    this.rejectError = '';
    const ofertaId = this.rejectingOfertaId;
    try {
      await this.facturasService.rechazarOferta(ofertaId, this.rejectMotivo || undefined);
      this.ofertas = this.ofertas.map(o =>
        o.ofertaId === ofertaId ? { ...o, estado: ofertaEstado.RECHAZADA } : o
      );
      this.rejectingOfertaId = null;
      this.rejectMotivo = '';
    } catch {
      this.rejectError = 'Error al rechazar la oferta. Intente nuevamente.';
    } finally {
      this.isRejecting = false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getDiasRestantes(fechaVigencia: Date | string): number {
    const diff = new Date(fechaVigencia).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  getBestValue(
    field: 'montoAnticipo' | 'tasaMensual' | 'gastosOperacionales' | 'liquidoRecibir',
    ofertaId: string
  ): boolean {
    const comparison = this.selectedOfertas;
    if (comparison.length < 2) {
      return false;
    }
    const target = comparison.find(o => o.ofertaId === ofertaId);
    if (!target) {
      return false;
    }
    const values = comparison.map(o => o[field]);
    const lowerIsBetter = field === 'tasaMensual' || field === 'gastosOperacionales';
    const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
    return target[field] === best;
  }

  isOfertaActiva(oferta: OfertaDetalleType): boolean {
    return oferta.estado === ofertaEstado.ACTIVA;
  }

  get hasOnlyInactiveOfertas(): boolean {
    return this.ofertas.length > 0 && !this.ofertas.some(o => o.estado === ofertaEstado.ACTIVA);
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      PROCESANDO: 'procesando',
      PENDIENTE_VALIDACION: 'pendiente',
      PENDIENTE_AUTORIZACION: 'pendiente-auth',
      PUBLICADA: 'publicada',
      OFERTADA: 'publicada',
      FINANCIADA: 'financiada',
      PAGADA: 'financiada',
      RECHAZADA: 'rechazada',
      CANCELADA: 'rechazada',
      VENCIDA: 'vencida',
      DENUNCIADA: 'rechazada',
    };
    return map[status] ?? 'pendiente';
  }

  trackByOfertaId(_index: number, oferta: OfertaDetalleType): string {
    return oferta.ofertaId;
  }
}
