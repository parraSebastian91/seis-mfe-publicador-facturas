import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FacturaType, facturaEstado } from 'shared-utils';

export type FacturaSortOption = 'none' | 'monto-asc' | 'monto-desc' | 'estado-asc' | 'estado-desc';

export interface FacturaFilters {
  status: facturaEstado | '';
  gestor: string;
  deudor: string;
  numeroFactura: string;
  sortBy: FacturaSortOption;
}

interface ActiveFilterChip {
  key: keyof FacturaFilters;
  label: string;
}

@Component({
  selector: 'app-atomic-factura-filters',
  templateUrl: './atomic-factura-filters.component.html',
  styleUrl: './atomic-factura-filters.component.scss',
  standalone: false
})
export class AtomicFacturaFiltersComponent {
  @Input() facturas: FacturaType[] = [];
  @Input() isAdmin = false;
  @Input() filters: FacturaFilters = {
    status: '',
    gestor: '',
    deudor: '',
    numeroFactura: '',
    sortBy: 'none'
  };

  @Output() filtersChange = new EventEmitter<FacturaFilters>();

  readonly estadoOptions = Object.values(facturaEstado);
  readonly sortOptions: Array<{ value: FacturaSortOption; label: string }> = [
    { value: 'none', label: 'Sin orden' },
    { value: 'monto-asc', label: 'Monto menor a mayor' },
    { value: 'monto-desc', label: 'Monto mayor a menor' },
    { value: 'estado-asc', label: 'Estado A-Z' },
    { value: 'estado-desc', label: 'Estado Z-A' },
  ];

  get gestorOptions(): string[] {
    return Array.from(new Set(
      this.facturas
        .map(factura => String(factura.gestor ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'es'));
  }

  get activeChips(): ActiveFilterChip[] {
    const chips: ActiveFilterChip[] = [];

    if (this.filters.status) {
      chips.push({ key: 'status', label: `Estado: ${this.filters.status}` });
    }

    if (this.filters.gestor) {
      chips.push({ key: 'gestor', label: `Gestor: ${this.filters.gestor}` });
    }

    if (this.filters.deudor.trim()) {
      chips.push({ key: 'deudor', label: `Deudor: ${this.filters.deudor.trim()}` });
    }

    if (this.filters.numeroFactura.trim()) {
      chips.push({ key: 'numeroFactura', label: `Factura: ${this.filters.numeroFactura.trim()}` });
    }

    if (this.filters.sortBy !== 'none') {
      const selectedSort = this.sortOptions.find(option => option.value === this.filters.sortBy);
      chips.push({ key: 'sortBy', label: `Orden: ${selectedSort?.label || this.filters.sortBy}` });
    }

    return chips;
  }

  updateFilter<K extends keyof FacturaFilters>(key: K, value: FacturaFilters[K]): void {
    this.filters = {
      ...this.filters,
      [key]: value,
    };

    this.filtersChange.emit(this.filters);
  }

  clearOne(key: keyof FacturaFilters): void {
    const clearValue: Record<keyof FacturaFilters, FacturaFilters[keyof FacturaFilters]> = {
      status: '',
      gestor: '',
      deudor: '',
      numeroFactura: '',
      sortBy: 'none',
    };

    this.updateFilter(key, clearValue[key] as never);
  }

  clearAll(): void {
    this.filters = {
      status: '',
      gestor: '',
      deudor: '',
      numeroFactura: '',
      sortBy: 'none',
    };

    this.filtersChange.emit(this.filters);
  }
}
