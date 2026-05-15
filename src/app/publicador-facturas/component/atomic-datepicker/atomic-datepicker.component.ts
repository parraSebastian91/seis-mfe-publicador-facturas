import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-atomic-datepicker',
  templateUrl: './atomic-datepicker.component.html',
  styleUrl: './atomic-datepicker.component.scss',
  standalone: false
})
export class AtomicDatepickerComponent implements OnChanges {
  @Input() value = '';
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() enterPressed = new EventEmitter<KeyboardEvent>();
  @Output() escapePressed = new EventEmitter<KeyboardEvent>();

  model: Date | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) {
      return;
    }

    this.model = this.parseToStruct(this.value);
  }

  onDateChange(date: Date | null): void {
    if (!date) {
      this.valueChange.emit('');
      return;
    }

    this.valueChange.emit(this.formatDateToIso(date));
  }

  private parseToStruct(value: string): Date | null {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      return null;
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    const candidate = new Date(year, month - 1, day);
    if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
      return null;
    }

    return candidate;
  }

  private formatDateToIso(value: Date): string {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
