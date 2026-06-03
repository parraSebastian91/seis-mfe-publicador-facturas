import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { FacturaType, VersionTerminos } from 'shared-utils';

@Component({
  selector: 'app-terms-and-conditions-modal',
  templateUrl: './terms-and-conditions-modal.component.html',
  styleUrl: './terms-and-conditions-modal.component.scss',
  standalone: false
})
export class TermsAndConditionsModalComponent {
  @Input() isOpen = false;
  @Input() factura: FacturaType | null = null;
  @Input() versionTerminos: VersionTerminos | null = null;
  @Input() isSubmitting = false;
  @Input() errorMessage = '';

  @Output() readonly accepted = new EventEmitter<void>();
  @Output() readonly dismissed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen && !this.isSubmitting) {
      this.dismissed.emit();
    }
  }

  get facturaLabel(): string {
    const num = this.factura?.facturaNumero;
    return num ? `Factura N° ${num}` : 'Factura';
  }

  get tncTitle(): string {
    return this.versionTerminos?.descripcion ?? 'Condiciones de publicación de facturas';
  }

  get tncText(): string {
    if (this.versionTerminos?.textCompleto) {
      return this.versionTerminos.textCompleto;
    }
    return [
      'Al aceptar, declaras que:',
      '\n• Autorizas la publicación de la factura en el marketplace de financiamiento.',
      '\n• Autorizas la notificación a entidades financieras para su evaluación.',
      '\n• Los datos ingresados son verídicos y de tu responsabilidad.',
    ].join('');
  }

  onAccept(): void {
    this.accepted.emit();
  }

  onDismiss(): void {
    if (!this.isSubmitting) {
      this.dismissed.emit();
    }
  }
}
