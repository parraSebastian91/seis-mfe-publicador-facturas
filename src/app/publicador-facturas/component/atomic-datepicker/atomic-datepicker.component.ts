import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

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

  model: NgbDateStruct | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) {
      return;
    }

    this.model = this.parseToStruct(this.value);
  }

  onDateChange(date: NgbDateStruct | null): void {
    if (!date) {
      this.valueChange.emit('');
      return;
    }

    this.valueChange.emit(this.formatToIso(date));
  }

  private parseToStruct(value: string): NgbDateStruct | null {
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

    return { year, month, day };
  }

  private formatToIso(value: NgbDateStruct): string {
    const year = String(value.year).padStart(4, '0');
    const month = String(value.month).padStart(2, '0');
    const day = String(value.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
