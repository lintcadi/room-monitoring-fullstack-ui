import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-dashboard-tabs',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Dashboard navigation">
      <a
        routerLink="/"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        ariaCurrentWhenActive="page"
        >Live</a
      >
      <a routerLink="/history" routerLinkActive="active" ariaCurrentWhenActive="page">History</a>
      <a routerLink="/cctv" routerLinkActive="active" ariaCurrentWhenActive="page">CCTV</a>
    </nav>
  `,
  styles: `
    :host {
      display: flex;
      height: 100%;
      min-width: 0;
      align-items: center;
      justify-content: center;
    }
    nav {
      display: flex;
      gap: 3px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #eeefea;
    }
    nav a {
      padding: 6px 20px;
      color: var(--muted);
      text-decoration: none;
      font-size: 0.75rem;
      border-radius: 7px;
    }
    nav a.active {
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 1px 4px #203f3010;
    }
    @media (max-width: 700px) {
      nav {
        padding: 2px;
      }
      nav a {
        padding: 4px 12px;
        font-size: 0.65rem;
      }
    }
  `,
})
export class DashboardTabs {}
