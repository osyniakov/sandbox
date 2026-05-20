import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { DiagramService } from '../../core/diagram.service';

@Component({
  selector: 'app-viewer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './viewer.component.html',
  styleUrl: './viewer.component.scss'
})
export class ViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;

  private readonly service = inject(DiagramService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private viewer: NavigatedViewer | null = null;

  readonly diagramId = signal<number | null>(null);
  readonly name = signal<string>('');
  readonly error = signal<string | null>(null);

  async ngAfterViewInit(): Promise<void> {
    this.viewer = new NavigatedViewer({
      container: this.canvas.nativeElement
    });

    const idParam = this.route.snapshot.paramMap.get('id');
    if (!idParam) {
      this.error.set('Missing diagram id');
      return;
    }
    const id = Number(idParam);
    this.diagramId.set(id);
    try {
      const diagram = await firstValueFrom(this.service.get(id));
      this.name.set(diagram.name);
      await this.viewer.importXML(diagram.xml);
      const canvas = this.viewer.get<{ zoom: (value: string) => void }>('canvas');
      canvas?.zoom('fit-viewport');
    } catch (err) {
      this.error.set(this.formatError(err));
    }
  }

  ngOnDestroy(): void {
    this.viewer?.destroy();
    this.viewer = null;
  }

  back(): void {
    this.router.navigate(['/diagrams']);
  }

  private formatError(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message);
    }
    return 'Failed to load diagram';
  }
}
