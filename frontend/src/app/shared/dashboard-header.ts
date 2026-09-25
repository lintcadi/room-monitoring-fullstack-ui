import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-dashboard-header',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <a class="brand" routerLink="/" aria-label="Room monitor home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="brand-word">room<span class="brand-light"> / monitor</span></span>
      </a>
      <nav aria-label="Dashboard navigation">
        <a
          routerLink="/"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          ariaCurrentWhenActive="page"
          >Live</a
        >
        <a routerLink="/history" routerLinkActive="active" ariaCurrentWhenActive="page">History</a>
      </nav>
      <div class="context"><ng-content /></div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    header {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.055em;
      text-decoration: none;
    }
    .brand-light {
      color: var(--muted);
      font-weight: 400;
    }
    .brand-mark {
      display: grid;
      grid-template-columns: repeat(2, 5px);
      gap: 3px;
      padding: 8px;
      background: var(--text);
      border-radius: 9px;
    }
    .brand-mark i {
      width: 5px;
      height: 5px;
      border-radius: 1px;
      background: #f3f5ed;
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
    .context {
      display: flex;
      align-items: center;
      font-size: 0.65rem;
      color: var(--muted);
    }
    @media (max-width: 700px) {
      .brand-word {
        display: none;
      }
      nav {
        padding: 2px;
      }
      nav a {
        padding: 4px 12px;
        font-size: 0.65rem;
      }
      .context {
        font-size: 0.6rem;
      }
    }
  `,
})
export class DashboardHeader {}
