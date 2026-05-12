import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';

@Component({
  selector: 'app-image-panzoom-viewer',
  templateUrl: './image-panzoom-viewer.component.html',
  styleUrl: './image-panzoom-viewer.component.scss',
  standalone: false
})
export class ImagePanzoomViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() imageSrc = '';
  @Input() altText = 'Imagen de factura';

  @ViewChild('imageEl', { static: true }) imageElementRef!: ElementRef<HTMLImageElement>;
  @ViewChild('viewport', { static: true }) viewportRef!: ElementRef<HTMLElement>;

  private panzoom?: PanzoomObject;

  private readonly wheelHandler = (event: WheelEvent): void => {
    if (!this.panzoom) {
      return;
    }

    event.preventDefault();
    this.panzoom.zoomWithWheel(event, { step: 0.15 });
  };

  ngAfterViewInit(): void {
    this.initializePanzoom();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['imageSrc'] || !this.panzoom) {
      return;
    }

    this.reset();
  }

  ngOnDestroy(): void {
    this.viewportRef?.nativeElement.removeEventListener('wheel', this.wheelHandler);
    this.panzoom?.destroy();
  }

  zoomIn(): void {
    this.panzoom?.zoomIn();
  }

  zoomOut(): void {
    this.panzoom?.zoomOut();
  }

  reset(): void {
    this.panzoom?.reset();
  }

  private initializePanzoom(): void {
    this.panzoom = Panzoom(this.imageElementRef.nativeElement, {
      maxScale: 6,
      minScale: 0.5,
      contain: 'outside'
    });

    this.viewportRef.nativeElement.addEventListener('wheel', this.wheelHandler, { passive: false });
  }
}
