import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Diagram, DiagramRequest, DiagramSummary } from './diagram.model';

@Injectable({ providedIn: 'root' })
export class DiagramService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/diagrams`;

  list(): Observable<DiagramSummary[]> {
    return this.http.get<DiagramSummary[]>(this.baseUrl);
  }

  get(id: number): Observable<Diagram> {
    return this.http.get<Diagram>(`${this.baseUrl}/${id}`);
  }

  create(request: DiagramRequest): Observable<Diagram> {
    return this.http.post<Diagram>(this.baseUrl, request);
  }

  update(id: number, request: DiagramRequest): Observable<Diagram> {
    return this.http.put<Diagram>(`${this.baseUrl}/${id}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
