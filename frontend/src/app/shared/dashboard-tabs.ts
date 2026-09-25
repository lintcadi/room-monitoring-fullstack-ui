import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatTabsModule, MatTabNavPanel } from '@angular/material/tabs';

@Component({
  selector: 'app-dashboard-tabs',
  imports: [RouterLink, RouterLinkActive, MatTabsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      mat-tab-nav-bar
      [tabPanel]="tabPanel()"
      [disablePagination]="true"
      aria-label="Dashboard navigation"
    >
      @for (tab of tabs; track tab.path) {
        <a
          mat-tab-link
          [routerLink]="tab.path"
          routerLinkActive
          #active="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: true }"
          [active]="active.isActive"
          >{{ tab.label }}</a
        >
      }
    </nav>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      min-width: 0;
    }
    nav {
      max-width: 100%;
    }
  `,
})
export class DashboardTabs {
  readonly tabPanel = input.required<MatTabNavPanel>();
  protected readonly tabs = [
    { path: '/', label: 'Live' },
    { path: '/history', label: 'History' },
    { path: '/cctv', label: 'CCTV' },
  ];
}
