import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiagramService } from '../../core/diagram.service';
import { DiagramSummary } from '../../core/diagram.model';

@Component({
  selector: 'app-diagram-list',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './diagram-list.component.html',
  styleUrl: './diagram-list.component.scss'
})
export class DiagramListComponent implements OnInit {
  private readonly service = inject(DiagramService);

  readonly diagrams = signal<DiagramSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (items) => {
        this.diagrams.set(items);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.formatError(err));
        this.loading.set(false);
      }
    });
  }

  delete(d: DiagramSummary): void {
    if (!confirm(`Delete diagram "${d.name}"?`)) {
      return;
    }
    this.service.delete(d.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.error.set(this.formatError(err))
    });
  }

  private formatError(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message);
    }
    return 'Request failed';
  }
}
