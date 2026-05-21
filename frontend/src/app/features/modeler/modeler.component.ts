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
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { saveAs } from 'file-saver';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule
} from 'bpmn-js-properties-panel';
import { DiagramService } from '../../core/diagram.service';

@Component({
  selector: 'app-modeler',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modeler.component.html',
  styleUrl: './modeler.component.scss'
})
export class ModelerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;
  @ViewChild('propertiesPanel', { static: true })
  propertiesPanelHost!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private readonly service = inject(DiagramService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  private modeler: BpmnModeler | null = null;

  readonly diagramId = signal<number | null>(null);
  readonly name = signal('Untitled diagram');
  readonly status = signal<string>('');
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly panelCollapsed = signal(false);

  togglePanel(): void {
    this.panelCollapsed.update((v) => !v);
  }

  async ngAfterViewInit(): Promise<void> {
    this.modeler = new BpmnModeler({
      container: this.canvas.nativeElement,
      propertiesPanel: { parent: this.propertiesPanelHost.nativeElement },
      additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule]
    });

    const idParam = this.route.snapshot.paramMap.get('id');
    try {
      if (idParam) {
        const id = Number(idParam);
        this.diagramId.set(id);
        const diagram = await firstValueFrom(this.service.get(id));
        this.name.set(diagram.name);
        await this.modeler.importXML(diagram.xml);
      } else {
        const xml = await firstValueFrom(
          this.http.get('assets/bpmn/newDiagram.bpmn', { responseType: 'text' })
        );
        await this.modeler.importXML(xml);
      }
      this.fitViewport();
    } catch (err) {
      this.error.set(this.formatError(err));
    }
  }

  ngOnDestroy(): void {
    this.modeler?.destroy();
    this.modeler = null;
  }

  async save(): Promise<void> {
    if (!this.modeler) return;
    this.saving.set(true);
    this.status.set('');
    this.error.set(null);
    try {
      const { xml } = await this.modeler.saveXML({ format: true });
      const name = this.name().trim() || 'Untitled diagram';
      const id = this.diagramId();
      const request = { name, xml: xml ?? '' };
      const result = id !== null
        ? await firstValueFrom(this.service.update(id, request))
        : await firstValueFrom(this.service.create(request));
      this.diagramId.set(result.id);
      this.status.set(`Saved at ${new Date().toLocaleTimeString()}`);
      if (id === null) {
        this.router.navigate(['/diagrams', result.id, 'edit'], { replaceUrl: true });
      }
    } catch (err) {
      this.error.set(this.formatError(err));
    } finally {
      this.saving.set(false);
    }
  }

  saveAs(): void {
    const next = prompt('Save copy as:', this.name());
    if (next === null) return;
    this.name.set(next.trim() || 'Untitled diagram');
    this.diagramId.set(null);
    this.save();
  }

  triggerImport(): void {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.modeler) return;
    try {
      const text = await file.text();
      await this.modeler.importXML(text);
      this.name.set(file.name.replace(/\.bpmn(\.xml)?$/i, '') || 'Imported diagram');
      this.diagramId.set(null);
      this.fitViewport();
      this.status.set(`Imported ${file.name}`);
    } catch (err) {
      this.error.set(this.formatError(err));
    }
  }

  async exportXml(): Promise<void> {
    if (!this.modeler) return;
    try {
      const { xml } = await this.modeler.saveXML({ format: true });
      const blob = new Blob([xml ?? ''], { type: 'application/bpmn+xml' });
      saveAs(blob, `${this.fileBaseName()}.bpmn`);
    } catch (err) {
      this.error.set(this.formatError(err));
    }
  }

  async exportSvg(): Promise<void> {
    if (!this.modeler) return;
    try {
      const { svg } = await this.modeler.saveSVG();
      const blob = new Blob([svg ?? ''], { type: 'image/svg+xml' });
      saveAs(blob, `${this.fileBaseName()}.svg`);
    } catch (err) {
      this.error.set(this.formatError(err));
    }
  }

  back(): void {
    this.router.navigate(['/diagrams']);
  }

  onNameInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.name.set(target.value);
  }

  private fitViewport(): void {
    const canvas = this.modeler?.get<{ zoom: (value: string) => void }>('canvas');
    canvas?.zoom('fit-viewport');
  }

  private fileBaseName(): string {
    return this.name().trim().replace(/[^a-z0-9._-]+/gi, '_') || 'diagram';
  }

  private formatError(err: unknown): string {
    if (err && typeof err === 'object') {
      if ('message' in err) return String((err as { message: unknown }).message);
      if ('warnings' in err) return 'Failed to import diagram (invalid BPMN XML)';
    }
    return 'Operation failed';
  }
}
