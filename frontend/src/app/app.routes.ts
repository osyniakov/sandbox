import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'diagrams'
  },
  {
    path: 'diagrams',
    loadComponent: () =>
      import('./features/diagram-list/diagram-list.component').then((m) => m.DiagramListComponent)
  },
  {
    path: 'diagrams/new',
    loadComponent: () =>
      import('./features/modeler/modeler.component').then((m) => m.ModelerComponent)
  },
  {
    path: 'diagrams/:id/edit',
    loadComponent: () =>
      import('./features/modeler/modeler.component').then((m) => m.ModelerComponent)
  },
  {
    path: 'diagrams/:id',
    loadComponent: () =>
      import('./features/viewer/viewer.component').then((m) => m.ViewerComponent)
  },
  { path: '**', redirectTo: 'diagrams' }
];
